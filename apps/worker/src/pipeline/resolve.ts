import type { Db } from '../supabase';

/**
 * SUPUESTO (pendiente de validar con el equipo): un hallazgo se da por resuelto cuando
 * su fuente completó con éxito (scan_sources.status = 'ok') este número de escaneos
 * consecutivos de la empresa sin observarlo. Con 1 bastaría una respuesta incompleta
 * de la fuente para cerrarlo; 3 tolera ruido transitorio sin dejarlo abierto para
 * siempre. Con escaneos semanales equivale a ~3 semanas.
 */
export const UNSEEN_SCANS_TO_RESOLVE = 3;

/** status_reason de los hallazgos resueltos por el worker; también permite reabrirlos. */
export const AUTO_RESOLVED_REASON = 'auto: la fuente dejó de observarlo en escaneos exitosos consecutivos';

// Acota el largo de las URLs de PostgREST (filtros in.(…) con UUIDs).
const PAGE_SIZE = 200;

export interface ResolutionCandidate {
  findingId: string;
  status: string;
  /** Último escaneo en que la fuente observó el hallazgo (null si se borró). */
  lastSeenScanId: string | null;
}

/**
 * Regla pura: devuelve los hallazgos a resolver dados los escaneos exitosos más recientes
 * de la fuente (del más nuevo al más viejo, incluido el actual).
 * - Sin `threshold` escaneos exitosos todavía, no resuelve nada.
 * - Solo toca hallazgos 'open': 'false_positive' y 'accepted' son decisiones de triage,
 *   y 'resolved' ya está cerrado.
 */
export function findingsToResolve(
  okScanIdsNewestFirst: readonly string[],
  candidates: readonly ResolutionCandidate[],
  threshold: number = UNSEEN_SCANS_TO_RESOLVE,
): string[] {
  if (!Number.isInteger(threshold) || threshold < 1) {
    throw new Error(`umbral de resolución inválido: ${threshold}`);
  }
  const window = okScanIdsNewestFirst.slice(0, threshold);
  if (window.length < threshold) return [];
  const recent = new Set(window);
  return candidates
    .filter((c) => c.status === 'open' && (c.lastSeenScanId === null || !recent.has(c.lastSeenScanId)))
    .map((c) => c.findingId);
}

/**
 * Resuelve los hallazgos que cada fuente exitosa de este escaneo dejó de observar.
 * Solo considera fuentes con scan_sources.status = 'ok': una fuente fallida, omitida o
 * bloqueada nunca resuelve hallazgos, y esos escaneos no cuentan para la racha.
 */
export async function resolveUnseenFindings(
  db: Db,
  scan: { id: string; company_id: string },
  threshold: number = UNSEEN_SCANS_TO_RESOLVE,
): Promise<number> {
  const { data: okSources, error } = await db
    .from('scan_sources')
    .select('source_key')
    .eq('scan_id', scan.id)
    .eq('status', 'ok');
  if (error) throw error;

  let resolved = 0;
  for (const { source_key: sourceKey } of okSources ?? []) {
    const okScanIds = await recentOkScanIds(db, scan, sourceKey, threshold);
    if (okScanIds.length < threshold) continue;

    // Paginación sin offset: los hallazgos ya resueltos dejan de cumplir status = 'open'.
    // Se excluyen los ya revisados que siguen abiertos para no repetir páginas.
    const kept = new Set<string>();
    for (;;) {
      const page = await openCandidates(db, scan.company_id, sourceKey, okScanIds, kept);
      if (page.length === 0) break;
      const ids = findingsToResolve(okScanIds, page, threshold);
      const toResolve = new Set(ids);
      for (const c of page) if (!toResolve.has(c.findingId)) kept.add(c.findingId);
      if (ids.length > 0) {
        const { error: updateError } = await db
          .from('findings')
          .update({ status: 'resolved', status_reason: AUTO_RESOLVED_REASON, status_by: null })
          .in('id', ids)
          // Revalida en la escritura por si un analista lo clasificó entre lectura y update.
          .eq('status', 'open');
        if (updateError) throw updateError;
        resolved += ids.length;
      }
      if (page.length < PAGE_SIZE) break;
    }
  }
  return resolved;
}

/**
 * Reabre hallazgos que el worker había resuelto y que una fuente volvió a observar
 * (p. ej. un puerto que se reabre). Los resueltos por un analista no se tocan:
 * la política de triage exige status_by = auth.uid(), así que siempre lo traen.
 */
export async function reopenAutoResolved(db: Db, findingIds: readonly string[]): Promise<void> {
  if (findingIds.length === 0) return;
  const { error } = await db
    .from('findings')
    .update({ status: 'open', status_reason: null })
    .in('id', [...findingIds])
    .eq('status', 'resolved')
    .is('status_by', null)
    .eq('status_reason', AUTO_RESOLVED_REASON);
  if (error) throw error;
}

/**
 * Últimos `limit` escaneos de la empresa en que la fuente terminó 'ok', del más nuevo
 * al más viejo. Cuenta el escaneo en curso y los completados; los escaneos fallidos
 * no, porque su persistencia pudo quedar a medias.
 */
async function recentOkScanIds(
  db: Db,
  scan: { id: string; company_id: string },
  sourceKey: string,
  limit: number,
): Promise<string[]> {
  const { data, error } = await db
    .from('scans')
    .select('id, scan_sources!inner(source_key, status)')
    .eq('company_id', scan.company_id)
    .eq('scan_sources.source_key', sourceKey)
    .eq('scan_sources.status', 'ok')
    .or(`status.eq.completed,id.eq.${scan.id}`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((s) => s.id);
}

async function openCandidates(
  db: Db,
  companyId: string,
  sourceKey: string,
  okScanIds: readonly string[],
  exclude: ReadonlySet<string>,
): Promise<ResolutionCandidate[]> {
  let query = db
    .from('finding_sources')
    .select('finding_id, last_seen_scan_id, findings!inner(company_id, status)')
    .eq('source_key', sourceKey)
    .eq('findings.company_id', companyId)
    .eq('findings.status', 'open')
    .or(`last_seen_scan_id.is.null,last_seen_scan_id.not.in.(${okScanIds.join(',')})`);
  if (exclude.size > 0) query = query.not('finding_id', 'in', `(${[...exclude].join(',')})`);
  const { data, error } = await query.order('finding_id').limit(PAGE_SIZE);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    findingId: row.finding_id,
    status: row.findings.status,
    lastSeenScanId: row.last_seen_scan_id,
  }));
}
