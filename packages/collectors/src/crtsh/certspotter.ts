import { z } from 'zod';
import { fetchPublicJson } from '../http/public-json';
import type { CrtshEntry } from './mapper';

/** source_credentials.secret_ref: llave gratuita de SSLMate (opcional; sin ella el límite es menor). */
export const CERTSPOTTER_KEY_REF = 'CERTSPOTTER_API_KEY';

/**
 * El plan gratuito permite 10 consultas de dominio completo por hora y cada página cuenta:
 * con este tope un escaneo usa a lo más la mitad y quedan consultas para un reintento.
 */
export const MAX_PAGES = 5;
// El plan gratuito corta las consultas a los 15 s; con margen para la red.
const LIMITS = { timeoutMs: 30_000, maxBytes: 20 * 1024 * 1024 };

const issuanceSchema = z.object({
  id: z.string(),
  cert_sha256: z.string(),
  dns_names: z.array(z.string()),
  not_before: z.string(),
  not_after: z.string(),
  issuer: z.object({ friendly_name: z.string().nullish(), name: z.string().nullish() }).nullish(),
});
export type CertSpotterIssuance = z.infer<typeof issuanceSchema>;

/**
 * Organización (O=) de un DN en RFC 2253 (`CN=R3,O=Let's Encrypt,C=US`), que escapa las comas
 * con `\`. crt.sh entrega el emisor con comillas; se normaliza para que ambas fuentes den el
 * mismo nombre de emisora (y la misma huella en los hallazgos de CAA).
 */
export function dnOrganization(dn: string): string | null {
  const match = /(?:^|[^\\],)\s*O=((?:\\.|[^,\\])*)/.exec(dn);
  const org = match?.[1]?.replace(/\\(.)/g, '$1').trim();
  return org || null;
}

/** Issuance de Cert Spotter → fila con la forma de crt.sh, para reusar mapSubdomains y analyzeCertificates. */
export function toCrtshEntry(issuance: CertSpotterIssuance): CrtshEntry {
  const org = (issuance.issuer?.name && dnOrganization(issuance.issuer.name)) || issuance.issuer?.friendly_name || 'Desconocida';
  return {
    // Huella del certificado: deduplica igual que el serial en crt.sh.
    serial_number: issuance.cert_sha256,
    name_value: issuance.dns_names.join('\n'),
    not_before: issuance.not_before,
    not_after: issuance.not_after,
    issuer_name: `O="${org.replace(/(["\\])/g, '\\$1')}"`,
  };
}

/**
 * Certificados vigentes del dominio y sus subdominios en Cert Spotter (SSLMate), que lee los
 * mismos logs públicos de Certificate Transparency que crt.sh. Solo devuelve certificados no
 * vencidos. `truncated` indica que se alcanzó MAX_PAGES.
 */
export async function fetchCertSpotter(
  domain: string,
  signal: AbortSignal,
  apiKey?: string,
): Promise<{ entries: CrtshEntry[]; truncated: boolean }> {
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const entries: CrtshEntry[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL('https://api.certspotter.com/v1/issuances');
    url.searchParams.set('domain', domain);
    url.searchParams.set('include_subdomains', 'true');
    url.searchParams.append('expand', 'dns_names');
    url.searchParams.append('expand', 'issuer');
    if (after) url.searchParams.set('after', after);
    const batch = z.array(issuanceSchema).parse(await fetchPublicJson(url, signal, headers, undefined, LIMITS));
    // Cert Spotter indica el final de la lista con una página vacía.
    if (batch.length === 0) return { entries, truncated: false };
    entries.push(...batch.map(toCrtshEntry));
    after = batch.at(-1)!.id;
  }
  return { entries, truncated: true };
}
