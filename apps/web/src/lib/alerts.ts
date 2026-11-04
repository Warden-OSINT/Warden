// Alertas que el worker registra al calificar (pipeline/alerts.ts).

import { ALERT_TYPES, OUTBOX_STATUSES, type OutboxStatus } from '@warden/shared';
import { asGrade, oneOf } from './dashboard-data';
import type { ReportAlert } from './reports';
import type { createClient } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface AlertRow extends ReportAlert {
  id: string;
  /** Reporte (score) que la disparó. */
  scoreId: string;
  score: number;
  at: string;
}

/**
 * Alertas más recientes. alerts no tiene fecha propia: se parte de los puntajes con alerta
 * (alerts!inner), ordenados por computed_at, para que el límite corte por fecha.
 */
export async function loadRecentAlerts(supabase: Supabase, companyId: string, limit: number): Promise<AlertRow[]> {
  const { data, error } = await supabase
    .from('scores')
    .select('id, global_score, computed_at, alerts!inner(id, alert_type, previous_grade, new_grade)')
    .eq('company_id', companyId)
    .order('computed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data.flatMap((s) =>
    s.alerts.map((a) => ({
      id: a.id,
      type: oneOf(ALERT_TYPES, a.alert_type, 'grade_drop'),
      previousGrade: a.previous_grade ? asGrade(a.previous_grade) : null,
      newGrade: asGrade(a.new_grade),
      scoreId: s.id,
      score: Number(s.global_score),
      at: s.computed_at,
    })),
  );
}

export interface EmailDelivery {
  status: OutboxStatus;
  attempts: number;
  sentAt: string | null;
  lastError: string | null;
  recipients: number;
}

/**
 * Estado del envío por correo de cada alerta (integration_outbox). RLS solo deja leerlo a un
 * admin: para los demás el mapa queda vacío y la lista no muestra la columna.
 */
export async function loadEmailDeliveries(supabase: Supabase, alertIds: string[]): Promise<Map<string, EmailDelivery>> {
  if (alertIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('integration_outbox')
    .select('alert_id, status, attempts, sent_at, last_error, payload')
    .eq('destination', 'email')
    .in('alert_id', alertIds);
  if (error) throw error;
  return new Map(
    data.flatMap((row) => {
      if (!row.alert_id) return [];
      const payload = row.payload as { recipients?: unknown };
      return [[row.alert_id, {
        status: oneOf(OUTBOX_STATUSES, row.status, 'pending'),
        attempts: row.attempts,
        sentAt: row.sent_at,
        lastError: row.last_error,
        recipients: Array.isArray(payload.recipients) ? payload.recipients.length : 0,
      }] as const];
    }),
  );
}
