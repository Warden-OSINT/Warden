const ALLOWED_HOSTS = new Set([
  'dns.google', 'haveibeenpwned.com', 'internetdb.shodan.io', 'www.cisa.gov', 'api.first.org',
  'urlhaus-api.abuse.ch', 'threatfox-api.abuse.ch', 'feodotracker.abuse.ch', 'api.github.com', 'crt.sh',
]);
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

/** Límites por consulta; una fuente lenta o voluminosa (p. ej. crt.sh) puede ampliarlos. */
export interface FetchLimits {
  timeoutMs?: number;
  maxBytes?: number;
}

export class SourceHttpError extends Error {
  constructor(public readonly status: number, public readonly retryAfter: string | null) {
    super(`La fuente pública devolvió HTTP ${status}.`);
  }
}

/**
 * Destinos fijos y redirects bloqueados para no seguir enlaces a activos evaluados.
 * Con `body` la petición es POST (APIs de consulta como URLhaus o ThreatFox).
 */
export async function fetchPublicJson(
  url: URL,
  signal: AbortSignal,
  headers: Record<string, string> = {},
  body?: string | URLSearchParams,
  { timeoutMs = TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES }: FetchLimits = {},
): Promise<unknown> {
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.port || url.username || url.password) {
    throw new Error('Destino no autorizado para recolección pasiva.');
  }
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    body,
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    redirect: 'error', headers: { accept: 'application/json', 'user-agent': 'Warden-OSINT/1.0', ...headers },
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new SourceHttpError(response.status, response.headers.get('retry-after'));
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('La fuente devolvió una respuesta vacía.');
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw new Error('La respuesta de la fuente excede el límite permitido.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
