import { GRADES, ALERT_TYPES, type AlertType, type Grade } from '@warden/shared';
import { z } from 'zod';
import type { Db } from '../supabase';
import { buildAlertEmail } from './email-alert';

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Intentos antes de marcar el envío 'failed'. */
export const EMAIL_MAX_ATTEMPTS = 5;
/** Espera tras cada intento fallido, en minutos: un SMTP caído suele volver en minutos u horas. */
export const RETRY_DELAYS_MIN = [1, 5, 15, 60] as const;
const BATCH = 10;
/** Tiempo que un envío reclamado queda apartado; de sobra para una conexión SMTP. */
const LEASE_SECONDS = 120;
const MAX_ERROR_LENGTH = 500;

/** Lo que el worker guarda en integration_outbox.payload al registrar la alerta (alerts.ts). */
export const emailPayloadSchema = z.object({
  recipients: z.array(z.email()).min(1),
  thresholdGrade: z.enum(GRADES).nullable(),
});
export type EmailPayload = z.infer<typeof emailPayloadSchema>;

/** Regla pura: qué hacer tras un intento fallido (`attempts` ya incluye el que falló). */
export function afterFailure(attempts: number, now: Date): { status: 'pending'; nextAttemptAt: Date } | { status: 'failed' } {
  const delay = RETRY_DELAYS_MIN[attempts - 1];
  if (attempts >= EMAIL_MAX_ATTEMPTS || delay === undefined) return { status: 'failed' };
  return { status: 'pending', nextAttemptAt: new Date(now.getTime() + delay * 60_000) };
}

const asGrade = (value: string | null | undefined): Grade | null => {
  const v = value?.trim();
  return v && (GRADES as readonly string[]).includes(v) ? (v as Grade) : null;
};

/**
 * Envía los correos de alerta pendientes. Devuelve cuántos procesó (enviados o fallidos), para
 * que el ciclo del worker sepa si hubo trabajo. Un fallo de un envío no detiene los demás.
 */
export async function deliverEmailAlerts(
  db: Db,
  mailer: Mailer,
  opts: { from: string; webUrl: string | null },
): Promise<number> {
  const { data: claimed, error } = await db.rpc('claim_outbox', {
    p_destination: 'email',
    p_limit: BATCH,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw error;

  for (const row of claimed ?? []) {
    const attempts = row.attempts + 1;
    try {
      const payload = emailPayloadSchema.parse(row.payload);
      if (!row.alert_id) throw new Error('envío sin alerta asociada');
      const { data: alert, error: alertError } = await db
        .from('alerts')
        .select('alert_type, previous_grade, new_grade, scores!inner(id, global_score, computed_at, companies!inner(name, primary_domain))')
        .eq('id', row.alert_id)
        .single();
      if (alertError) throw alertError;

      const email = buildAlertEmail({
        companyName: alert.scores.companies.name,
        primaryDomain: alert.scores.companies.primary_domain,
        type: (ALERT_TYPES as readonly string[]).includes(alert.alert_type) ? (alert.alert_type as AlertType) : 'grade_drop',
        previousGrade: asGrade(alert.previous_grade),
        newGrade: asGrade(alert.new_grade) ?? 'F',
        globalScore: Number(alert.scores.global_score),
        thresholdGrade: payload.thresholdGrade,
        computedAt: alert.scores.computed_at,
        reportUrl: opts.webUrl ? new URL(`/reports/${alert.scores.id}`, opts.webUrl).toString() : null,
      });
      await mailer.send({ from: opts.from, to: payload.recipients, ...email });

      const { error: sentError } = await db
        .from('integration_outbox')
        .update({ status: 'sent', sent_at: new Date().toISOString(), attempts, last_error: null })
        .eq('id', row.id);
      // Ya se envió: si no se marca, el lease vence y se reenviaría. Se registra y se sigue.
      if (sentError) console.error(`[notify] ${row.id} enviado pero no se pudo marcar`, sentError.message);
      console.log(`[notify] alerta ${row.alert_id} enviada a ${payload.recipients.length} destinatario(s)`);
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LENGTH);
      const next = afterFailure(attempts, new Date());
      console.warn(`[notify] ${row.id} intento ${attempts} falló: ${message}`);
      const { error: failError } = await db
        .from('integration_outbox')
        .update({
          attempts,
          last_error: message,
          status: next.status,
          ...(next.status === 'pending' ? { next_attempt_at: next.nextAttemptAt.toISOString() } : {}),
        })
        .eq('id', row.id);
      if (failError) console.error(`[notify] ${row.id} no se pudo registrar el fallo`, failError.message);
    }
  }
  return claimed?.length ?? 0;
}
