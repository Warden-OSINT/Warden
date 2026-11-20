import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDateTime } from '@/components/dashboard/format';
import type { SiemEventRow, SiemStatus } from '@/lib/siem';
import { SiemRetryButton } from './siem-retry-button';

const TYPE_LABEL: Record<SiemEventRow['type'], string> = { score: 'Calificación', alert: 'Alerta' };

function statusText(e: SiemEventRow): { text: string; color: string } {
  if (e.status === 'sent') return { text: `Enviado${e.sentAt ? ` · ${formatDateTime(e.sentAt)}` : ''}`, color: 'var(--grade-a)' };
  if (e.status === 'failed') return { text: `Falló tras ${e.attempts} intento(s)`, color: 'var(--grade-f)' };
  return { text: e.attempts > 0 ? `Pendiente (reintento ${e.attempts})` : 'Pendiente', color: 'var(--muted)' };
}

export function SiemStatusPanel({ status }: { status: SiemStatus }) {
  const total = status.counts.pending + status.counts.sent + status.counts.failed;
  return (
    <>
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Envíos a Splunk</h2>
            <p className={styles.cardHint}>
              {status.lastSentAt ? `Último envío: ${formatDateTime(status.lastSentAt)}` : 'Aún no se ha enviado ningún evento'}
            </p>
          </div>
          <SiemRetryButton failed={status.counts.failed} />
        </header>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 32 }}>
          {([
            ['Enviados', status.counts.sent, 'var(--grade-a)'],
            ['Pendientes', status.counts.pending, 'var(--text)'],
            ['Fallidos', status.counts.failed, status.counts.failed > 0 ? 'var(--grade-f)' : 'var(--text)'],
          ] as const).map(([label, value, color]) => (
            <div key={label}>
              <p className={styles.statLabel}>{label}</p>
              <p className={styles.statValue} style={{ color }}>{value}</p>
            </div>
          ))}
        </div>
        {total === 0 && (
          <p className={styles.subText} style={{ marginTop: 12 }}>
            Sin eventos todavía. El worker solo los genera si tiene configurado <code>SPLUNK_HEC_URL</code>; al
            arrancar encola el último puntaje y, desde entonces, uno por escaneo calificado.
          </p>
        )}
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Eventos recientes</h2>
            <p className={styles.cardHint}>Últimos {status.recent.length}, del más reciente al más antiguo</p>
          </div>
        </header>
        {status.recent.length === 0 ? (
          <p className={styles.empty}>Sin eventos.</p>
        ) : (
          <ul className={styles.findingList}>
            {status.recent.map((e) => {
              const s = statusText(e);
              return (
                <li key={e.id} className={styles.finding}>
                  <div className={styles.findingTop}>
                    <span>
                      {TYPE_LABEL[e.type]}
                      {e.grade ? ` · nota ${e.grade}` : ''} <span className={styles.muted}>#{e.id}</span>
                    </span>
                    {e.scoreId && (
                      <Link href={`/reports/${e.scoreId}`} className={styles.linkButton}>
                        Ver reporte
                      </Link>
                    )}
                  </div>
                  <p className={styles.findingMeta}>
                    Registrado {formatDateTime(e.createdAt)} · <span style={{ color: s.color }}>{s.text}</span>
                  </p>
                  {e.lastError && e.status !== 'sent' && (
                    <p className={styles.findingMeta} style={{ color: 'var(--grade-f)' }}>{e.lastError}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
