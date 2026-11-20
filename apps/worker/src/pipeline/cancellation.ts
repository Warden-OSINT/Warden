import type { Db } from '../supabase';

export class ScanCancelledError extends Error {
  constructor() {
    super('escaneo cancelado por un usuario');
    this.name = 'ScanCancelledError';
  }
}

export function isCancellation(err: unknown): boolean {
  return err instanceof ScanCancelledError;
}

/**
 * Revisa cada `intervalMs` si alguien canceló el escaneo (cancel_scan pone status =
 * 'cancelled'). Al detectarlo aborta `signal`: los colectores lo reciben en ctx.signal y
 * cortan las consultas en vuelo, así que no hay que esperar a que terminen sus timeouts.
 */
export function watchCancellation(db: Db, scanId: string, intervalMs = 3000) {
  const controller = new AbortController();
  const check = async () => {
    const { data, error } = await db.from('scans').select('status').eq('id', scanId).maybeSingle();
    // Un error de lectura no cancela: se reintenta en la siguiente vuelta.
    if (!error && data?.status === 'cancelled') controller.abort(new ScanCancelledError());
  };
  const timer = setInterval(() => {
    check().catch((err) => console.warn(`[cancel] ${scanId} no se pudo revisar el estado`, err));
  }, intervalMs);
  return {
    signal: controller.signal,
    /** Revisión inmediata, para los puntos donde no conviene esperar al intervalo. */
    async checkNow() {
      await check();
      controller.signal.throwIfAborted();
    },
    stop: () => clearInterval(timer),
  };
}
