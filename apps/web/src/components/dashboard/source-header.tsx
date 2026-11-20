import type { ScanSourceStatus } from '@warden/shared';
import type { SourceStatus } from '@/lib/dashboard-types';
import styles from './dashboard.module.css';
import { SourceToggle } from './source-toggle';

const RUN_LABELS: Record<ScanSourceStatus, string> = {
  ok: 'Último escaneo correcto',
  failed: 'Falló en el último escaneo',
  skipped: 'Omitida en el último escaneo',
  blocked: 'Bloqueada por la compuerta no-contact',
};

const RUN_COLORS: Record<ScanSourceStatus, string> = {
  ok: 'var(--grade-a)',
  failed: 'var(--grade-f)',
  skipped: 'var(--muted)',
  blocked: 'var(--grade-f)',
};

/** Chip con el resultado de la última corrida y, para admin, el botón de habilitar. */
export function SourceRunActions({ source, isAdmin }: { source: SourceStatus; isAdmin: boolean }) {
  return (
    <span className={styles.inlineActions}>
      {source.lastRun && (
        <span
          className={styles.chip}
          style={{ color: RUN_COLORS[source.lastRun.status] }}
          title={source.lastRun.message ?? undefined}
        >
          {RUN_LABELS[source.lastRun.status]}
        </span>
      )}
      {isAdmin && <SourceToggle sourceKey={source.sourceKey} enabled={source.enabled} />}
    </span>
  );
}

/** Avisos comunes: fuente sin registrar, deshabilitada o fallida en la última corrida. */
export function SourceNotices({
  source,
  isAdmin,
  disabledHint,
}: {
  source: SourceStatus | null;
  isAdmin: boolean;
  disabledHint?: string;
}) {
  if (!source) {
    return <p className={styles.notice}>La fuente no está registrada en la BD (¿falta el seed?).</p>;
  }
  return (
    <>
      {!source.enabled && (
        <p className={styles.notice}>
          La fuente está deshabilitada. {isAdmin ? 'Habilítala y lanza un escaneo.' : 'Pide a un admin que la habilite.'}
          {disabledHint && ` ${disabledHint}`}
        </p>
      )}
      {source.lastRun?.status === 'failed' && source.lastRun.message && (
        <p className={styles.notice} style={{ color: 'var(--grade-f)' }}>
          {source.lastRun.message}
        </p>
      )}
    </>
  );
}
