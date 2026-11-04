import type { Json } from '@warden/db';
import type { Db } from '../supabase';
import type { SourceResult } from './collect';
import { reopenAutoResolved } from './resolve';

// PostgREST corta las respuestas en 1000 filas por defecto.
const PAGE_SIZE = 1000;
const IN_FILTER_CHUNK = 200;

interface ScanRow {
  id: string;
  company_id: string;
}

/**
 * Guarda activos descubiertos (quedan 'pending' hasta que un analista los confirme)
 * y hace upsert de hallazgos por (company_id, fingerprint), sin tocar su estado de triage
 * (salvo reabrir los que el propio worker resolvió; ver resolve.ts).
 */
export async function persistResults(db: Db, scan: ScanRow, results: SourceResult[]) {
  const now = new Date().toISOString();

  const discovered = results.flatMap((r) => r.result.assets);
  if (discovered.length > 0) {
    const rows = discovered.map((a) => ({
      company_id: scan.company_id,
      asset_type: a.type,
      value: a.value,
      discovery_source: 'auto',
    }));
    const { error } = await db
      .from('assets')
      .upsert(rows, { onConflict: 'company_id,asset_type,value', ignoreDuplicates: true });
    if (error) throw error;

    // En lotes: miles de subdominios en un solo filtro in.(…) exceden el largo de URL de PostgREST.
    for (const type of new Set(discovered.map((a) => a.type))) {
      const values = [...new Set(discovered.filter((a) => a.type === type).map((a) => a.value))];
      for (let i = 0; i < values.length; i += IN_FILTER_CHUNK) {
        const { error: seenError } = await db
          .from('assets')
          .update({ last_seen: now })
          .eq('company_id', scan.company_id)
          .eq('asset_type', type)
          .in('value', values.slice(i, i + IN_FILTER_CHUNK));
        if (seenError) throw seenError;
      }
    }
  }

  const { data: domains } = await db.from('risk_domains').select('id, key');
  const domainIdByKey = new Map((domains ?? []).map((d) => [d.key, d.id]));

  const assetIdByValue = await loadAssetIds(db, scan.company_id);

  for (const { sourceKey, result } of results) {
    if (result.findings.length === 0) continue;

    const rows = result.findings.map((f) => {
      const riskDomainId = domainIdByKey.get(f.riskDomain);
      if (riskDomainId === undefined) {
        throw new Error(`dominio de riesgo '${f.riskDomain}' no existe en risk_domains (¿falta el seed?)`);
      }
      return {
        company_id: scan.company_id,
        scan_id: scan.id,
        asset_id: f.assetValue ? (assetIdByValue.get(f.assetValue) ?? null) : null,
        risk_domain_id: riskDomainId,
        fingerprint: f.fingerprint,
        title: f.title,
        severity: f.severity,
        confidence: f.confidence,
        observed_at: f.observedAt.toISOString(),
        // Los colectores producen evidencia serializable a JSON.
        evidence: f.evidence as Json,
      };
    });

    const { data: saved, error } = await db
      .from('findings')
      .upsert(rows, { onConflict: 'company_id,fingerprint' })
      .select('id, fingerprint');
    if (error) throw error;

    const rawByFingerprint = new Map(result.findings.map((f) => [f.fingerprint, f.rawReference]));
    // last_seen_scan_id alimenta la resolución automática: si no se guarda, un hallazgo
    // vigente podría resolverse por error, así que el fallo debe tumbar el escaneo.
    const { error: sourcesError } = await db.from('finding_sources').upsert(
      (saved ?? []).map((s) => ({
        finding_id: s.id,
        source_key: sourceKey,
        raw_reference: (rawByFingerprint.get(s.fingerprint) ?? null) as Json,
        last_seen_scan_id: scan.id,
      })),
      { onConflict: 'finding_id,source_key' },
    );
    if (sourcesError) throw sourcesError;

    await reopenAutoResolved(db, (saved ?? []).map((s) => s.id));
  }
}

/** Todos los activos de la empresa (paginado): sin paginar, los que pasan de 1000 quedarían sin asset_id. */
async function loadAssetIds(db: Db, companyId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('assets')
      .select('id, value')
      .eq('company_id', companyId)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    // Los hallazgos solo traen el valor del activo; si se repite entre tipos, gana el primero.
    for (const a of data) if (!ids.has(a.value)) ids.set(a.value, a.id);
    if (data.length < PAGE_SIZE) break;
  }
  return ids;
}
