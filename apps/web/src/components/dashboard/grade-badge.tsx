import type { Grade, Severity } from '@warden/shared';
import styles from './dashboard.module.css';

export const GRADE_COLORS: Record<Grade, string> = {
  A: 'var(--grade-a)',
  B: 'var(--grade-b)',
  C: 'var(--grade-c)',
  D: 'var(--grade-d)',
  E: 'var(--grade-e)',
  F: 'var(--grade-f)',
};

export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: 'var(--severity-critical)',
  high: 'var(--severity-high)',
  medium: 'var(--severity-medium)',
  low: 'var(--severity-low)',
  info: 'var(--severity-info)',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  info: 'Info',
};

export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span className={styles.badge} style={{ background: GRADE_COLORS[grade] }}>
      {grade}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return (
    <span className={styles.pill} style={{ color: SEVERITY_COLORS[severity] }}>
      {SEVERITY_LABELS[severity]}
    </span>
  );
}
