import { GRADES, isWorseGrade, type AlertType, type Grade } from '@warden/shared';
import type { Db } from '../supabase';

export interface AlertDecision {
  type: AlertType;
  previousGrade: Grade | null;
}

/**
 * Regla pura: como mucho una alerta por escaneo.
 * - threshold_crossed: la nota queda peor que el umbral y antes no lo estaba (o es el primer
 *   puntaje). Solo al cruzarlo, para no repetir la alerta en cada escaneo.
 * - grade_drop: la nota baja respecto al escaneo calificado anterior.
 */
export function decideAlert(previous: Grade | null, next: Grade, threshold: Grade | null): AlertDecision | null {
  if (threshold && isWorseGrade(next, threshold) && (!previous || !isWorseGrade(previous, threshold))) {
    return { type: 'threshold_crossed', previousGrade: previous };
  }
  if (previous && isWorseGrade(next, previous)) return { type: 'grade_drop', previousGrade: previous };
  return null;
}

const asGrade = (value: string | null | undefined): Grade | null => {
  const v = value?.trim();
  return v && (GRADES as readonly string[]).includes(v) ? (v as Grade) : null;
};

/** alert_settings.recipients es jsonb: solo cuentan los textos con forma de correo. */
export function emailRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is string => typeof r === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r));
}

/**
 * Registra la alerta del puntaje recién guardado, si corresponde. Se guarda como 'in_app'
 * (visible en la web) y, si hay destinatarios, un envío por correo pendiente en
 * integration_outbox que el worker manda aparte (notify.ts): un SMTP caído no tumba el escaneo.
 */
export async function raiseScoreAlert(
  db: Db,
  score: { id: string; companyId: string; grade: Grade },
): Promise<AlertDecision | null> {
  const [previousRes, settingsRes] = await Promise.all([
    db
      .from('scores')
      .select('grade')
      .eq('company_id', score.companyId)
      .neq('id', score.id)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('alert_settings').select('threshold_grade, recipients').limit(1).maybeSingle(),
  ]);
  if (previousRes.error) throw previousRes.error;
  if (settingsRes.error) throw settingsRes.error;

  const threshold = asGrade(settingsRes.data?.threshold_grade);
  const decision = decideAlert(asGrade(previousRes.data?.grade), score.grade, threshold);
  if (!decision) return null;

  const { data: alert, error } = await db.from('alerts').insert({
    score_id: score.id,
    alert_type: decision.type,
    previous_grade: decision.previousGrade,
    new_grade: score.grade,
    channel: 'in_app',
    sent_at: new Date().toISOString(),
  }).select('id').single();
  if (error) throw error;

  const recipients = emailRecipients(settingsRes.data?.recipients);
  if (recipients.length > 0) {
    const { error: outboxError } = await db.from('integration_outbox').insert({
      destination: 'email',
      event_type: decision.type,
      alert_id: alert.id,
      // Destinatarios y umbral de este momento: cambiarlos después no reescribe avisos ya registrados.
      payload: { recipients, thresholdGrade: decision.type === 'threshold_crossed' ? threshold : null },
    });
    if (outboxError) throw outboxError;
  }
  return decision;
}
