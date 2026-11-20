import type { ReputationOverview, ReputationSubjectStatus } from '@/lib/dashboard-types';
import styles from './dashboard.module.css';
import { SeverityPill } from './grade-badge';
import { SourceNotices, SourceRunActions } from './source-header';

const OK = 'var(--grade-a)';
const WARN = 'var(--grade-c)';
const BAD = 'var(--grade-f)';
const MUTED = 'var(--muted)';
const BLOCKLIST_NAMES: Record<string, string> = { spamhaus_dbl: 'Spamhaus DBL', surbl: 'SURBL' };

function urlhausCell(s: ReputationSubjectStatus): [string, string] {
  if (s.urlhausOnline > 0) return [`${s.urlhausOnline} URL activas`, BAD];
  if (s.urlhausTotal > 0) return [`${s.urlhausTotal} URL inactivas`, WARN];
  return ['Sin listar', OK];
}

function countCell(count: number | null, label: string): [string, string] {
  if (count === null) return ['No aplica', MUTED];
  return count > 0 ? [`${count} ${label}`, BAD] : ['Sin listar', OK];
}

function blocklistCell(s: ReputationSubjectStatus): [string, string] {
  if (s.blocklists.length === 0) return ['Sin listar', OK];
  return [s.blocklists.map((b) => BLOCKLIST_NAMES[b] ?? b).join(', '), BAD];
}

function Cell({ value }: { value: [string, string] }) {
  return (
    <span className={styles.pill} style={{ color: value[1] }}>
      {value[0]}
    </span>
  );
}

export function ReputationPanel({ reputation, isAdmin }: { reputation: ReputationOverview; isAdmin: boolean }) {
  const { source, subjects, findings } = reputation;
  const listed = subjects.filter(
    (s) => s.urlhausTotal + s.threatfoxIocs + (s.feodo ?? 0) + s.blocklists.length > 0,
  ).length;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Reputación de infraestructura</h2>
          <p className={styles.cardHint}>
            Dominios e IPs en feeds de abuse.ch: malware (URLhaus), indicadores de compromiso (ThreatFox) y
            servidores de botnets (Feodo Tracker)
            {subjects.length > 0 && ` · ${subjects.length} activos revisados, ${listed} listados`}
          </p>
        </div>
        {source && <SourceRunActions source={source} isAdmin={isAdmin} />}
      </header>

      <SourceNotices
        source={source}
        isAdmin={isAdmin}
        disabledHint="El worker necesita ABUSECH_AUTH_KEY (gratuita en auth.abuse.ch)."
      />

      {subjects.length === 0 ? (
        <p className={styles.empty}>
          {source?.lastRun?.status === 'failed'
            ? 'Sin datos: la fuente falló. Revisa el error y vuelve a escanear.'
            : 'Sin datos todavía: lanza un escaneo con la fuente habilitada.'}
        </p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Activo</th>
                <th>URLhaus</th>
                <th>ThreatFox</th>
                <th>Feodo</th>
                <th>Listas de bloqueo</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr key={s.subject}>
                  <td>
                    {s.subject}
                    {s.resolvedFrom.length > 0 && <div className={styles.subText}>{s.resolvedFrom.join(', ')}</div>}
                  </td>
                  <td>
                    <Cell value={urlhausCell(s)} />
                  </td>
                  <td>
                    <Cell value={countCell(s.threatfoxIocs, 'IOC')} />
                  </td>
                  <td>
                    <Cell value={countCell(s.feodo, 'C2')} />
                  </td>
                  <td>
                    <Cell value={blocklistCell(s)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {findings.length > 0 && (
        <ul className={styles.findingList} style={{ marginTop: 10 }}>
          {findings.map((f) => (
            <li key={f.id} className={styles.finding}>
              <div className={styles.findingTop}>
                <span>{f.title}</span>
                <SeverityPill severity={f.severity} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
