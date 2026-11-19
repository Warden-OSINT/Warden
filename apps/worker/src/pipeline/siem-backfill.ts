import type { DomainScore, ScoreResult } from '@warden/scoring';
import { GRADES, RISK_DOMAIN_KEYS, SEVERITIES, type RiskDomainKey, type Severity } from '@warden/shared';
import type { Db } from '../supabase';
import { enqueueSiemEvents } from './siem-events';

const PAGE_SIZE = 1000;

const isOneOf = <T extends string>(values: readonly T[], value: string | null | undefined): value is T =>
  value != null && (values as readonly string[]).includes(value);

export interface StoredScoreRow {
  global_score: number | string;
  grade: string;
  excluded_domains: string[] | null;
}

export interface StoredDomainRow {
  domain_score: number | string;
  grade: string;
  findings_count: number;
  risk_domains: { key: string } | null;
}

/** Regla pura: puntaje guardado (scores + score_domains) → ScoreResult. null si la nota no es válida. */
export function scoreFromRows(score: StoredScoreRow, domains: readonly StoredDomainRow[]): ScoreResult | null {
  if (!isOneOf(GRADES, score.grade)) return null;
  const domainScores: DomainScore[] = domains.flatMap((d) => {
    const key = d.risk_domains?.key;
    if (!isOneOf(RISK_DOMAIN_KEYS, key) || !isOneOf(GRADES, d.grade)) return [];
    // numeric llega como string desde PostgREST.
    return [{ riskDomain: key, score: Number(d.domain_score), grade: d.grade, findingsCount: d.findings_count }];
  });
  return {
    globalScore: Number(score.global_score),
    grade: score.grade,
    domains: domainScores.sort((a, b) => RISK_DOMAIN_KEYS.indexOf(a.riskDomain) - RISK_DOMAIN_KEYS.indexOf(b.riskDomain)),
    excludedDomains: (score.excluded_domains ?? []).filter((k): k is RiskDomainKey => isOneOf(RISK_DOMAIN_KEYS, k)),
  };
}

/**
 * Carga inicial: si el último puntaje de cada empresa nunca se mandó al SIEM (p. ej. Splunk se
 * configuró después), lo encola para que Splunk no arranque vacío. Lo llama el worker al
 * arrancar con Splunk configurado. Devuelve cuántos encoló.
 *
 * Los hallazgos abiertos son los de ahora, no los del momento del puntaje (no se guardan por
 * escaneo); la nota, el KRI y los dominios sí son los del puntaje.
 */
export async function backfillLatestScores(db: Db, opts: { webUrl: string | null }): Promise<number> {
  const { data: companies, error } = await db.from('companies').select('id, name, primary_domain');
  if (error) throw error;

  let enqueued = 0;
  for (const company of companies) {
    const { data: scores, error: scoresError } = await db
      .from('scores')
      .select('id, scan_id, global_score, grade, excluded_domains, computed_at, weight_version_id')
      .eq('company_id', company.id)
      .order('computed_at', { ascending: false })
      .limit(2);
    if (scoresError) throw scoresError;
    const [latest, previous] = scores;
    if (!latest) continue;

    const { count, error: countError } = await db
      .from('integration_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('destination', 'siem')
      .eq('score_id', latest.id);
    if (countError) throw countError;
    if ((count ?? 0) > 0) continue;

    const { data: domains, error: domainsError } = await db
      .from('score_domains')
      .select('domain_score, grade, findings_count, risk_domains(key)')
      .eq('score_id', latest.id);
    if (domainsError) throw domainsError;
    const result = scoreFromRows(latest, domains);
    if (!result) continue;

    await enqueueSiemEvents(db, {
      ctx: {
        occurredAt: new Date(latest.computed_at).toISOString(),
        company: { name: company.name, primaryDomain: company.primary_domain },
        scanId: latest.scan_id,
        scoreId: latest.id,
        webUrl: opts.webUrl,
      },
      weightVersionId: latest.weight_version_id,
      score: { ...result, openFindings: await loadOpenSeverities(db, company.id) },
      previousGrade: previous && isOneOf(GRADES, previous.grade) ? previous.grade : null,
      // Las alertas ya registradas no se reenvían: la carga inicial solo da el estado actual.
      alert: null,
    });
    enqueued += 1;
  }
  return enqueued;
}

async function loadOpenSeverities(db: Db, companyId: string): Promise<{ severity: Severity }[]> {
  const out: { severity: Severity }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('findings')
      .select('severity')
      .eq('company_id', companyId)
      .eq('status', 'open')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const f of data) if (isOneOf(SEVERITIES, f.severity)) out.push({ severity: f.severity });
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}
