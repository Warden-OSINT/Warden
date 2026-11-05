import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDateTime } from '@/components/dashboard/format';
import { GradeBadge } from '@/components/dashboard/grade-badge';
import type { AlertRow, EmailDelivery } from '@/lib/alerts';
import { alertText } from './alert-text';

function deliveryText(d: EmailDelivery): { text: string; color: string } {
  if (d.status === 'sent') {
    const to = `${d.recipients} destinatario${d.recipients === 1 ? '' : 's'}`;
    return { text: `Correo enviado a ${to}${d.sentAt ? ` · ${formatDateTime(d.sentAt)}` : ''}`, color: 'var(--grade-a)' };
  }
  if (d.status === 'failed') return { text: `Correo no enviado tras ${d.attempts} intentos: ${d.lastError ?? 'error'}`, color: 'var(--grade-f)' };
  return {
    text: d.attempts > 0 ? `Correo pendiente (reintento ${d.attempts}): ${d.lastError ?? ''}` : 'Correo pendiente de envío',
    color: 'var(--muted)',
  };
}

export function AlertList({
  alerts,
  title,
  hint,
  deliveries,
}: {
  alerts: AlertRow[];
  title: string;
  hint: string;
  /** Solo admin (RLS de integration_outbox): estado del envío por correo de cada alerta. */
  deliveries?: Map<string, EmailDelivery>;
}) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          <p className={styles.cardHint}>{hint}</p>
        </div>
        {alerts.length > 0 && (
          <span className={styles.chip} style={{ color: 'var(--grade-f)' }}>
            {alerts.length}
          </span>
        )}
      </header>
      {alerts.length === 0 ? (
        <p className={styles.empty}>Sin alertas: la nota no ha bajado.</p>
      ) : (
        <ul className={styles.findingList}>
          {alerts.map((a) => (
            <li key={a.id} className={styles.finding}>
              <div className={styles.findingTop}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <GradeBadge grade={a.newGrade} /> {alertText(a)}
                </span>
                <Link href={`/reports/${a.scoreId}`} className={styles.linkButton}>
                  Ver reporte
                </Link>
              </div>
              <p className={styles.findingMeta}>
                KRI {a.score.toFixed(1)} · {formatDateTime(a.at)}
              </p>
              {deliveries?.get(a.id) && (
                <p className={styles.findingMeta} style={{ color: deliveryText(deliveries.get(a.id)!).color }}>
                  {deliveryText(deliveries.get(a.id)!).text}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
