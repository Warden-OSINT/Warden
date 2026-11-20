import Link from 'next/link';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDateTime } from '@/components/dashboard/format';
import { SOURCE_RUN_COLORS, SOURCE_RUN_LABELS } from '@/components/dashboard/scan-status';
import { ScoreGauge } from '@/components/dashboard/score-gauge';
import { DOMAIN_LABELS } from '@/lib/dashboard-types';
import type { ReportDetail } from '@/lib/reports';
import { AiSummary } from './ai-summary';
import { alertText } from './alert-text';
import { DomainExplorer } from './domain-explorer';
import { PrintButton } from './print-button';
import own from './reports.module.css';

export function ReportView({ report }: { report: ReportDetail }) {
  const { company } = report;
  return (
    <div className={`${styles.page} ${own.printable}`}>
      <div className={styles.pageHeader}>
        <div>
          <Link href="/reports" className={`${styles.linkButton} ${own.noPrint}`}>
            ← Reportes
          </Link>
          <h1 className={styles.pageTitle}>Reporte de riesgo cibernético</h1>
          <p className={styles.subtitle}>
            {company.name} · {company.primaryDomain} · escaneo del {formatDateTime(report.scanCreatedAt)}
          </p>
        </div>
        <PrintButton />
      </div>

      <section className={styles.card}>
        <div className={own.reportHeader}>
          <div className={own.kri}>
            <ScoreGauge grade={report.grade} score={report.score} size={88} />
            <div>
              <p className={own.kriValue}>{report.score.toFixed(1)} / 100</p>
              <p className={own.kriMeta}>
                KRI global · nota {report.grade}
                {report.delta !== null && report.delta !== 0 && (
                  <> · {report.delta > 0 ? '▲' : '▼'} {Math.abs(report.delta).toFixed(1)} vs. reporte anterior</>
                )}
              </p>
              <p className={own.kriMeta}>
                Pesos v{report.weightVersion ?? '?'} · calculado {formatDateTime(report.computedAt)} · solo información pasiva (OSINT)
              </p>
            </div>
          </div>
          {(report.alerts.length > 0 || report.excludedDomains.length > 0) && (
            <div className={own.headerSide}>
              {report.alerts.length > 0 && (
                <ul className={own.alertList} style={{ color: 'var(--grade-f)' }}>
                  {report.alerts.map((a) => <li key={a.type}>Alerta: {alertText(a)}</li>)}
                </ul>
              )}
              {report.excludedDomains.length > 0 && (
                <p className={styles.notice} style={{ margin: 0 }}>
                  Cobertura parcial: {report.excludedDomains.map((k) => DOMAIN_LABELS[k]).join(', ')} sin datos en este
                  escaneo. Su peso se repartió entre los demás dominios.
                </p>
              )}
            </div>
          )}
        </div>
        <span className={`${styles.tagList} ${own.sourceChips}`} title="Un dominio solo cuenta si alguna de sus fuentes terminó bien">
          {report.sources.map((s) => (
            <span key={s.key} className={styles.tag} style={{ color: SOURCE_RUN_COLORS[s.status] }}>
              {s.name} · {SOURCE_RUN_LABELS[s.status]}
            </span>
          ))}
        </span>
      </section>

      <AiSummary scoreId={report.id} ai={report.ai} />

      <DomainExplorer domains={report.domains} findings={report.openFindings.items} />
    </div>
  );
}
