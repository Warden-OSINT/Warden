import type { ReactNode } from 'react';
import styles from './dashboard.module.css';

interface StatCardProps {
  label: ReactNode;
  value: string | number;
  hint?: string;
  /** Elemento opcional a la derecha, p. ej. un ScoreGauge. */
  aside?: ReactNode;
}

export function StatCard({ label, value, hint, aside }: StatCardProps) {
  return (
    <section className={`${styles.card} ${styles.stat}`}>
      <div>
        <p className={styles.statLabel}>{label}</p>
        <p className={styles.statValue}>{value}</p>
        {hint && <p className={styles.statHint}>{hint}</p>}
      </div>
      {aside}
    </section>
  );
}
