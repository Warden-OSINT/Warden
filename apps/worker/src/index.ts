import { setTimeout as sleep } from 'node:timers/promises';
import { QUEUES, type ReportRequestMessage, type ScanRequestMessage } from '@warden/shared';
import { config } from './config';
import { runScan } from './jobs/run-scan';
import { generateReport } from './pipeline/report';
import { keepInvisible } from './pipeline/visibility';
import { db } from './supabase';

const IDLE_DELAY_MS = 5_000;
/** Un resumen tarda segundos; si el worker muere, el pedido reaparece pronto. */
const REPORT_VISIBILITY_TIMEOUT = 180;
const shutdown = new AbortController();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} recibido, terminando después del trabajo actual`);
    shutdown.abort();
  });
}

async function pollScanRequests(): Promise<boolean> {
  const { data, error } = await db.rpc('queue_read', {
    p_queue: QUEUES.scanRequests,
    p_visibility_timeout: config.QUEUE_VISIBILITY_TIMEOUT,
    p_quantity: 1,
  });
  if (error) throw error;

  const messages = data ?? [];
  for (const msg of messages) {
    // pgmq tipa el mensaje como Json; su forma la garantizan request_scan() y enqueue_due_scans().
    const { scan_id } = msg.message as unknown as ScanRequestMessage;
    // Si el worker muere a mitad del escaneo, el latido se detiene y el mensaje reaparece al vencer el timeout.
    const heartbeat = keepInvisible(db, QUEUES.scanRequests, msg.msg_id, config.QUEUE_VISIBILITY_TIMEOUT);
    try {
      await runScan(db, scan_id, { attempt: msg.read_ct, signal: shutdown.signal });
    } finally {
      heartbeat.stop();
    }
    await db.rpc('queue_delete', { p_queue: QUEUES.scanRequests, p_msg_id: msg.msg_id });
  }
  return messages.length > 0;
}

async function pollReportRequests(): Promise<boolean> {
  const { data, error } = await db.rpc('queue_read', {
    p_queue: QUEUES.reportRequests,
    p_visibility_timeout: REPORT_VISIBILITY_TIMEOUT,
    p_quantity: 1,
  });
  if (error) throw error;

  const messages = data ?? [];
  for (const msg of messages) {
    // Lo encola request_report(); generateReport registra los fallos en reports.status.
    const { score_id } = msg.message as unknown as ReportRequestMessage;
    await generateReport(db, score_id, shutdown.signal);
    await db.rpc('queue_delete', { p_queue: QUEUES.reportRequests, p_msg_id: msg.msg_id });
  }
  return messages.length > 0;
}

console.log('[worker] escuchando las colas', QUEUES.scanRequests, 'y', QUEUES.reportRequests);

while (!shutdown.signal.aborted) {
  try {
    // Los escaneos tienen prioridad; los resúmenes se generan cuando no hay escaneos en cola.
    const didWork = (await pollScanRequests()) || (await pollReportRequests());
    if (!didWork) await sleep(IDLE_DELAY_MS, undefined, { signal: shutdown.signal });
  } catch (err) {
    if (shutdown.signal.aborted) break;
    console.error('[worker] error en el ciclo de la cola', err);
    await sleep(IDLE_DELAY_MS).catch(() => {});
  }
}
