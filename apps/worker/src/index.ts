import { setTimeout as sleep } from 'node:timers/promises';
import { QUEUES, type ReportRequestMessage, type ScanRequestMessage } from '@warden/shared';
import { config } from './config';
import { runScan } from './jobs/run-scan';
import { createSmtpMailer } from './mailer';
import { deliverEmailAlerts } from './pipeline/notify';
import { generateReport } from './pipeline/report';
import { deliverSiemEvents } from './pipeline/siem';
import { backfillLatestScores } from './pipeline/siem-backfill';
import { keepInvisible } from './pipeline/visibility';
import { createSplunkSender } from './splunk';
import { db } from './supabase';

const IDLE_DELAY_MS = 5_000;
/** Un resumen tarda segundos; si el worker muere, el pedido reaparece pronto. */
const REPORT_VISIBILITY_TIMEOUT = 180;
const shutdown = new AbortController();
const splunk = createSplunkSender();

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
      await runScan(db, scan_id, {
        attempt: msg.read_ct,
        signal: shutdown.signal,
        siem: splunk ? { webUrl: config.WARDEN_WEB_URL ?? null } : null,
      });
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

const mailer = createSmtpMailer();

async function pollEmailAlerts(): Promise<boolean> {
  // Sin SMTP los envíos quedan pendientes; salen cuando se configure.
  if (!mailer || !config.ALERT_EMAIL_FROM) return false;
  const processed = await deliverEmailAlerts(db, mailer, { from: config.ALERT_EMAIL_FROM, webUrl: config.WARDEN_WEB_URL ?? null });
  return processed > 0;
}

async function pollSiemEvents(): Promise<boolean> {
  if (!splunk) return false;
  const processed = await deliverSiemEvents(db, splunk, { index: config.SPLUNK_INDEX ?? null });
  return processed > 0;
}

console.log('[worker] escuchando las colas', QUEUES.scanRequests, 'y', QUEUES.reportRequests);
console.log(mailer
  ? `[worker] alertas por correo vía ${config.SMTP_HOST}:${config.SMTP_PORT}`
  : '[worker] SMTP_HOST sin configurar: las alertas por correo quedan pendientes');
console.log(splunk
  ? `[worker] eventos del SIEM a Splunk HEC (${new URL(config.SPLUNK_HEC_URL ?? '').host})`
  : '[worker] SPLUNK_HEC_URL sin configurar: no se envían eventos al SIEM');
if (splunk) {
  // Carga inicial: si el último puntaje nunca llegó a Splunk, se encola. Un fallo no detiene el worker.
  await backfillLatestScores(db, { webUrl: config.WARDEN_WEB_URL ?? null })
    .then((n) => { if (n > 0) console.log(`[worker] carga inicial del SIEM: ${n} puntaje(s) encolado(s)`); })
    .catch((err: unknown) => console.warn('[worker] carga inicial del SIEM falló', err instanceof Error ? err.message : err));
}

while (!shutdown.signal.aborted) {
  try {
    // Los escaneos tienen prioridad; los resúmenes, correos y eventos del SIEM se atienden cuando no hay escaneos en cola.
    const didWork = (await pollScanRequests()) || (await pollReportRequests()) || (await pollEmailAlerts()) || (await pollSiemEvents());
    if (!didWork) await sleep(IDLE_DELAY_MS, undefined, { signal: shutdown.signal });
  } catch (err) {
    if (shutdown.signal.aborted) break;
    console.error('[worker] error en el ciclo de la cola', err);
    await sleep(IDLE_DELAY_MS).catch(() => {});
  }
}
