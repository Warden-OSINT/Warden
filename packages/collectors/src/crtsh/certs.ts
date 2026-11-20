import type { Confidence, Severity } from '@warden/shared';
import { fingerprint } from '../fingerprint';
import type { CollectorNotice, NormalizedFinding } from '../types';
import type { CrtshEntry } from './mapper';

export const SOURCE_KEY = 'crtsh';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Un certificado que vence en este plazo sin uno más nuevo emitido para el nombre. */
export const EXPIRING_DAYS = 14;
/** Vencidos hace más tiempo se asumen retirados: CT no dice si el host sigue en uso. */
export const RECENTLY_EXPIRED_DAYS = 30;
/** CAA solo se valida al emitir: comparar contra el CAA actual solo tiene sentido con emisiones recientes. */
export const RECENT_ISSUANCE_DAYS = 90;

interface CertRule {
  ruleId: string;
  severity: Severity;
  confidence: Confidence;
}

// SUPUESTO (pendiente de validar con el equipo): severidad y confianza de cada regla de
// certificados. Es la severidad del hallazgo, no el modelo de scoring del KRI.
const RULES = {
  // Una llave comprometida sirve para todos los hosts del dominio.
  wildcard: { ruleId: 'certs.wildcard', severity: 'low', confidence: 'high' },
  // CT confirma la fecha, pero no si el certificado sigue desplegado.
  expiring: { ruleId: 'certs.expiry', severity: 'medium', confidence: 'medium' },
  expired: { ruleId: 'certs.expiry', severity: 'low', confidence: 'low' },
  caaMissing: { ruleId: 'certs.caa.missing', severity: 'low', confidence: 'high' },
  // El CAA pudo cambiar después de la emisión; por eso confianza media.
  issuerOutsideCaa: { ruleId: 'certs.caa.issuer-not-allowed', severity: 'medium', confidence: 'medium' },
} satisfies Record<string, CertRule>;

/**
 * Identificadores CAA (RFC 8659) de las CAs más comunes, por organización emisora.
 * Una emisora que no está aquí no genera hallazgos de CAA: no se puede comparar.
 */
const CA_IDENTIFIERS: { match: RegExp; caa: string[] }[] = [
  { match: /let's encrypt/i, caa: ['letsencrypt.org'] },
  { match: /google trust services/i, caa: ['pki.goog'] },
  { match: /amazon/i, caa: ['amazon.com', 'amazontrust.com', 'awstrust.com', 'amazonaws.com'] },
  {
    match: /digicert|geotrust|thawte|rapidssl/i,
    caa: ['digicert.com', 'symantec.com', 'geotrust.com', 'thawte.com', 'rapidssl.com', 'digitalcertvalidation.com'],
  },
  { match: /sectigo|comodo|usertrust/i, caa: ['sectigo.com', 'comodoca.com', 'comodo.com', 'usertrust.com', 'trust-provider.com'] },
  { match: /zerossl/i, caa: ['sectigo.com', 'zerossl.com'] },
  { match: /globalsign/i, caa: ['globalsign.com'] },
  { match: /godaddy|starfield/i, caa: ['godaddy.com', 'starfieldtech.com'] },
  { match: /ssl corporation|ssl\.com/i, caa: ['ssl.com'] },
  { match: /entrust/i, caa: ['entrust.net'] },
  { match: /buypass/i, caa: ['buypass.com'] },
];

/** Estado de CAA del dominio: undefined = la consulta DNS falló. */
export type CaaRecords = string[] | undefined;

export interface CertAnalysisInput {
  entries: CrtshEntry[];
  /** Dominio sin `www.`. */
  domain: string;
  caa: CaaRecords;
  now: Date;
}

interface Cert {
  names: string[];
  issuerOrg: string;
  notBefore: Date;
  notAfter: Date;
}

/** crt.sh entrega fechas UTC sin zona (`2026-01-01T00:00:00`). */
export function parseCrtshDate(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
}

/** Organización (O=) del emisor; acepta valores entre comillas (`O="DigiCert, Inc."`). */
export function issuerOrganization(issuerName: string): string {
  const match = /(?:^|,\s*)O=("(?:[^"\\]|\\.)*"|[^,]*)/.exec(issuerName);
  const org = match?.[1]?.trim() ?? '';
  return org.startsWith('"') ? org.slice(1, -1).replace(/\\(.)/g, '$1') : org || issuerName;
}

/** Identificadores autorizados en `issue`/`issuewild`; `issue ";"` (ninguna CA) aporta un conjunto vacío. */
export function parseCaa(records: readonly string[]): { issuers: Set<string>; hasIssue: boolean } {
  const issuers = new Set<string>();
  let hasIssue = false;
  for (const record of records) {
    const match = /^\d+\s+(issue|issuewild)\s+"?([^"]*)"?$/i.exec(record.trim());
    if (!match) continue;
    hasIssue = true;
    const id = (match[2] ?? '').split(';')[0]?.trim().toLowerCase();
    if (id) issuers.add(id);
  }
  return { issuers, hasIssue };
}

function belongsTo(name: string, domain: string): boolean {
  const base = name.replace(/^\*\./, '');
  return base === domain || base.endsWith(`.${domain}`);
}

function toCerts(entries: CrtshEntry[], domain: string): Cert[] {
  // crt.sh lista precertificado y certificado final por separado: mismo serial, mismas fechas.
  const seen = new Set<string>();
  const certs: Cert[] = [];
  for (const entry of entries) {
    const key = `${entry.serial_number ?? entry.id ?? ''}|${entry.issuer_name}|${entry.not_before}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const names = [...new Set(entry.name_value.split('\n').map((n) => n.trim().toLowerCase()))]
      .filter((n) => n && belongsTo(n, domain));
    const notBefore = parseCrtshDate(entry.not_before);
    const notAfter = parseCrtshDate(entry.not_after);
    if (names.length === 0 || Number.isNaN(notBefore.getTime()) || Number.isNaN(notAfter.getTime())) continue;
    certs.push({ names, issuerOrg: issuerOrganization(entry.issuer_name), notBefore, notAfter });
  }
  return certs;
}

function finding(rule: CertRule, subject: string, assetValue: string, title: string, observedAt: Date,
  evidence: Record<string, unknown>): NormalizedFinding {
  return {
    riskDomain: 'certs',
    assetValue,
    fingerprint: fingerprint(SOURCE_KEY, rule.ruleId, subject),
    title,
    severity: rule.severity,
    confidence: rule.confidence,
    observedAt,
    evidence: { ruleId: rule.ruleId, ...evidence },
  };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Hallazgos del dominio `certs` a partir de los logs de Certificate Transparency y del CAA
 * publicado. Función pura: `now` se recibe para poder probarla y recalcular.
 */
export function analyzeCertificates(input: CertAnalysisInput): {
  findings: NormalizedFinding[];
  notices: CollectorNotice[];
} {
  const { domain, now } = input;
  const certs = toCerts(input.entries, domain);
  const valid = certs.filter((c) => c.notBefore <= now && now < c.notAfter);
  const findings: NormalizedFinding[] = [];

  const wildcards = new Map<string, Cert>();
  for (const cert of valid) {
    for (const name of cert.names) if (name.startsWith('*.') && !wildcards.has(name)) wildcards.set(name, cert);
  }
  for (const [name, cert] of [...wildcards].sort(([a], [b]) => a.localeCompare(b))) {
    findings.push(finding(RULES.wildcard, name, name.slice(2), `Certificado comodín vigente para ${name}`, now,
      { name, issuer: cert.issuerOrg }));
  }

  // Vigencia del certificado más reciente de cada nombre: si hay uno renovado, no hay hallazgo.
  const latest = new Map<string, Cert>();
  for (const cert of certs) {
    for (const name of cert.names) {
      const current = latest.get(name);
      if (!current || cert.notAfter > current.notAfter) latest.set(name, cert);
    }
  }
  for (const [name, cert] of [...latest].sort(([a], [b]) => a.localeCompare(b))) {
    const daysLeft = (cert.notAfter.getTime() - now.getTime()) / DAY_MS;
    const evidence = { name, issuer: cert.issuerOrg, notAfter: cert.notAfter.toISOString() };
    if (daysLeft > 0 && daysLeft <= EXPIRING_DAYS) {
      findings.push(finding(RULES.expiring, name, name.replace(/^\*\./, ''),
        `Certificado de ${name} vence el ${isoDate(cert.notAfter)} sin renovación en CT`, now, evidence));
    } else if (daysLeft <= 0 && daysLeft > -RECENTLY_EXPIRED_DAYS) {
      findings.push(finding(RULES.expired, name, name.replace(/^\*\./, ''),
        `Certificado de ${name} venció el ${isoDate(cert.notAfter)} sin renovación en CT`, now, evidence));
    }
  }

  const notices: CollectorNotice[] = [];
  const issuers = [...new Set(valid.map((c) => c.issuerOrg))].sort();
  notices.push({
    kind: 'observation',
    subject: domain,
    message: `${valid.length} certificados vigentes en CT; emisores: ${issuers.join(', ') || 'ninguno'}`,
    details: { domain, validCertificates: valid.length, issuers },
  });

  if (input.caa === undefined) {
    notices.push({ kind: 'observation', subject: domain, message: `No se pudo consultar CAA de ${domain}`,
      details: { domain, caa: 'unavailable' } });
    return { findings, notices };
  }

  const caa = parseCaa(input.caa);
  notices.push({
    kind: 'observation',
    subject: domain,
    message: caa.hasIssue ? `CAA de ${domain} autoriza: ${[...caa.issuers].join(', ') || 'ninguna CA'}` : `Sin CAA en ${domain}`,
    details: { domain, caa: input.caa },
  });

  if (!caa.hasIssue) {
    findings.push(finding(RULES.caaMissing, domain, domain,
      `Sin registro CAA en ${domain}: cualquier CA puede emitir certificados`, now, { domain }));
    return { findings, notices };
  }

  const recentFrom = now.getTime() - RECENT_ISSUANCE_DAYS * DAY_MS;
  const outside = new Map<string, Cert[]>();
  for (const cert of valid) {
    if (cert.notBefore.getTime() < recentFrom) continue;
    const known = CA_IDENTIFIERS.find((ca) => ca.match.test(cert.issuerOrg));
    if (!known || known.caa.some((id) => caa.issuers.has(id))) continue;
    outside.set(cert.issuerOrg, [...(outside.get(cert.issuerOrg) ?? []), cert]);
  }
  for (const [issuer, list] of [...outside].sort(([a], [b]) => a.localeCompare(b))) {
    findings.push(finding(RULES.issuerOutsideCaa, `${domain}|${issuer.toLowerCase()}`, domain,
      `${issuer} emitió certificados para ${domain} sin estar autorizada en CAA`, now,
      { domain, issuer, allowed: [...caa.issuers], names: [...new Set(list.flatMap((c) => c.names))].sort().slice(0, 20) }));
  }

  return { findings, notices };
}
