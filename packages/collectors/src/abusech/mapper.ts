import type { Confidence, Severity } from '@warden/shared';
import { z } from 'zod';
import { fingerprint } from '../fingerprint';
import type { CollectorNotice, NormalizedFinding } from '../types';

export const SOURCE_KEY = 'abusech';
const ATTRIBUTION = 'abuse.ch (URLhaus, ThreatFox, Feodo Tracker) — https://abuse.ch';
/** Ejemplos guardados en la evidencia; el resto queda en el conteo. */
const MAX_EXAMPLES = 10;

/** Respuesta de POST https://urlhaus-api.abuse.ch/v1/host/. */
export const urlhausHostSchema = z.object({
  query_status: z.string(),
  urls: z.array(z.object({
    id: z.union([z.string(), z.number()]).transform(String),
    url: z.string(),
    url_status: z.string(),
    threat: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    urlhaus_reference: z.string().nullish(),
  })).nullish(),
  // Estado del host en Spamhaus DBL y SURBL, consultado por URLhaus.
  blacklists: z.record(z.string(), z.string()).nullish(),
});
export type UrlhausHost = z.infer<typeof urlhausHostSchema>;

const threatfoxIocSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  ioc: z.string(),
  ioc_type: z.string(),
  threat_type: z.string().nullish(),
  malware_printable: z.string().nullish(),
  confidence_level: z.number().nullish(),
  last_seen: z.string().nullish(),
});
/** Respuesta de POST https://threatfox-api.abuse.ch/api/v1/ con query = search_ioc. */
export const threatfoxSearchSchema = z.object({
  query_status: z.string(),
  // Sin resultados, `data` es un mensaje de texto en lugar de un arreglo.
  data: z.union([z.array(threatfoxIocSchema), z.string()]).nullish(),
});
export type ThreatfoxSearch = z.infer<typeof threatfoxSearchSchema>;
export type ThreatfoxIoc = z.infer<typeof threatfoxIocSchema>;

/** Una entrada de https://feodotracker.abuse.ch/downloads/ipblocklist.json. */
export const feodoEntrySchema = z.object({
  ip_address: z.string(),
  port: z.number().int().nullish(),
  status: z.string().nullish(),
  malware: z.string().nullish(),
  last_online: z.string().nullish(),
});
export const feodoBlocklistSchema = z.array(feodoEntrySchema);
export type FeodoEntry = z.infer<typeof feodoEntrySchema>;

export interface ReputationSubject {
  /** Dominio, subdominio o IP consultado. */
  value: string;
  type: 'domain' | 'ip';
  /** Para IPs: activos confirmados que resolvieron a ella (vacío si la IP está confirmada). */
  resolvedFrom: string[];
  urlhaus: UrlhausHost;
  threatfox: ThreatfoxIoc[];
  /** Solo IPs: entradas de Feodo Tracker para la IP. */
  feodo: FeodoEntry[];
}

/** Listas de URLhaus.blacklists cuyo valor indica que el host está listado. */
function listedBlocklists(urlhaus: UrlhausHost): { list: string; value: string }[] {
  return Object.entries(urlhaus.blacklists ?? {})
    .filter(([, value]) => value !== 'not listed')
    .map(([list, value]) => ({ list, value }));
}

/** ThreatFox busca por subcadena: solo cuentan los IOC cuyo host es exactamente el consultado. */
export function matchingIocs(subject: string, iocs: readonly ThreatfoxIoc[]): ThreatfoxIoc[] {
  const wanted = subject.toLowerCase();
  return iocs.filter((ioc) => iocHost(ioc)?.toLowerCase() === wanted);
}

function iocHost(ioc: ThreatfoxIoc): string | null {
  if (ioc.ioc_type === 'url') {
    try {
      return new URL(ioc.ioc).hostname;
    } catch {
      return null;
    }
  }
  // ip:port, domain
  return ioc.ioc_type === 'ip:port' ? ioc.ioc.split(':')[0] ?? null : ioc.ioc;
}

/**
 * Convierte lo observado en abuse.ch en hallazgos del dominio `reputation`, uno por regla y
 * activo (las URLs o IOC concretos van como ejemplos en la evidencia).
 * SUPUESTO (pendiente de validar con el equipo): severidades por regla. Es la severidad del
 * hallazgo, no el modelo de scoring del KRI (docs/scoring-model.md).
 */
export function mapReputation(subjects: readonly ReputationSubject[], observedAt: Date): NormalizedFinding[] {
  const findings: NormalizedFinding[] = [];

  for (const s of subjects) {
    // Una IP puede ser de hosting compartido o un CDN: lo listado puede ser de otro cliente.
    const confidence: Confidence = s.type === 'domain' ? 'high' : 'medium';
    const context = { subject: s.value, subjectType: s.type, resolvedFrom: s.resolvedFrom, attribution: ATTRIBUTION };
    const push = (ruleId: string, title: string, severity: Severity, evidence: Record<string, unknown>) =>
      findings.push({
        riskDomain: 'reputation',
        assetValue: s.value,
        fingerprint: fingerprint(SOURCE_KEY, ruleId, s.value),
        title,
        severity,
        confidence,
        observedAt,
        evidence: { ...context, ...evidence },
      });

    const urls = s.urlhaus.urls ?? [];
    const online = urls.filter((u) => u.url_status === 'online');
    const offline = urls.filter((u) => u.url_status !== 'online');
    const examples = (list: typeof urls) => list.slice(0, MAX_EXAMPLES).map((u) => ({
      url: u.url, status: u.url_status, threat: u.threat ?? null, tags: u.tags ?? [], reference: u.urlhaus_reference ?? null,
    }));
    if (online.length > 0) {
      push('reputation.urlhaus.online', `${s.value} distribuye malware activamente (URLhaus)`, 'critical', {
        feed: 'urlhaus', urlCount: online.length, urls: examples(online),
      });
    }
    if (offline.length > 0) {
      push('reputation.urlhaus.offline', `${s.value} distribuyó malware (URLhaus, URLs ya inactivas)`, 'medium', {
        feed: 'urlhaus', urlCount: offline.length, urls: examples(offline),
      });
    }

    for (const { list, value } of listedBlocklists(s.urlhaus)) {
      const name = list === 'spamhaus_dbl' ? 'Spamhaus DBL' : list === 'surbl' ? 'SURBL' : list;
      push(`reputation.blocklist.${list}`, `${s.value} aparece en ${name}`, 'high', {
        feed: 'urlhaus', blocklist: list, listing: value,
      });
    }

    const iocs = matchingIocs(s.value, s.threatfox);
    if (iocs.length > 0) {
      // Un servidor de control de botnet es más grave que una URL de entrega de malware.
      const botnet = iocs.some((i) => i.threat_type === 'botnet_cc');
      push('reputation.threatfox.ioc', `${s.value} figura como indicador de compromiso en ThreatFox`, botnet ? 'critical' : 'high', {
        feed: 'threatfox',
        iocCount: iocs.length,
        iocs: iocs.slice(0, MAX_EXAMPLES).map((i) => ({
          ioc: i.ioc, iocType: i.ioc_type, threatType: i.threat_type ?? null, malware: i.malware_printable ?? null,
          confidenceLevel: i.confidence_level ?? null,
        })),
      });
    }

    if (s.feodo.length > 0) {
      const active = s.feodo.some((e) => e.status === 'online');
      push('reputation.feodo.c2', `${s.value} figura como servidor de control de botnet (Feodo Tracker)`, active ? 'critical' : 'high', {
        feed: 'feodo',
        active,
        entries: s.feodo.slice(0, MAX_EXAMPLES).map((e) => ({
          port: e.port ?? null, status: e.status ?? null, malware: e.malware ?? null,
        })),
      });
    }
  }

  return findings;
}

/**
 * Un aviso por activo consultado, también cuando está limpio: así el panel distingue
 * "sin listados" de "sin datos". `feodo` es null para dominios (Feodo solo lista IPs).
 */
export function reputationNotices(subjects: readonly ReputationSubject[]): CollectorNotice[] {
  return subjects.map((s) => {
    const urls = s.urlhaus.urls ?? [];
    const iocs = matchingIocs(s.value, s.threatfox);
    const blocklists = listedBlocklists(s.urlhaus).map((b) => b.list);
    const listed = urls.length > 0 || iocs.length > 0 || s.feodo.length > 0 || blocklists.length > 0;
    return {
      kind: 'observation' as const,
      subject: s.value,
      message: listed ? `${s.value} aparece en feeds de abuse.ch` : `${s.value} no aparece en feeds de abuse.ch`,
      details: {
        subject: s.value,
        subjectType: s.type,
        resolvedFrom: s.resolvedFrom,
        urlhausOnline: urls.filter((u) => u.url_status === 'online').length,
        urlhausTotal: urls.length,
        threatfoxIocs: iocs.length,
        feodo: s.type === 'ip' ? s.feodo.length : null,
        blocklists,
        attribution: ATTRIBUTION,
      },
    };
  });
}
