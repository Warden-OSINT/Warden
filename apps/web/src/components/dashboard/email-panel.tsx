import type { EmailDomainStatus, EmailOverview } from '@/lib/dashboard-types';
import styles from './dashboard.module.css';
import { SeverityPill } from './grade-badge';
import { SourceNotices, SourceRunActions } from './source-header';

const OK = 'var(--grade-a)';
const WARN = 'var(--grade-c)';
const BAD = 'var(--grade-d)';
const MUTED = 'var(--muted)';

function spfCell(d: EmailDomainStatus): [string, string] {
  if (d.spf === 'present') return d.spfAllowsAll ? ['+all (cualquier emisor)', BAD] : ['Publicado', OK];
  if (d.spf === 'missing') return ['Ausente', BAD];
  if (d.spf === 'multiple') return ['Inválido (varios)', BAD];
  return ['Sin datos', MUTED];
}

function dmarcCell(d: EmailDomainStatus): [string, string] {
  if (d.dmarc === 'missing') return ['Ausente', BAD];
  if (d.dmarc === 'multiple') return ['Inválido (varios)', BAD];
  if (d.dmarc === 'unknown') return ['Sin datos', MUTED];
  if (d.dmarcPolicy === 'reject' || d.dmarcPolicy === 'quarantine') return [`p=${d.dmarcPolicy}`, OK];
  if (d.dmarcPolicy === 'none') return ['p=none (solo monitorea)', WARN];
  return ['Política no reconocida', WARN];
}

function mxCell(d: EmailDomainStatus): [string, string] {
  if (d.nullMx) return ['Null MX (no recibe correo)', MUTED];
  if (d.mxCount === null) return ['Sin datos', MUTED];
  return d.mxCount === 0 ? ['Sin MX', MUTED] : [`${d.mxCount} ${d.mxCount === 1 ? 'servidor' : 'servidores'}`, OK];
}

function Cell({ value }: { value: [string, string] }) {
  return (
    <span className={styles.pill} style={{ color: value[1] }}>
      {value[0]}
    </span>
  );
}

export function EmailPanel({ email, isAdmin }: { email: EmailOverview; isAdmin: boolean }) {
  const { source, domains, findings } = email;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>Seguridad de correo</h2>
          <p className={styles.cardHint}>
            SPF, DMARC y MX publicados en DNS público. DKIM no se revisa sin selectores conocidos.
          </p>
        </div>
        {source && <SourceRunActions source={source} isAdmin={isAdmin} />}
      </header>

      <SourceNotices source={source} isAdmin={isAdmin} />

      {domains.length === 0 ? (
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
                <th>Dominio</th>
                <th>SPF</th>
                <th>DMARC</th>
                <th>MX</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr key={d.domain}>
                  <td>{d.domain}</td>
                  <td>
                    <Cell value={spfCell(d)} />
                  </td>
                  <td>
                    <Cell value={dmarcCell(d)} />
                  </td>
                  <td>
                    <Cell value={mxCell(d)} />
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
