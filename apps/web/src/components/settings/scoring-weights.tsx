'use client';

import { CONFIDENCES, RISK_DOMAIN_KEYS, SEVERITIES, type Confidence, type Severity } from '@warden/shared';
import { useActionState, useState, useTransition } from 'react';
import { activateWeightVersion, createWeightVersion, type ActionResult } from '@/app/(dashboard)/settings/actions';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDateTime } from '@/components/dashboard/format';
import { InfoTip } from '@/components/info-tip';
import { DOMAIN_DESCRIPTIONS, DOMAIN_LABELS, SCORING_HELP } from '@/lib/dashboard-types';
import type { WeightVersion } from '@/lib/scoring-settings';
import own from './settings.module.css';

const SEVERITY_LABELS: Record<Severity, string> = { critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja', info: 'Info' };
const CONFIDENCE_LABELS: Record<Confidence, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };

export function ScoringWeights({ versions, isAdmin }: { versions: WeightVersion[]; isAdmin: boolean }) {
  const active = versions.find((v) => v.isActive) ?? versions[0];
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(createWeightVersion, {});
  const [activation, setActivation] = useState<ActionResult>({});
  const [activating, startActivation] = useTransition();
  const [weights, setWeights] = useState(() =>
    Object.fromEntries(RISK_DOMAIN_KEYS.map((k) => [k, String(active?.weights[k] ?? 0)])),
  );
  const total = RISK_DOMAIN_KEYS.reduce((sum, k) => sum + (Number(weights[k]) || 0), 0);
  const totalOk = Math.abs(total - 100) < 0.01;

  return (
    <>
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Versiones de pesos</h2>
            <p className={styles.cardHint}>
              Cada escaneo guarda la versión con la que se calificó; activar otra solo afecta a los escaneos nuevos
            </p>
          </div>
        </header>
        {activation.error && <p className={styles.error}>{activation.error}</p>}
        {activation.ok && <p className={styles.notice}>{activation.ok}</p>}
        {versions.length === 0 ? (
          <p className={styles.empty}>No hay versiones de pesos: los escaneos no se califican.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={`${styles.table} ${own.versionsTable}`}>
              <thead>
                <tr>
                  <th>Versión</th>
                  {RISK_DOMAIN_KEYS.map((k) => (
                    <th key={k}>
                      <InfoTip tip={DOMAIN_DESCRIPTIONS[k]}>{DOMAIN_LABELS[k]}</InfoTip>
                    </th>
                  ))}
                  <th>
                    <InfoTip tip={<>{SCORING_HELP.severityPoints} {SCORING_HELP.severityOrder}</>}>
                      Puntos por severidad
                    </InfoTip>
                  </th>
                  <th>
                    <InfoTip tip={<>{SCORING_HELP.confidenceFactors} {SCORING_HELP.confidenceOrder}</>}>
                      Factor por confianza
                    </InfoTip>
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id}>
                    <td>
                      v{v.version}{' '}
                      {v.isActive && <span className={styles.pill} style={{ color: 'var(--grade-a)' }}>Activa</span>}
                      <div className={styles.subText}>{formatDateTime(v.effectiveFrom)}</div>
                    </td>
                    {RISK_DOMAIN_KEYS.map((k) => <td key={k}>{v.weights[k]}%</td>)}
                    <td
                      className={own.values}
                      title={SEVERITIES.map((s) => `${SEVERITY_LABELS[s]}: ${v.severityPoints[s]}`).join(' · ')}
                    >
                      {SEVERITIES.map((s) => v.severityPoints[s]).join(' · ')}
                    </td>
                    <td
                      className={own.values}
                      title={CONFIDENCES.map((c) => `${CONFIDENCE_LABELS[c]}: ${v.confidenceFactors[c]}`).join(' · ')}
                    >
                      {CONFIDENCES.map((c) => v.confidenceFactors[c]).join(' · ')}
                    </td>
                    <td>
                      {isAdmin && !v.isActive && (
                        <button
                          type="button"
                          className={styles.buttonGhost}
                          disabled={activating}
                          onClick={() => startActivation(async () => setActivation(await activateWeightVersion(v.id)))}
                        >
                          Activar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isAdmin && (
        <section className={styles.card}>
          <header className={styles.cardHeader}>
            <div>
              <h2 className={styles.cardTitle}>Nueva versión</h2>
              <p className={styles.cardHint}>Parte de los valores de la versión activa</p>
            </div>
          </header>
          <form action={formAction}>
            {state.error && <p className={styles.error}>{state.error}</p>}
            {state.ok && <p className={styles.notice}>{state.ok}</p>}

            <div className={own.section}>
              <div className={own.sectionHead}>
                <h3 className={own.sectionTitle}>
                  <InfoTip tip={SCORING_HELP.weight}>Peso por dominio (%)</InfoTip>
                </h3>
                <span className={own.sum}>
                  Suma{' '}
                  <strong style={{ color: totalOk ? 'var(--grade-a)' : 'var(--grade-f)' }}>{total}</strong> de 100
                </span>
              </div>
              <div className={own.inputGrid}>
                {RISK_DOMAIN_KEYS.map((k) => (
                  <label key={k} className={own.inputField}>
                    {DOMAIN_LABELS[k]}
                    <input
                      className={styles.input}
                      name={`weight.${k}`}
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={weights[k]}
                      onChange={(e) => setWeights({ ...weights, [k]: e.target.value })}
                      required
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className={own.section}>
              <div className={own.sectionHead}>
                <h3 className={own.sectionTitle}>
                  <InfoTip tip={<>{SCORING_HELP.severityPoints} Info no resta por defecto.</>}>Puntos por severidad</InfoTip>
                </h3>
                <p className={own.sectionHint}>Más puntos = el hallazgo baja más la nota</p>
              </div>
              <div className={own.inputGrid}>
                {SEVERITIES.map((s) => (
                  <label key={s} className={own.inputField}>
                    {SEVERITY_LABELS[s]}
                    <input
                      className={styles.input}
                      name={`points.${s}`}
                      type="number"
                      min={0}
                      step="0.1"
                      defaultValue={active?.severityPoints[s] ?? 0}
                      required
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className={own.section}>
              <div className={own.sectionHead}>
                <h3 className={own.sectionTitle}>
                  <InfoTip tip={SCORING_HELP.confidenceFactors}>Factor por confianza (0 a 1)</InfoTip>
                </h3>
                <p className={own.sectionHint}>1 = el hallazgo cuenta completo · 0.5 = cuenta la mitad</p>
              </div>
              <div className={own.inputGrid}>
                {CONFIDENCES.map((c) => (
                  <label key={c} className={own.inputField}>
                    {`Confianza ${CONFIDENCE_LABELS[c].toLowerCase()}`}
                    <input
                      className={styles.input}
                      name={`factor.${c}`}
                      type="number"
                      min={0}
                      max={1}
                      step="0.05"
                      defaultValue={active?.confidenceFactors[c] ?? 1}
                      required
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className={own.footer}>
              <label className={own.checkbox}>
                <input type="checkbox" name="activate" />
                Activar al crear
              </label>
              <button type="submit" className={styles.button} disabled={pending || !totalOk}>
                {pending ? 'Guardando…' : 'Crear versión'}
              </button>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
