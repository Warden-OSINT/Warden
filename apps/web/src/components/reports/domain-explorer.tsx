'use client';

import { SEVERITIES, type Confidence, type RiskDomainKey } from '@warden/shared';
import { useState } from 'react';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDate } from '@/components/dashboard/format';
import { GRADE_COLORS, GradeBadge, SeverityPill } from '@/components/dashboard/grade-badge';
import { DOMAIN_LABELS } from '@/lib/dashboard-types';
import type { ReportDomain, ReportFinding } from '@/lib/reports';
import own from './reports.module.css';

const CONFIDENCE_LABELS: Record<Confidence, string> = { high: 'alta', medium: 'media', low: 'baja' };

export function DomainExplorer({ domains, findings }: { domains: ReportDomain[]; findings: ReportFinding[] }) {
  // null = todos los dominios. Pulsar el dominio ya elegido lo deselecciona.
  const [selected, setSelected] = useState<RiskDomainKey | null>(null);
  const visible = selected ? findings.filter((f) => f.domain === selected) : findings;
  const counts = SEVERITIES.map((s) => [s, visible.filter((f) => f.severity === s).length] as const).filter(([, n]) => n > 0);

  return (
    // Fragmento: las dos tarjetas son hijas de la página y ocupan todo el ancho, una bajo la otra.
    <>
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Riesgo por dominio</h2>
            <p className={styles.cardHint}>Nota de este escaneo y peso en el KRI · elige un dominio para filtrar los hallazgos de abajo; púlsalo otra vez para ver todos</p>
          </div>
        </header>
        <ul className={`${styles.domainList} ${own.domainPicker}`}>
          {domains.map((d) => (
            <li key={d.key}>
              <button
                type="button"
                className={`${own.domainButton} ${d.key === selected ? own.domainSelected : ''}`}
                aria-pressed={d.key === selected}
                aria-label={`Filtrar hallazgos por ${DOMAIN_LABELS[d.key]}`}
                onClick={() => setSelected((current) => (current === d.key ? null : d.key))}
              >
                {/* Un botón solo admite contenido en línea: spans con display de bloque. */}
                <span className={styles.domainTop}>
                  <span>
                    {DOMAIN_LABELS[d.key]} {d.weight !== null && <span className={styles.domainMeta}>· {d.weight}%</span>}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={styles.domainMeta}>
                      {d.score !== null ? `${d.score.toFixed(1)} · ${d.findingsCount} hallazgos` : 'sin datos'}
                    </span>
                    {d.grade && <GradeBadge grade={d.grade} />}
                  </span>
                </span>
                <span className={`${styles.bar} ${own.block}`}>
                  {d.score !== null && d.grade !== null && (
                    <span
                      className={`${styles.barFill} ${own.block}`}
                      style={{ width: `${d.score}%`, background: GRADE_COLORS[d.grade] }}
                    />
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={own.panelTitle}>Hallazgos · {selected ? DOMAIN_LABELS[selected] : 'Todos los dominios'}</h2>
            <p className={styles.cardHint}>
              {visible.length === 0
                ? selected ? 'Sin hallazgos abiertos en este dominio' : 'Sin hallazgos abiertos'
                : `${visible.length} abiertos · estado actual, de más a menos severo`}
            </p>
          </div>
          <span className={own.severityRow}>
            {counts.map(([s, n]) => (
              <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <SeverityPill severity={s} /> {n}
              </span>
            ))}
          </span>
        </header>
        {visible.length === 0 ? (
          <p className={styles.empty}>Nada pendiente aquí.</p>
        ) : (
          <div className={`${styles.tableWrap} ${own.findingsScroll}`}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Severidad</th>
                  <th>Dominio</th>
                  <th>Estado</th>
                  <th>Observado</th>
                  <th>Hallazgo</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((f) => (
                  <tr key={f.id}>
                    <td><SeverityPill severity={f.severity} /></td>
                    <td className={styles.muted}>{DOMAIN_LABELS[f.domain]}</td>
                    <td>
                      <span className={styles.pill} style={{ color: 'var(--grade-d)' }}>Abierto</span>
                    </td>
                    <td className={styles.muted} style={{ whiteSpace: 'nowrap' }}>{formatDate(f.observedAt)}</td>
                    <td>
                      {f.title}
                      <div className={styles.subText}>
                        {[f.sources.join(', ') || null, `confianza ${CONFIDENCE_LABELS[f.confidence]}`, f.asset]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
