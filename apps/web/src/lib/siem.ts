// Estado de los envíos a Splunk (integration_outbox, destination = 'siem'). RLS solo deja
// leerlo a un admin; para los demás todo sale vacío.

import { OUTBOX_STATUSES, SIEM_EVENT_TYPES, type OutboxStatus, type SiemEventType } from '@warden/shared';
import { oneOf } from './dashboard-data';
import type { createClient } from './supabase/server';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export interface SiemEventRow {
  id: number;
  type: SiemEventType;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  lastError: string | null;
  /** Nota del evento (score: la del puntaje; alert: la nueva). */
  grade: string | null;
  scoreId: string | null;
}

export interface SiemStatus {
  counts: Record<OutboxStatus, number>;
  lastSentAt: string | null;
  recent: SiemEventRow[];
}

export async function loadSiemStatus(supabase: Supabase, limit = 20): Promise<SiemStatus> {
  const countFor = (status: OutboxStatus) =>
    supabase
      .from('integration_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('destination', 'siem')
      .eq('status', status);

  const [pending, sent, failed, lastSent, recent] = await Promise.all([
    countFor('pending'),
    countFor('sent'),
    countFor('failed'),
    supabase
      .from('integration_outbox')
      .select('sent_at')
      .eq('destination', 'siem')
      .eq('status', 'sent')
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('integration_outbox')
      .select('id, event_type, status, attempts, created_at, sent_at, last_error, score_id, payload')
      .eq('destination', 'siem')
      .order('id', { ascending: false })
      .limit(limit),
  ]);
  for (const res of [pending, sent, failed, lastSent, recent]) if (res.error) throw res.error;

  return {
    counts: { pending: pending.count ?? 0, sent: sent.count ?? 0, failed: failed.count ?? 0 },
    lastSentAt: lastSent.data?.sent_at ?? null,
    recent: (recent.data ?? []).map((row) => {
      const payload = row.payload as { grade?: unknown; new_grade?: unknown };
      const grade = typeof payload.grade === 'string' ? payload.grade : typeof payload.new_grade === 'string' ? payload.new_grade : null;
      return {
        id: row.id,
        type: oneOf(SIEM_EVENT_TYPES, row.event_type, 'score'),
        status: oneOf(OUTBOX_STATUSES, row.status, 'pending'),
        attempts: row.attempts,
        createdAt: row.created_at,
        sentAt: row.sent_at,
        lastError: row.last_error,
        grade,
        scoreId: row.score_id,
      };
    }),
  };
}
