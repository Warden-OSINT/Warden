import type { CollectorTarget } from '@warden/collectors';
import type { AssetType } from '@warden/shared';
import { isCancellation, watchCancellation } from '../pipeline/cancellation';
import { collectAll } from '../pipeline/collect';
import { persistResults } from '../pipeline/persist';
import { resolveUnseenFindings } from '../pipeline/resolve';
import { raiseScoreAlert } from '../pipeline/alerts';
import { scoreScan } from '../pipeline/score';
import type { Db } from '../supabase';

const MAX_ATTEMPTS = 3;
const FINISHED = new Set(['completed', 'failed', 'cancelled']);

export async function runScan(
  db: Db,
  scanId: string,
  opts: { attempt: number; signal: AbortSignal },
): Promise<void> {
  const { data: scan, error } = await db
    .from('scans')
    .select('id, company_id, weight_version_id, status')
    .eq('id', scanId)
    .maybeSingle();
  if (error) throw error;
  // Escaneo borrado (p. ej. con su empresa): sin return, el mensaje se reintentaría para siempre.
  if (!scan) {
    console.warn(`[run-scan] ${scanId} ya no existe: se descarta el mensaje`);
    return;
  }
  // Un escaneo cancelado en cola se descarta aquí; el mensaje se borra igual.
  if (FINISHED.has(scan.status)) return;

  if (opts.attempt > MAX_ATTEMPTS) {
    await markFailed(db, scanId, `abandonado tras ${MAX_ATTEMPTS} intentos`);
    return;
  }

  const { data: started } = await db
    .from('scans')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', scanId)
    .in('status', ['queued', 'running'])
    .select('id');
  // Se canceló entre la lectura y la actualización.
  if (!started?.length) return;

  const cancellation = watchCancellation(db, scanId);
  const signal = AbortSignal.any([opts.signal, cancellation.signal]);

  try {
    const { data: company, error: companyError } = await db
      .from('companies')
      .select('primary_domain')
      .eq('id', scan.company_id)
      .single();
    if (companyError) throw companyError;

    const { data: assets } = await db
      .from('assets')
      .select('asset_type, value')
      .eq('company_id', scan.company_id)
      .eq('attribution_status', 'confirmed');

    const target: CollectorTarget = {
      companyId: scan.company_id,
      primaryDomain: company.primary_domain,
      // asset_type es text en BD; el CHECK constraint garantiza que sea un AssetType.
      assets: (assets ?? []).map((a) => ({ type: a.asset_type as AssetType, value: a.value })),
    };

    const results = await collectAll(db, scanId, target, signal);
    // Un escaneo cancelado no persiste resultados parciales ni se califica.
    await cancellation.checkNow();
    await persistResults(db, scan, results);
    await resolveUnseenFindings(db, scan);

    // Después de resolver: los hallazgos que la fuente dejó de observar ya no restan.
    const score = await scoreScan(db, scan);
    if (score) {
      // Un reintento borra el puntaje anterior y con él sus alertas (on delete cascade).
      await raiseScoreAlert(db, { id: score.scoreId, companyId: scan.company_id, grade: score.grade });
      // El resumen con IA se genera aparte (cola report_requests): no retrasa ni tumba el escaneo.
      const { error: reportError } = await db.rpc('request_report', { p_score_id: score.scoreId });
      if (reportError) console.warn(`[run-scan] ${scanId} no se pudo pedir el resumen`, reportError.message);
    }

    await db
      .from('scans')
      .update({ status: 'completed', finished_at: new Date().toISOString(), current_source: null })
      .eq('id', scanId)
      .eq('status', 'running');
  } catch (err) {
    if (isCancellation(err) || isCancellation(signal.reason)) {
      console.log(`[run-scan] ${scanId} cancelado`);
      return;
    }
    // Apagado del worker: sin borrar el mensaje, reaparece al vencer el timeout y se reintenta.
    if (opts.signal.aborted) throw err;
    console.error(`[run-scan] ${scanId} falló`, err);
    await markFailed(db, scanId, err instanceof Error ? err.message : String(err));
  } finally {
    cancellation.stop();
  }
}

async function markFailed(db: Db, scanId: string, message: string) {
  await db
    .from('scans')
    .update({ status: 'failed', finished_at: new Date().toISOString(), error_message: message, current_source: null })
    .eq('id', scanId)
    // No pisa un escaneo que alguien canceló mientras tanto.
    .in('status', ['queued', 'running']);
}
