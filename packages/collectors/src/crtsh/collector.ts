import { setTimeout as sleep } from 'node:timers/promises';
import { queryDoh } from '../dns/doh';
import { fetchPublicJson, SourceHttpError } from '../http/public-json';
import type { Collector, CollectorNotice } from '../types';
import { analyzeCertificates } from './certs';
import { CERTSPOTTER_KEY_REF, fetchCertSpotter, MAX_PAGES } from './certspotter';
import { mapSubdomains, type CrtshEntry } from './mapper';

/**
 * crt.sh responde 502/503/504 casi de inmediato cuando su base de datos está saturada,
 * y la misma consulta suele funcionar segundos después. Esperas entre intentos.
 */
export const RETRY_DELAYS_MS = [3_000, 8_000];
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
/**
 * crt.sh es lento y un dominio con mucho historial devuelve decenas de MB. Con los
 * reintentos, el peor caso (~3 min) sigue muy por debajo del visibility timeout de la cola.
 */
const CRTSH_LIMITS = { timeoutMs: 60_000, maxBytes: 50 * 1024 * 1024 };

/** Consulta crt.sh reintentando solo los errores transitorios del servicio. */
export async function fetchCrtsh(
  url: string,
  signal: AbortSignal,
  delaysMs: readonly number[] = RETRY_DELAYS_MS,
): Promise<CrtshEntry[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      // Cliente restringido: solo HTTPS a hosts permitidos, sin redirects, con timeout y tope de tamaño.
      return (await fetchPublicJson(new URL(url), signal, {}, undefined, CRTSH_LIMITS)) as CrtshEntry[];
    } catch (err) {
      if (!(err instanceof SourceHttpError)) throw err;
      const delay = delaysMs[attempt];
      if (!RETRYABLE_STATUS.has(err.status) || delay === undefined) {
        const tries = attempt + 1;
        throw new Error(`crt.sh respondió ${err.status}${tries > 1 ? ` tras ${tries} intentos` : ''}`);
      }
      await sleep(delay, undefined, { signal });
    }
  }
}

/**
 * Certificados de CT: crt.sh y, si no responde, Cert Spotter. crt.sh se cae con frecuencia
 * (502 por saturación de su base de datos durante horas); sin respaldo, el dominio `certs`
 * quedaría fuera del KRI. Cert Spotter solo lista certificados vigentes: en ese caso no hay
 * hallazgos de "vencido sin renovar", y así lo indica el aviso.
 */
async function fetchCertificates(domain: string, ctx: Parameters<Collector['collect']>[1]) {
  const url = `https://crt.sh/?q=${encodeURIComponent(`%.${domain}`)}&output=json`;
  try {
    return { entries: await fetchCrtsh(url, ctx.signal), notices: [] as CollectorNotice[] };
  } catch (crtshError) {
    ctx.signal.throwIfAborted();
    const reason = crtshError instanceof Error ? crtshError.message : String(crtshError);
    let fallback;
    try {
      fallback = await fetchCertSpotter(domain, ctx.signal, ctx.getSecret(CERTSPOTTER_KEY_REF)?.trim() || undefined);
    } catch (spotterError) {
      ctx.signal.throwIfAborted();
      const detail = spotterError instanceof Error ? spotterError.message : String(spotterError);
      throw new Error(`${reason}; respaldo Cert Spotter: ${detail}`);
    }
    // Datos incompletos con estado 'ok' harían que resolve.ts cerrara hallazgos no revisados.
    if (fallback.truncated) {
      throw new Error(`${reason}; respaldo Cert Spotter: más de ${MAX_PAGES} páginas, resultado incompleto`);
    }
    return {
      entries: fallback.entries,
      notices: [{
        kind: 'observation',
        subject: domain,
        message: `${reason}: se usó Cert Spotter (solo certificados vigentes; sin hallazgos de vencidos)`,
        details: { fallback: 'certspotter', crtshError: reason },
      }] satisfies CollectorNotice[],
    };
  }
}

// Consulta logs públicos de Certificate Transparency (crt.sh o Cert Spotter) y el CAA vía
// dns.google: no toca la infraestructura evaluada.
export const crtshCollector: Collector = {
  sourceKey: 'crtsh',
  riskDomain: 'certs',
  isNoContact: true,

  async collect(target, ctx) {
    // `www.` es un host, no el dominio: con él solo se buscarían subdominios de www.
    const domain = target.primaryDomain.toLowerCase().replace(/^www\./, '');
    const { entries, notices: sourceNotices } = await fetchCertificates(domain, ctx);
    // Un CAA no consultado no genera hallazgos de CAA, pero sí queda como aviso.
    const caa = await queryDoh(domain, 'CAA', ctx.signal);
    const { findings, notices } = analyzeCertificates({
      entries,
      domain,
      caa: caa?.records,
      now: new Date(),
    });
    return { assets: mapSubdomains(entries, domain), findings, notices: [...sourceNotices, ...notices] };
  },
};
