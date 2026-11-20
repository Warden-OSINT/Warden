import type { Confidence } from '@warden/shared';
import { DOMAIN_LABELS, type FindingRow } from '@/lib/dashboard-types';
import styles from './dashboard.module.css';
import { formatDate } from './format';
import { SeverityPill } from './grade-badge';

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: 'alta',
  medium: 'media',
  low: 'baja',
};

export function RecentFindings({ findings }: { findings: FindingRow[] }) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Hallazgos recientes</h2>
          <p className={styles.cardHint}>Indicadores observados, no vulnerabilidades confirmadas</p>
        </div>
      </header>

      <ul className={styles.findingList}>
        {findings.map((f) => (
          <li key={f.id} className={styles.finding}>
            <div className={styles.findingTop}>
              <span>{f.indicator}</span>
              <SeverityPill severity={f.severity} />
            </div>
            <div className={styles.findingMeta}>
              {DOMAIN_LABELS[f.domain]} · {f.source} · confianza {CONFIDENCE_LABELS[f.confidence]} ·{' '}
              {formatDate(f.observedAt)}
            </div>
          </li>
        ))}
      </ul>
      {findings.length === 0 && <p className={styles.empty}>Sin hallazgos abiertos.</p>}
    </section>
  );
}
