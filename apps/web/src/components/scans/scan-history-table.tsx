import { Fragment } from 'react';
import { formatDateTime } from '@/components/dashboard/format';
import styles from '@/components/dashboard/dashboard.module.css';
import { GradeBadge } from '@/components/dashboard/grade-badge';
import { scanDisplayStatus, SOURCE_RUN_COLORS, SOURCE_RUN_LABELS } from '@/components/dashboard/scan-status';
import { isSourceFailure } from '@/lib/dashboard-data';
import { DOMAIN_LABELS } from '@/lib/dashboard-types';
import type { ScanHistoryRow, ScanScore, ScanSourceRun } from '@/lib/scan-history';

export function ScanHistoryTable({ scans }: { scans: ScanHistoryRow[] }) {
  const withFailures = scans.filter(hasFailures).length;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Historial</h2>
          <p className={styles.cardHint}>
            Últimos {scans.length} escaneos · una fuente que falla no tumba el escaneo, pero no aporta datos
          </p>
        </div>
        {withFailures > 0 && (
          <span className={styles.chip} style={{ color: 'var(--grade-f)' }}>
            {withFailures} con fallos
          </span>
        )}
      </header>

      {scans.length === 0 ? (
        <p className={styles.empty}>Todavía no hay escaneos.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.historyTable}`}>
            <thead>
              <tr>
                <th>Solicitado</th>
                <th>Origen</th>
                <th>Estado</th>
                <th>KRI</th>
                <th>Duración</th>
                <th>Fuentes</th>
              </tr>
            </thead>
            <tbody>
              {scans.map((s) => {
                const errors = [
                  ...(s.errorMessage ? [{ key: 'scan', label: 'Escaneo', message: s.errorMessage }] : []),
                  ...s.sources
                    .filter((r) => isSourceFailure(r.status))
                    .map((r) => ({ key: r.sourceKey, label: r.name, message: r.message ?? 'sin detalle' })),
                ];
                const status = scanDisplayStatus(s.status, s.sources.some((r) => isSourceFailure(r.status)));
                return (
                  <Fragment key={s.id}>
                    <tr className={errors.length > 0 ? styles.hasDetail : undefined}>
                      <td>{formatDateTime(s.createdAt)}</td>
                      <td className={styles.muted}>{s.trigger === 'scheduled' ? 'Programado' : 'Manual'}</td>
                      <td>
                        <span className={styles.pill} style={{ color: status.color }}>
                          {status.label}
                        </span>
                      </td>
                      <td>{s.score ? <ScoreCell score={s.score} /> : <span className={styles.muted}>—</span>}</td>
                      <td className={styles.muted}>{duration(s.startedAt, s.finishedAt)}</td>
                      <td>
                        <span className={styles.tagList}>
                          {s.sources.map((r) => (
                            <span
                              key={r.sourceKey}
                              className={styles.tag}
                              style={{ color: SOURCE_RUN_COLORS[r.status] }}
                              title={r.message ?? undefined}
                            >
                              {r.name} · {r.status === 'ok' ? runSummary(r) : SOURCE_RUN_LABELS[r.status]}
                            </span>
                          ))}
                          {s.status === 'running' && (
                            <span className={styles.tag} style={{ color: 'var(--accent)' }}>
                              <span className={styles.spinner} aria-hidden />{' '}
                              {s.currentSource ? `Consultando ${s.currentSource}…` : 'Preparando…'}
                              {s.sourcesTotal ? ` (${s.sources.length}/${s.sourcesTotal})` : ''}
                            </span>
                          )}
                          {s.sources.length === 0 && s.status !== 'running' && <span className={styles.muted}>—</span>}
                        </span>
                      </td>
                    </tr>
                    {errors.length > 0 && (
                      <tr className={styles.detailRow}>
                        <td colSpan={6}>
                          {errors.map((e) => (
                            <div key={e.key}>
                              <strong>{e.label}:</strong> {e.message}
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Nota, puntaje y variación; el detalle por dominio va en el tooltip. */
function ScoreCell({ score }: { score: ScanScore }) {
  const detail = [
    ...score.domains.map((d) => `${DOMAIN_LABELS[d.key]}: ${d.grade} (${d.score.toFixed(1)})`),
    ...score.excludedDomains.map((key) => `${DOMAIN_LABELS[key]}: sin datos`),
  ].join('\n');
  return (
    <span title={detail} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <GradeBadge grade={score.grade} />
      <span>{score.score.toFixed(1)}</span>
      {score.delta !== null && score.delta !== 0 && (
        <span className={styles.muted} style={{ color: score.delta > 0 ? 'var(--grade-a)' : 'var(--grade-f)' }}>
          {score.delta > 0 ? '▲' : '▼'} {Math.abs(score.delta).toFixed(1)}
        </span>
      )}
      {score.excludedDomains.length > 0 && <span className={styles.muted}>· parcial</span>}
    </span>
  );
}

function hasFailures(s: ScanHistoryRow): boolean {
  return s.status === 'failed' || s.sources.some((r) => isSourceFailure(r.status));
}

/** "1 activo · 0 hallazgos · 1 IP de CDN"; las filas previas al desglose solo tienen el total. */
function runSummary(r: ScanSourceRun): string {
  if (r.assetsReturned === 0 && r.findingsReturned === 0 && r.itemsReturned > 0) {
    return `${r.itemsReturned} resultados`;
  }
  const parts = [
    plural(r.assetsReturned, 'activo', 'activos'),
    plural(r.findingsReturned, 'hallazgo', 'hallazgos'),
  ];
  if (r.cdnCount > 0) parts.push(plural(r.cdnCount, 'IP de CDN', 'IPs de CDN'));
  return parts.join(' · ');
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function duration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt || !finishedAt) return '—';
  const seconds = (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}
