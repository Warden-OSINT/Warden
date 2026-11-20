import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDateTime } from '@/components/dashboard/format';
import { GradeBadge } from '@/components/dashboard/grade-badge';
import type { ReportSummary } from '@/lib/reports';
import { alertText } from './alert-text';

export function ReportList({ reports }: { reports: ReportSummary[] }) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Reportes del KRI</h2>
          <p className={styles.cardHint}>Uno por escaneo calificado · el resumen ejecutivo con IA llegará después</p>
        </div>
      </header>

      {reports.length === 0 ? (
        <p className={styles.empty}>Todavía no hay escaneos calificados. Lanza un escaneo desde el Dashboard.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Escaneo</th>
                <th>Origen</th>
                <th>KRI</th>
                <th>Variación</th>
                <th>Cobertura</th>
                <th>Alertas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.scanCreatedAt)}</td>
                  <td className={styles.muted}>{r.trigger === 'scheduled' ? 'Programado' : 'Manual'}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <GradeBadge grade={r.grade} /> {r.score.toFixed(1)}
                    </span>
                  </td>
                  <td>
                    {r.delta === null || r.delta === 0 ? (
                      <span className={styles.muted}>—</span>
                    ) : (
                      <span style={{ color: r.delta > 0 ? 'var(--grade-a)' : 'var(--grade-f)' }}>
                        {r.delta > 0 ? '▲' : '▼'} {Math.abs(r.delta).toFixed(1)}
                      </span>
                    )}
                  </td>
                  <td className={styles.muted}>
                    {r.excludedDomains.length === 0 ? 'Completa' : `Parcial (${r.excludedDomains.length} sin datos)`}
                  </td>
                  <td>
                    {r.alerts.length === 0 ? (
                      <span className={styles.muted}>—</span>
                    ) : (
                      r.alerts.map((a) => (
                        <span key={a.type} className={styles.pill} style={{ color: 'var(--grade-f)' }}>
                          {alertText(a)}
                        </span>
                      ))
                    )}
                  </td>
                  <td>
                    <Link href={`/reports/${r.id}`} className={styles.linkButton}>
                      Ver reporte
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
