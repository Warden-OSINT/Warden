import { z } from 'zod';
import { fetchPublicJson } from '../http/public-json';

const responseSchema = z.object({
  Status: z.number().int(),
  TC: z.boolean().optional(),
  Answer: z.array(z.object({ type: z.number().int(), data: z.string() })).optional(),
});

export interface DohRecord {
  type: number;
  data: string;
}

/** Respuesta útil: NOERROR (0) o NXDOMAIN (3). Cualquier otra cosa es una consulta fallida. */
export interface DohResponse {
  status: 0 | 3;
  answers: DohRecord[];
}

interface Resolver {
  name: string;
  url(name: string, type: string): URL;
  headers: Record<string, string>;
}

/**
 * Resolvedores públicos con API JSON de DoH, en orden de preferencia. Ninguno es de la
 * empresa evaluada: la consulta nunca llega a sus servidores DNS.
 */
export const RESOLVERS: readonly Resolver[] = [
  {
    name: 'dns.google',
    url(name, type) {
      const url = new URL('https://dns.google/resolve');
      url.searchParams.set('name', name);
      url.searchParams.set('type', type);
      // No reenviar la subred del worker a los servidores autoritativos.
      url.searchParams.set('edns_client_subnet', '0.0.0.0/0');
      return url;
    },
    headers: {},
  },
  {
    // Cloudflare no reenvía la subred del cliente; su API JSON exige este accept.
    name: 'cloudflare-dns.com',
    url(name, type) {
      const url = new URL('https://cloudflare-dns.com/dns-query');
      url.searchParams.set('name', name);
      url.searchParams.set('type', type);
      return url;
    },
    headers: { accept: 'application/dns-json' },
  },
];

/** Un resolvedor que no responde (red, bloqueo) suele seguir así: se salta durante este tiempo. */
export const COOLDOWN_MS = 10 * 60 * 1000;
// Un DoH sano responde en milisegundos; esperar más solo retrasa el respaldo.
const LIMITS = { timeoutMs: 8_000 };

const unavailableUntil = new Map<string, number>();

/** Solo para tests: olvida qué resolvedores se dieron por caídos. */
export function resetResolverHealth(): void {
  unavailableUntil.clear();
}

/** Resolvedores en el orden a probar: primero los sanos, después los que están en pausa. */
function ordered(now: number): Resolver[] {
  const healthy = RESOLVERS.filter((r) => (unavailableUntil.get(r.name) ?? 0) <= now);
  return [...healthy, ...RESOLVERS.filter((r) => !healthy.includes(r))];
}

/**
 * Consulta un registro en el DNS público con respaldo: dns.google y, si falla, Cloudflare.
 * undefined = ningún resolvedor dio una respuesta útil (red, SERVFAIL, truncada); no
 * significa que el nombre no exista.
 */
export async function dohLookup(name: string, type: string, signal: AbortSignal): Promise<DohResponse | undefined> {
  for (const resolver of ordered(Date.now())) {
    try {
      const response = responseSchema.parse(
        await fetchPublicJson(resolver.url(name, type), signal, resolver.headers, undefined, LIMITS),
      );
      // SERVFAIL o truncada suele ser del dominio, no del resolvedor: se prueba el otro sin pausar este.
      if (response.TC || (response.Status !== 0 && response.Status !== 3)) continue;
      unavailableUntil.delete(resolver.name);
      return { status: response.Status as 0 | 3, answers: response.Answer ?? [] };
    } catch {
      signal.throwIfAborted();
      unavailableUntil.set(resolver.name, Date.now() + COOLDOWN_MS);
    }
  }
  return undefined;
}
