'use client';

import { FINDING_STATUSES, RISK_DOMAIN_KEYS, SEVERITIES, type FindingStatus, type Severity } from '@warden/shared';
import { Fragment, useState, useTransition } from 'react';
import { triageFinding } from '@/app/(dashboard)/actions';
import styles from '@/components/dashboard/dashboard.module.css';
import { formatDate } from '@/components/dashboard/format';
import { SeverityPill } from '@/components/dashboard/grade-badge';
import { DOMAIN_LABELS } from '@/lib/dashboard-types';
import type { FindingDetail } from '@/lib/findings';

const STATUS_LABELS: Record<FindingStatus, string> = {
  open: 'Abierto',
  false_positive: 'Falso positivo',
  accepted: 'Riesgo aceptado',
  resolved: 'Resuelto',
};

const STATUS_COLORS: Record<FindingStatus, string> = {
  open: 'var(--grade-d)',
  false_positive: 'var(--muted)',
  accepted: 'var(--grade-c)',
  resolved: 'var(--grade-a)',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Crítica',
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
  info: 'Info',
};

const CONFIDENCE_LABELS = { high: 'alta', medium: 'media', low: 'baja' } as const;

const OUT_OF_SCOPE_LABELS = { discarded: 'Activo descartado', unconfirmed: 'Activo sin confirmar' } as const;

export function FindingsTable({ findings }: { findings: FindingDetail[] }) {
  const [status, setStatus] = useState<FindingStatus | ''>('open');
  const [domain, setDomain] = useState('');
  const [severity, setSeverity] = useState('');
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showOutOfScope, setShowOutOfScope] = useState(false);

  // Los hallazgos de activos descartados o sin confirmar no cuentan en el KRI: ocultos por defecto.
  const outOfScope = findings.filter((f) => f.assetOutOfScope).length;
  const visible = showOutOfScope ? findings : findings.filter((f) => !f.assetOutOfScope);

  const q = query.trim().toLowerCase();
  const rows = visible
    .filter((f) => !status || f.status === status)
    .filter((f) => !domain || f.domain === domain)
    .filter((f) => !severity || f.severity === severity)
    .filter((f) => !q || f.title.toLowerCase().includes(q) || (f.asset ?? '').toLowerCase().includes(q))
    .sort(
      (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || b.observedAt.localeCompare(a.observedAt),
    );
  const countBy = (s: FindingStatus) => visible.filter((f) => f.status === s).length;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Hallazgos</h2>
          <p className={styles.cardHint}>Indicadores observados en fuentes públicas, no vulnerabilidades confirmadas</p>
        </div>
        <span className={styles.inlineActions}>
          {FINDING_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.chip}
              style={{ color: STATUS_COLORS[s], cursor: 'pointer', opacity: status === s ? 1 : 0.6 }}
              onClick={() => setStatus(status === s ? '' : s)}
            >
              {STATUS_LABELS[s]} · {countBy(s)}
            </button>
          ))}
        </span>
      </header>

      <div className={styles.filters}>
        <input
          className={styles.input}
          type="search"
          placeholder="Buscar por título o activo…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value as FindingStatus | '')}>
          <option value="">Todos los estados</option>
          {FINDING_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select className={styles.select} value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">Todos los dominios</option>
          {RISK_DOMAIN_KEYS.map((d) => (
            <option key={d} value={d}>
              {DOMAIN_LABELS[d]}
            </option>
          ))}
        </select>
        <select className={styles.select} value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="">Todas las severidades</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABELS[s]}
            </option>
          ))}
        </select>
        {outOfScope > 0 && (
          <label className={styles.filterToggle} title="Hallazgos de activos descartados o sin confirmar; no cuentan en el KRI">
            <input type="checkbox" checked={showOutOfScope} onChange={(e) => setShowOutOfScope(e.target.checked)} />
            Mostrar {outOfScope} de activos fuera de alcance
          </label>
        )}
      </div>

      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.historyTable}`}>
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
            {rows.map((f) => {
              const open = expanded === f.id;
              return (
                <Fragment key={f.id}>
                  <tr
                    className={`${styles.clickableRow} ${open ? styles.hasDetail : ''}`}
                    onClick={() => setExpanded(open ? null : f.id)}
                  >
                    <td>
                      <SeverityPill severity={f.severity} />
                    </td>
                    <td className={styles.muted}>{DOMAIN_LABELS[f.domain]}</td>
                    <td>
                      <span className={styles.pill} style={{ color: STATUS_COLORS[f.status] }}>
                        {STATUS_LABELS[f.status]}
                      </span>
                    </td>
                    <td className={styles.muted}>{formatDate(f.observedAt)}</td>
                    <td className={styles.wrap}>
                      {f.title}
                      {f.assetOutOfScope && (
                        <span className={styles.pill} style={{ color: 'var(--muted)', marginLeft: 8 }}>
                          {OUT_OF_SCOPE_LABELS[f.assetOutOfScope]} · no cuenta en el KRI
                        </span>
                      )}
                      <div className={styles.subText}>
                        {[f.asset, f.sources.join(', '), `confianza ${CONFIDENCE_LABELS[f.confidence]}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr className={styles.findingDetailRow}>
                      <td colSpan={5}>
                        <FindingDetailPanel finding={f} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className={styles.empty}>
            {findings.length === 0 ? 'Todavía no hay hallazgos: lanza un escaneo.' : 'Ningún hallazgo coincide con los filtros.'}
          </p>
        )}
      </div>
    </section>
  );
}

function FindingDetailPanel({ finding }: { finding: FindingDetail }) {
  const [next, setNext] = useState<FindingStatus>(finding.status === 'open' ? 'resolved' : 'open');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await triageFinding(finding.id, next, reason);
      if (result.error) setError(result.error);
      else setReason('');
    });
  }

  return (
    <div className={styles.findingDetail}>
      <div>
        <p className={styles.detailLabel}>Evidencia</p>
        <pre className={styles.evidence}>{JSON.stringify(finding.evidence, null, 2)}</pre>
      </div>
      <div>
        <p className={styles.detailLabel}>Triage</p>
        {finding.statusReason && (
          <p className={styles.subText}>
            {finding.autoResolved ? 'Resuelto automáticamente: ' : 'Motivo actual: '}
            {finding.statusReason}
          </p>
        )}
        <div className={styles.form} style={{ marginTop: 8 }}>
          <select
            className={styles.select}
            value={next}
            onChange={(e) => setNext(e.target.value as FindingStatus)}
          >
            {FINDING_STATUSES.filter((s) => s !== finding.status).map((s) => (
              <option key={s} value={s}>
                {s === 'open' ? 'Reabrir' : `Marcar como ${STATUS_LABELS[s].toLowerCase()}`}
              </option>
            ))}
          </select>
          <textarea
            className={styles.input}
            rows={2}
            maxLength={500}
            placeholder={
              next === 'false_positive' || next === 'accepted' ? 'Motivo (obligatorio)' : 'Motivo (opcional)'
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && <p className={styles.error}>{error}</p>}
          <button type="button" className={styles.button} onClick={save} disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
