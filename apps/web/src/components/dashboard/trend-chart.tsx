import { GRADE_THRESHOLDS, type Grade } from '@warden/shared';
import type { TrendPoint } from '@/lib/dashboard-types';
import styles from './dashboard.module.css';
import { formatDate } from './format';
import { GRADE_COLORS } from './grade-badge';
import chart from './trend-chart.module.css';

// Bandas de cada nota en la escala fija 0–100 (A arriba, F de 0 a 50).
const BANDS: { grade: Grade; from: number; to: number }[] = [
  ...GRADE_THRESHOLDS.map(([grade, min], i) => ({ grade, from: min, to: GRADE_THRESHOLDS[i - 1]?.[1] ?? 100 })),
  { grade: 'F', from: 0, to: GRADE_THRESHOLDS.at(-1)?.[1] ?? 50 },
];
const Y_TICKS = [0, ...GRADE_THRESHOLDS.map(([, min]) => min).reverse(), 100];

// Escala fija 0–100: la altura de cada barra es el KRI y su color, la nota guardada.
export function TrendChart({ points }: { points: TrendPoint[] }) {
  const first = points[0]?.score ?? 0;
  const last = points.at(-1)?.score ?? 0;
  const delta = last - first;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Tendencia del KRI</h2>
          <p className={styles.cardHint}>
            KRI global (0–100) por escaneo calificado · últimos {points.length}
          </p>
        </div>
        {points.length > 1 && (
          <span className={styles.chip} style={{ color: delta >= 0 ? 'var(--grade-a)' : 'var(--grade-f)' }}>
            {delta >= 0 ? '+' : ''}
            {delta.toFixed(1)} pts
          </span>
        )}
      </header>

      {points.length === 0 ? (
        <p className={styles.empty}>Sin puntajes todavía: aparecerán al completarse un escaneo.</p>
      ) : (
        <div className={chart.chart} role="img" aria-label={trendDescription(points)}>
          <div className={chart.yAxis} aria-hidden>
            {Y_TICKS.map((t) => (
              <span key={t} className={chart.yLabel} style={{ bottom: `${t}%` }}>
                {t}
              </span>
            ))}
          </div>

          <div className={chart.plot} aria-hidden>
            {BANDS.map((b) => (
              <div
                key={b.grade}
                className={chart.band}
                style={{
                  bottom: `${b.from}%`,
                  height: `${b.to - b.from}%`,
                  background: `color-mix(in srgb, ${GRADE_COLORS[b.grade]} 7%, transparent)`,
                }}
              >
                <span className={chart.bandLetter} style={{ color: GRADE_COLORS[b.grade] }}>
                  {b.grade}
                </span>
              </div>
            ))}
            {GRADE_THRESHOLDS.map(([grade, min]) => (
              <div key={grade} className={chart.gridLine} style={{ bottom: `${min}%` }} />
            ))}

            <div className={chart.columns}>
              {points.map((p) => (
                <div key={p.scannedAt} className={chart.column} title={`${formatDate(p.scannedAt)}: ${p.score.toFixed(1)} (${p.grade})`}>
                  <span className={chart.value} style={{ color: GRADE_COLORS[p.grade] }}>
                    {p.score.toFixed(1)}
                  </span>
                  <div className={chart.bar} style={{ height: `${Math.max(p.score, 1)}%`, background: GRADE_COLORS[p.grade] }} />
                </div>
              ))}
            </div>
          </div>

          <div className={chart.xAxis} aria-hidden>
            {points.map((p) => (
              <span key={p.scannedAt} className={chart.xLabel}>
                {formatDate(p.scannedAt)}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function trendDescription(points: TrendPoint[]): string {
  return `Tendencia del KRI: ${points.map((p) => `${formatDate(p.scannedAt)} ${p.score.toFixed(1)} (${p.grade})`).join(', ')}`;
}
