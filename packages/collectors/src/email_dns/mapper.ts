import type { AnalysisObservation, AnalysisResult } from '@warden/risk-analysis';
import type { Severity } from '@warden/shared';
import { fingerprint } from '../fingerprint';
import type { CollectorNotice, NormalizedFinding } from '../types';

export const SOURCE_KEY = 'email_dns';

interface EmailRule {
  ruleId: string;
  severity: Severity;
  title: (domain: string) => string;
}

// SUPUESTO (pendiente de validar con el equipo): severidad de cada observación de correo.
// Es la severidad del hallazgo, no el modelo de scoring del KRI (docs/scoring-model.md).
const RULES = {
  spfMissing: { ruleId: 'email.spf.missing', severity: 'medium', title: (d) => `Sin registro SPF en ${d}` },
  spfMultiple: {
    ruleId: 'email.spf.multiple-records',
    severity: 'medium',
    title: (d) => `Varios registros SPF en ${d}: SPF queda inválido`,
  },
  spfAllowsAll: { ruleId: 'email.spf.allows-all', severity: 'high', title: (d) => `SPF de ${d} permite cualquier emisor (+all)` },
  dmarcMissing: { ruleId: 'email.dmarc.missing', severity: 'medium', title: (d) => `Sin registro DMARC en ${d}` },
  dmarcMultiple: {
    ruleId: 'email.dmarc.multiple-records',
    severity: 'medium',
    title: (d) => `Varios registros DMARC en ${d}: DMARC queda inválido`,
  },
  dmarcNone: {
    ruleId: 'email.dmarc.policy-none',
    severity: 'low',
    title: (d) => `DMARC de ${d} solo monitorea (p=none): no bloquea suplantación`,
  },
  dmarcUnknown: {
    ruleId: 'email.dmarc.policy-unknown',
    severity: 'low',
    title: (d) => `Política DMARC de ${d} no reconocida`,
  },
} satisfies Record<string, EmailRule>;

/**
 * Convierte el resultado del analizador de correo en hallazgos del dominio `email`
 * (solo lo negativo) y en avisos con todas las observaciones, para mostrar el estado
 * de SPF/DMARC/MX aunque no haya hallazgos.
 */
export function mapEmailAnalysis(
  result: AnalysisResult,
  observedAt: Date,
): { findings: NormalizedFinding[]; notices: CollectorNotice[] } {
  const domain = result.subjectDomain;
  const byRule = new Map(result.observations.map((o) => [o.ruleId, o]));
  const rules: EmailRule[] = [];

  if (byRule.get('email.spf.records')?.state === 'absent') rules.push(RULES.spfMissing);
  if (byRule.get('email.spf.multiple-records')?.state === 'observed') rules.push(RULES.spfMultiple);
  if (byRule.get('email.spf.allows-all')?.state === 'observed') rules.push(RULES.spfAllowsAll);
  if (byRule.get('email.dmarc.records')?.state === 'absent') rules.push(RULES.dmarcMissing);
  if (byRule.get('email.dmarc.multiple-records')?.state === 'observed') rules.push(RULES.dmarcMultiple);
  const policy = byRule.get('email.dmarc.policy');
  if (policy?.state === 'observed' && policy.details.policy === 'none') rules.push(RULES.dmarcNone);
  if (policy?.state === 'unknown') rules.push(RULES.dmarcUnknown);

  const findings = rules.map((rule): NormalizedFinding => ({
    riskDomain: 'email',
    assetValue: domain,
    fingerprint: fingerprint(SOURCE_KEY, rule.ruleId, domain),
    title: rule.title(domain),
    severity: rule.severity,
    // Registro DNS observado directamente vía resolvedor público.
    confidence: 'high',
    observedAt,
    evidence: { domain, ruleId: rule.ruleId, observations: result.observations.map(summarize) },
  }));

  const notices = result.observations.map((o): CollectorNotice => ({
    kind: 'observation',
    subject: domain,
    message: o.summary,
    details: { domain, ruleId: o.ruleId, state: o.state, ...o.details },
  }));

  return { findings, notices };
}

function summarize(o: AnalysisObservation) {
  return { ruleId: o.ruleId, state: o.state, ...o.details };
}
