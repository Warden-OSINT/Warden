import type { Db } from '../supabase';

/**
 * Mientras se procesa un mensaje, renueva su invisibilidad cada tercio del timeout: un
 * escaneo largo (p. ej. gitleaks con muchos repos) supera el timeout y, sin esto, el mensaje
 * reaparecería en la cola y otro worker procesaría el mismo escaneo en paralelo. Si el
 * worker muere, el latido se detiene y el mensaje reaparece como antes.
 */
export function keepInvisible(db: Db, queue: string, msgId: number, visibilityTimeoutS: number) {
  const intervalMs = Math.max(1, Math.floor(visibilityTimeoutS / 3)) * 1000;
  const beat = async () => {
    const { error } = await db.rpc('queue_set_vt', { p_queue: queue, p_msg_id: msgId, p_visibility_timeout: visibilityTimeoutS });
    if (error) throw error;
  };
  const timer = setInterval(() => {
    // Un latido perdido no es grave: el siguiente lo renueva antes de que venza.
    beat().catch((err) => console.warn(`[queue] ${queue}/${msgId} no se pudo extender la visibilidad`, err));
  }, intervalMs);
  return { stop: () => clearInterval(timer) };
}
