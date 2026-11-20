// Programación de escaneos (schedules). La lee cualquier miembro; solo un admin la edita
// (política "admins manage"). pg_cron revisa cada 15 min con enqueue_due_scans().

import { loadActiveCompany } from './dashboard-data';
import type { ScanStatus } from '@warden/shared';
import type { Schedule, ScheduledScan, ScheduleFrequency } from './schedule';
import { createClient } from './supabase/server';

const RECENT_SCHEDULED = 5;

export type ScheduleSettingsState =
  | { kind: 'no-session' }
  | { kind: 'no-company'; isAdmin: boolean }
  | { kind: 'ready'; isAdmin: boolean; schedule: Schedule | null; recent: ScheduledScan[] };

export async function loadScheduleSettings(): Promise<ScheduleSettingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'no-session' };

  const [{ data: isAdmin }, company] = await Promise.all([supabase.rpc('is_admin'), loadActiveCompany(supabase)]);
  if (!company) return { kind: 'no-company', isAdmin: isAdmin === true };

  const [scheduleRes, recentRes] = await Promise.all([
    supabase.from('schedules').select('frequency, next_run_at, is_active').eq('company_id', company.id).maybeSingle(),
    supabase
      .from('scans')
      .select('id, status, created_at')
      .eq('company_id', company.id)
      .eq('trigger_type', 'scheduled')
      .order('created_at', { ascending: false })
      .limit(RECENT_SCHEDULED),
  ]);
  if (scheduleRes.error) throw scheduleRes.error;
  if (recentRes.error) throw recentRes.error;

  const row = scheduleRes.data;
  return {
    kind: 'ready',
    isAdmin: isAdmin === true,
    schedule: row
      ? {
          // frequency es text en BD; el CHECK garantiza que sea weekly o monthly.
          frequency: row.frequency as ScheduleFrequency,
          nextRunAt: row.next_run_at,
          isActive: row.is_active,
        }
      : null,
    // status es text en BD; el CHECK garantiza que sea un ScanStatus.
    recent: recentRes.data.map((s) => ({ id: s.id, status: s.status as ScanStatus, createdAt: s.created_at })),
  };
}
