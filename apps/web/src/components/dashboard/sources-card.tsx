import { DOMAIN_LABELS, type SourceStatus } from '@/lib/dashboard-types';
import styles from './dashboard.module.css';
import { formatDateTime } from './format';
import { SOURCE_RUN_COLORS, SOURCE_RUN_LABELS } from './scan-status';
import { SourceToggle } from './source-toggle';

// Qué aporta cada fuente, para que quede claro qué cambia al habilitarla.
const SOURCE_HINTS: Record<string, string> = {
  internetdb: 'Puertos y CVE por IP · uso gratuito solo no comercial',
  email_dns: 'SPF, DMARC y MX publicados',
  abusech: 'Malware, IOC y botnets (URLhaus, ThreatFox, Feodo) · requiere ABUSECH_AUTH_KEY en el worker',
  crtsh: 'Subdominios (quedan "Por confirmar" en Activos), comodines, vencimientos y CAA',
  typosquat: 'Dominios parecidos registrados por terceros, consultados solo vía dns.google',
  gitleaks: 'Secretos en repos públicos de las organizaciones de código confirmadas en Activos · requiere git y gitleaks en el worker',
};

export function SourcesCard({ sources, isAdmin }: { sources: SourceStatus[]; isAdmin: boolean }) {
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Fuentes de datos</h2>
          <p className={styles.cardHint}>Solo fuentes pasivas: ninguna envía tráfico a la empresa</p>
        </div>
      </header>

      <ul className={styles.sourceList}>
        {sources.map((s) => (
          <li key={s.sourceKey} className={styles.sourceItem}>
            <div>
              <div>
                {s.name}{' '}
                <span className={styles.domainMeta}>· {s.riskDomain ? DOMAIN_LABELS[s.riskDomain] : 'sin dominio'}</span>
              </div>
              <div className={styles.subText}>{SOURCE_HINTS[s.sourceKey]}</div>
              <div className={styles.subText}>
                {!s.lastRun ? (
                  'Sin corridas todavía'
                ) : (
                  <>
                    <span style={{ color: SOURCE_RUN_COLORS[s.lastRun.status] }}>
                      {SOURCE_RUN_LABELS[s.lastRun.status]}
                    </span>
                    {s.lastRun.status === 'ok' &&
                      ` · ${s.lastRun.assetsReturned} activos · ${s.lastRun.findingsReturned} hallazgos`}
                    {` · ${formatDateTime(s.lastRun.at)}`}
                  </>
                )}
              </div>
            </div>
            {isAdmin ? (
              <SourceToggle sourceKey={s.sourceKey} enabled={s.enabled} />
            ) : (
              <span className={styles.chip} style={{ color: s.enabled ? 'var(--grade-a)' : 'var(--muted)' }}>
                {s.enabled ? 'Habilitada' : 'Deshabilitada'}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
