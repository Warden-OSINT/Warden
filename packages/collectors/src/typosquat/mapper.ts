import type { Confidence, Severity } from '@warden/shared';
import { fingerprint } from '../fingerprint';
import type { CollectorNotice, NormalizedFinding } from '../types';

export const SOURCE_KEY = 'typosquat';
const RULE_ID = 'impersonation.lookalike-registered';

/** Dominio parecido que existe en DNS (no devolvió NXDOMAIN). */
export interface RegisteredLookalike {
  domain: string;
  fuzzer: string;
  a: string[];
  /** undefined = la consulta falló. */
  mx: string[] | undefined;
  ns: string[] | undefined;
}

export interface LookalikeInput {
  /** Dominio registrable de la empresa (`empresa.com.mx`). */
  domain: string;
  /** NS del dominio de la empresa; si un parecido los comparte, quizá sea un registro defensivo. */
  companyNs: string[];
  lookalikes: RegisteredLookalike[];
  /** Dominios confirmados de la empresa: un parecido propio no es suplantación. */
  owned: ReadonlySet<string>;
  observedAt: Date;
}

const normalizeHost = (value: string) => value.trim().toLowerCase().replace(/\.$/, '');
/** Datos de MX (`10 mx.example.net.`) → host. */
const mxHost = (value: string) => normalizeHost(value.split(/\s+/).at(-1) ?? '');

// SUPUESTO (pendiente de validar con el equipo): con MX puede recibir y enviar correo de
// phishing; con A puede alojar un sitio falso; registrado sin ambos suele estar estacionado.
function severityOf(l: RegisteredLookalike): Severity {
  if ((l.mx ?? []).some((v) => mxHost(v) !== '')) return 'high';
  if (l.a.length > 0) return 'medium';
  return 'low';
}

/**
 * Hallazgos del dominio `impersonation`: un hallazgo por dominio parecido registrado.
 * La similitud no prueba intención, por eso la confianza nunca es alta.
 */
export function mapLookalikes(input: LookalikeInput): { findings: NormalizedFinding[]; notices: CollectorNotice[] } {
  const companyNs = new Set(input.companyNs.map(normalizeHost));
  const findings: NormalizedFinding[] = [];
  const notices: CollectorNotice[] = [];

  for (const l of [...input.lookalikes].sort((a, b) => a.domain.localeCompare(b.domain))) {
    if (input.owned.has(l.domain)) {
      notices.push({ kind: 'observation', subject: l.domain, message: `${l.domain} es un dominio confirmado de la empresa`,
        details: { lookalike: l.domain, fuzzer: l.fuzzer } });
      continue;
    }
    const ns = (l.ns ?? []).map(normalizeHost);
    const sharedNs = ns.some((n) => companyNs.has(n));
    const confidence: Confidence = sharedNs ? 'low' : 'medium';
    const mx = (l.mx ?? []).map(mxHost).filter(Boolean);
    findings.push({
      riskDomain: 'impersonation',
      assetValue: input.domain,
      fingerprint: fingerprint(SOURCE_KEY, RULE_ID, l.domain),
      title: `Dominio parecido registrado: ${l.domain}${sharedNs ? ' (comparte NS con la empresa: posible registro defensivo)' : ''}`,
      severity: severityOf(l),
      confidence,
      observedAt: input.observedAt,
      evidence: {
        ruleId: RULE_ID,
        lookalike: l.domain,
        original: input.domain,
        fuzzer: l.fuzzer,
        a: [...l.a].sort(),
        mx: mx.sort(),
        ns: ns.sort(),
        mxUnavailable: l.mx === undefined,
      },
    });
  }
  return { findings, notices };
}
