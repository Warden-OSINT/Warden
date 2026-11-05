import { isPublicIpv4, resolveIpv4 } from '../dns/resolve-ipv4';
import { fetchPublicJson } from '../http/public-json';
import type { Collector, CollectorTarget } from '../types';
import {
  feodoBlocklistSchema,
  mapReputation,
  reputationNotices,
  SOURCE_KEY,
  threatfoxSearchSchema,
  urlhausHostSchema,
  type FeodoEntry,
  type ReputationSubject,
  type ThreatfoxIoc,
  type UrlhausHost,
} from './mapper';

/** source_credentials.secret_ref: llave gratuita del portal de autenticación de abuse.ch. */
export const AUTH_KEY_REF = 'ABUSECH_AUTH_KEY';
const URLHAUS_URL = 'https://urlhaus-api.abuse.ch/v1/host/';
const THREATFOX_URL = 'https://threatfox-api.abuse.ch/api/v1/';
const FEODO_URL = 'https://feodotracker.abuse.ch/downloads/ipblocklist.json';
// Uso justo de la API Community: pocas consultas y en serie corta.
const MAX_NAMES = 50;
const MAX_IPS = 50;
const CONCURRENCY = 2;

/**
 * Nombres a consultar: dominio principal y dominios/subdominios confirmados. Si el principal
 * es `www.`, también se consulta el dominio sin el prefijo: las listas suelen registrar el apex.
 */
export function reputationNames(target: CollectorTarget): string[] {
  const primary = target.primaryDomain.toLowerCase();
  const names = target.assets
    .filter((a) => a.type === 'domain' || a.type === 'subdomain')
    .map((a) => a.value);
  return [...new Set([primary, primary.replace(/^www\./, ''), ...names].map((n) => n.toLowerCase()))]
    .slice(0, MAX_NAMES);
}

// Consulta los feeds públicos de abuse.ch (URLhaus, ThreatFox y Feodo Tracker) y el
// resolvedor público dns.google: ninguna petición llega a la infraestructura evaluada.
// URLhaus y ThreatFox piden una Auth-Key gratuita (API Community, uso justo).
export const abusechCollector: Collector = {
  sourceKey: SOURCE_KEY,
  riskDomain: 'reputation',
  isNoContact: true,

  async collect(target, ctx) {
    // Sin llave solo se podría revisar Feodo; reportarlo como 'ok' dejaría que resolve.ts
    // cerrara hallazgos de URLhaus/ThreatFox que en realidad no se revisaron.
    const authKey = ctx.getSecret(AUTH_KEY_REF)?.trim();
    if (!authKey) {
      throw new Error(`Falta ${AUTH_KEY_REF} en el worker: URLhaus y ThreatFox la requieren (gratuita en auth.abuse.ch)`);
    }

    const names = reputationNames(target);
    const { ips: resolved, failed } = await resolveIpv4(names, ctx.signal);
    if (failed.length === names.length) {
      throw new Error(`El DNS público (dns.google y Cloudflare) no respondió para ningún dominio (${failed.length} consultados)`);
    }
    for (const asset of target.assets) {
      if (asset.type === 'ip' && isPublicIpv4(asset.value) && !resolved.has(asset.value)) {
        resolved.set(asset.value, []);
      }
    }
    const ips = [...resolved.keys()].sort().slice(0, MAX_IPS);

    const feodo = await fetchFeodo(ctx.signal);
    const queries: { value: string; type: 'domain' | 'ip' }[] = [
      ...names.map((value) => ({ value, type: 'domain' as const })),
      ...ips.map((value) => ({ value, type: 'ip' as const })),
    ];

    // Cualquier consulta fallida tumba la fuente: un resultado parcial no es ausencia de listados.
    const subjects: ReputationSubject[] = [];
    for (let i = 0; i < queries.length; i += CONCURRENCY) {
      ctx.signal.throwIfAborted();
      const batch = queries.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (q) => {
        const [urlhaus, threatfox] = await Promise.all([
          queryUrlhaus(q.value, authKey, ctx.signal),
          queryThreatfox(q.value, authKey, ctx.signal),
        ]);
        return {
          ...q,
          resolvedFrom: q.type === 'ip' ? resolved.get(q.value) ?? [] : [],
          urlhaus,
          threatfox,
          feodo: q.type === 'ip' ? feodo.get(q.value) ?? [] : [],
        };
      }));
      subjects.push(...results);
    }

    return {
      assets: ips.map((value) => ({ type: 'ip', value })),
      findings: mapReputation(subjects, new Date()),
      notices: reputationNotices(subjects),
    };
  },
};

async function queryUrlhaus(host: string, authKey: string, signal: AbortSignal): Promise<UrlhausHost> {
  const response = urlhausHostSchema.parse(
    await fetchPublicJson(new URL(URLHAUS_URL), signal, { 'Auth-Key': authKey }, new URLSearchParams({ host })),
  );
  if (response.query_status === 'ok') return response;
  // invalid_host: URLhaus no acepta el valor como host; no hay nada que reportar de él.
  if (response.query_status === 'no_results' || response.query_status === 'invalid_host') {
    return { query_status: response.query_status, urls: [], blacklists: response.blacklists };
  }
  throw new Error(`URLhaus respondió ${response.query_status} para ${host}`);
}

async function queryThreatfox(term: string, authKey: string, signal: AbortSignal): Promise<ThreatfoxIoc[]> {
  const body = JSON.stringify({ query: 'search_ioc', search_term: term });
  const response = threatfoxSearchSchema.parse(
    await fetchPublicJson(new URL(THREATFOX_URL), signal, { 'Auth-Key': authKey, 'content-type': 'application/json' }, body),
  );
  if (response.query_status === 'no_result') return [];
  if (response.query_status !== 'ok') throw new Error(`ThreatFox respondió ${response.query_status} para ${term}`);
  return Array.isArray(response.data) ? response.data : [];
}

/** Lista pública de servidores C2 de botnets; se descarga una vez y se cruza localmente. */
async function fetchFeodo(signal: AbortSignal): Promise<Map<string, FeodoEntry[]>> {
  const entries = feodoBlocklistSchema.parse(await fetchPublicJson(new URL(FEODO_URL), signal));
  const byIp = new Map<string, FeodoEntry[]>();
  for (const entry of entries) {
    byIp.set(entry.ip_address, [...(byIp.get(entry.ip_address) ?? []), entry]);
  }
  return byIp;
}
