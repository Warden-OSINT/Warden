import { SIEM_EVENT_TYPES } from '@warden/shared';
import { z } from 'zod';
import type { Db } from '../supabase';
import { afterFailure } from './notify';

/** Evento en el formato de Splunk HTTP Event Collector (/services/collector/event). */
export interface HecEvent {
  /** Epoch en segundos. */
  time: number;
  host: string;
  source: string;
  sourcetype: string;
  index?: string;
  event: Record<string, unknown>;
}

export interface SiemSender {
  send(event: HecEvent): Promise<void>;
}

/** Error de HEC; `retryable` false cuando reintentar no sirve (evento inválido o demasiado grande). */
export class HecError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'HecError';
  }
}

const BATCH = 10;
/** Cada envío tiene 10 s de timeout; el lease cubre el lote completo con margen. */
const LEASE_SECONDS = 180;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ERROR_LENGTH = 500;
const HEC_PATH = '/services/collector/event';

/** Lo que enqueueSiemEvents guarda en payload; el resto de los campos pasa tal cual. */
const payloadSchema = z.looseObject({
  event_type: z.enum(SIEM_EVENT_TYPES),
  occurred_at: z.iso.datetime({ offset: true }),
});

/** Regla pura: fila del outbox → evento HEC. event_id permite deduplicar reenvíos en Splunk. */
export function toHecEvent(row: { id: number; payload: unknown }, index: string | null): HecEvent {
  const payload = payloadSchema.parse(row.payload);
  return {
    time: Date.parse(payload.occurred_at) / 1000,
    host: 'warden',
    source: 'warden',
    sourcetype: `warden:${payload.event_type}`,
    ...(index ? { index } : {}),
    event: { event_id: row.id, ...payload },
  };
}

/**
 * Regla pura sobre el código HTTP de HEC: 400 (evento mal formado) y 413 (demasiado grande)
 * fallarían igual al reintentar; el resto (token inválido, URL equivocada, 429, 5xx) puede
 * corregirse o pasar, así que se reintenta.
 */
export function isRetryableStatus(status: number): boolean {
  return status !== 400 && status !== 413;
}

/** Acepta la URL base (https://splunk:8088) o la del endpoint completo. */
export function hecEndpoint(url: string): string {
  const u = new URL(url);
  if (!u.pathname.endsWith(HEC_PATH)) u.pathname = u.pathname.replace(/\/+$/, '') + HEC_PATH;
  return u.toString();
}

export function createHecSender(opts: { url: string; token: string; fetch?: typeof fetch }): SiemSender {
  const endpoint = hecEndpoint(opts.url);
  const doFetch = opts.fetch ?? fetch;
  return {
    async send(event) {
      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Splunk ${opts.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event),
          redirect: 'error',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (err) {
        throw new HecError(`Splunk no respondió: ${err instanceof Error ? err.message : String(err)}`, true);
      }
      if (res.ok) return;
      // HEC responde {"text": "...", "code": n}; el token nunca va en el mensaje.
      const body = await res.text().catch(() => '');
      throw new HecError(`HEC ${res.status}: ${body.slice(0, 200)}`, isRetryableStatus(res.status));
    },
  };
}

/**
 * Envía los eventos del SIEM pendientes, uno por petición (son pocos por escaneo y así un
 * evento inválido no arrastra a los demás). Devuelve cuántos procesó.
 */
export async function deliverSiemEvents(db: Db, sender: SiemSender, opts: { index: string | null }): Promise<number> {
  const { data: claimed, error } = await db.rpc('claim_outbox', {
    p_destination: 'siem',
    p_limit: BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw error;

  for (const row of claimed ?? []) {
    const attempts = row.attempts + 1;
    try {
      await sender.send(toHecEvent(row, opts.index));
      const { error: sentError } = await db
        .from('integration_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), attempts, last_error: null })
        .eq('id', row.id);
      // Ya se envió: si no se marca, se reenviaría al vencer el lease (Splunk deduplica por event_id).
      if (sentError) console.error(`[siem] ${row.id} enviado pero no se pudo marcar`, sentError.message);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LENGTH);
      // Un payload inválido o un rechazo definitivo de HEC no mejora al reintentar.
      const retryable = err instanceof HecError ? err.retryable : !(err instanceof z.ZodError);
      const next = retryable ? afterFailure(attempts, new Date()) : { status: 'failed' as const };
      console.warn(`[siem] ${row.id} intento ${attempts} falló: ${message}`);
      const { error: failError } = await db
        .from('integration_outbox')
        .update({
          attempts,
          last_error: message,
          status: next.status,
          ...(next.status === 'pending' ? { next_attempt_at: next.nextAttemptAt.toISOString() } : {}),
        })
        .eq('id', row.id);
      if (failError) console.error(`[siem] ${row.id} no se pudo registrar el fallo`, failError.message);
    }
  }
  return claimed?.length ?? 0;
}
