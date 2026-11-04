import {
  checkCollector,
  collectors,
  type CollectorResult,
  type CollectorTarget,
  type SourceRow,
} from '@warden/collectors';
import type { Json } from '@warden/db';
import type { Db } from '../supabase';

export interface SourceResult {
  sourceKey: string;
  result: CollectorResult;
}

/** Ejecuta cada colector registrado que pase la compuerta no-contact y registra scan_sources. */
export async function collectAll(
  db: Db,
  scanId: string,
  target: CollectorTarget,
  signal: AbortSignal,
): Promise<SourceResult[]> {
  const { data: sources, error } = await db
    .from('sources')
    .select('source_key, is_no_contact, is_enabled');
  if (error) throw error;
  const sourceByKey = new Map((sources as SourceRow[]).map((s) => [s.source_key, s]));

  // secret_ref apunta a una variable de entorno del contenedor del worker.
  const ctx = { signal, getSecret: (ref: string) => process.env[ref] };

  const results: SourceResult[] = [];
  // Progreso para la web: total de colectores y el que se consulta ahora.
  await setProgress(db, scanId, { sources_total: collectors.size });

  for (const collector of collectors.values()) {
    signal.throwIfAborted();
    const decision = checkCollector(collector, sourceByKey.get(collector.sourceKey));
    if (!decision.allowed) {
      await recordSource(db, scanId, collector.sourceKey, decision.status, null, null, decision.reason);
      continue;
    }

    await setProgress(db, scanId, { current_source: collector.sourceKey });
    const started = performance.now();
    let result: CollectorResult;
    try {
      result = await collector.collect(target, ctx);
    } catch (err) {
      // Cancelado o apagado del worker: la fuente no falló, se cortó. Se detiene el escaneo.
      if (signal.aborted) {
        await recordSource(db, scanId, collector.sourceKey, 'skipped', null, performance.now() - started, 'escaneo detenido');
        throw signal.reason;
      }
      const message = err instanceof Error ? err.message : String(err);
      await recordSource(db, scanId, collector.sourceKey, 'failed', null, performance.now() - started, message);
      continue;
    }
    // Fuera del try: un error de BD aquí no es un fallo de la fuente, y debe tumbar el escaneo.
    await recordSource(db, scanId, collector.sourceKey, 'ok', result, performance.now() - started);
    results.push({ sourceKey: collector.sourceKey, result });
  }

  await setProgress(db, scanId, { current_source: null });
  return results;
}

/** Solo mientras el escaneo sigue en curso: no reescribe uno ya cancelado. */
async function setProgress(db: Db, scanId: string, values: { current_source?: string | null; sources_total?: number }) {
  const { error } = await db.from('scans').update(values).eq('id', scanId).eq('status', 'running');
  // El progreso es informativo: un error aquí no debe tumbar el escaneo.
  if (error) console.warn(`[collect] ${scanId} no se pudo guardar el progreso`, error.message);
}

async function recordSource(
  db: Db,
  scanId: string,
  sourceKey: string,
  status: 'ok' | 'failed' | 'skipped' | 'blocked',
  result: CollectorResult | null,
  latencyMs: number | null,
  message?: string,
) {
  const assets = result?.assets.length ?? 0;
  const findings = result?.findings.length ?? 0;
  // score.ts y resolve.ts leen estas filas: si no se guardan, el dominio saldría del KRI sin aviso.
  const { error } = await db.from('scan_sources').upsert(
    {
      scan_id: scanId,
      source_key: sourceKey,
      status,
      items_returned: assets + findings,
      assets_returned: assets,
      findings_returned: findings,
      // Los colectores producen avisos serializables a JSON; la columna es not null.
      notices: (result?.notices ?? []) as unknown as NonNullable<Json>,
      latency_ms: latencyMs === null ? null : Math.round(latencyMs),
      message: message ?? null,
    },
    { onConflict: 'scan_id,source_key' },
  );
  if (error) throw error;
}
