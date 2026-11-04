import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDateTime } from '@/components/dashboard/format';
import { SCAN_STATUS_COLORS, SCAN_STATUS_LABELS } from '@/components/dashboard/scan-status';
import { ScheduleForm } from '@/components/settings/schedule-form';
import { FREQUENCY_LABELS, type Schedule } from '@/lib/schedule';
import { loadScheduleSettings } from '@/lib/schedule-settings';

export const dynamic = 'force-dynamic';

function summary(schedule: Schedule | null): string {
  if (!schedule) return 'Sin programación: los escaneos solo se ejecutan con «Escanear ahora».';
  const base = `${FREQUENCY_LABELS[schedule.frequency]} · próximo ${formatDateTime(schedule.nextRunAt)}`;
  return schedule.isActive ? base : `Pausada (${base.toLowerCase()})`;
}

export default async function ScheduleSettingsPage() {
  const state = await loadScheduleSettings();

  const header = (
    <div>
      <Link href="/settings" className={styles.linkButton}>← Configuración</Link>
      <h1 className={styles.pageTitle}>Programación de escaneos</h1>
      {state.kind === 'ready' && <p className={styles.subtitle}>{summary(state.schedule)}</p>}
    </div>
  );

  if (state.kind === 'no-session') {
    return (
      <div className={styles.page}>
        {header}
        <p className={styles.notice}>Inicia sesión para ver la programación.</p>
      </div>
    );
  }
  if (state.kind === 'no-company') {
    return (
      <div className={styles.page}>
        {header}
        <p className={styles.notice}>
          Registra primero la empresa a evaluar en el <Link href="/">dashboard</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      {state.isAdmin ? (
        <ScheduleForm schedule={state.schedule} />
      ) : (
        <p className={styles.notice}>Solo un administrador puede cambiar la programación.</p>
      )}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Últimos escaneos programados</h2>
            <p className={styles.cardHint}>
              El detalle de cada uno está en <Link href="/scans">Escaneos</Link>.
            </p>
          </div>
        </header>
        {state.recent.length === 0 ? (
          <p className={styles.muted}>Todavía no se ha ejecutado ningún escaneo programado.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Encolado</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {state.recent.map((s) => (
                  <tr key={s.id}>
                    <td>{formatDateTime(s.createdAt)}</td>
                    <td>
                      <span className={styles.pill} style={{ color: SCAN_STATUS_COLORS[s.status] }}>
                        {SCAN_STATUS_LABELS[s.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
