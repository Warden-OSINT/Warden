import { domainSchema, emailEvidenceSchema, type EmailEvidence, type EvidenceProvider } from '@warden/risk-analysis';
import { z } from 'zod';
import { dohLookup } from '../dns/resolver';

/**
 * Une fragmentos de un único TXT, conservando la separación entre registros.
 * La API JSON de dns.google entrega el texto ya decodificado y sin comillas
 * (`v=spf1 -all`, fragmentos ya unidos); otros resolvedores usan el formato de zona
 * con comillas (`"v=spf1 " "-all"`). Solo el segundo necesita decodificarse.
 */
export function decodeTxtRecord(value: string): string {
  if (!value.startsWith('"')) return value;
  const parts = value.match(/"(?:\\.|[^"\\])*"/g);
  if (!parts || parts.join('').replace(/\s/g, '') !== value.replace(/\s/g, '')) {
    throw new Error('La fuente devolvió un registro TXT no reconocido.');
  }
  return parts.map((part) => part.slice(1, -1).replace(/\\(\d{3}|.)/g, (_, escaped: string) =>
    /^\d{3}$/.test(escaped) ? String.fromCharCode(Number(escaped)) : escaped)).join('');
}

async function queryDns(name: string, type: 'TXT' | 'MX', signal: AbortSignal): Promise<EmailEvidence['spf']> {
  const response = await dohLookup(name, type, signal);
  if (!response) return { status: 'unavailable' };
  if (response.status === 3) return { status: 'ok', records: [] };
  try {
    const records = response.answers.filter((v) => v.type === (type === 'TXT' ? 16 : 15))
      .map((v) => type === 'TXT' ? decodeTxtRecord(v.data) : v.data);
    return { status: 'ok', records };
  } catch {
    // TXT con un formato no reconocido: mejor "sin dato" que un SPF mal leído.
    return { status: 'unavailable' };
  }
}

export const emailDnsProvider: EvidenceProvider = {
  sourceKey: 'email_dns', moduleKey: 'email', isNoContact: true,
  async collect(target, context) {
    const domain = domainSchema.parse(target.primaryDomain);
    const selectors = z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,63}$/)).max(20)
      .parse([...new Set(target.dkimSelectors ?? [])]);
    const [spf, dmarc, mx] = await Promise.all([
      queryDns(domain, 'TXT', context.signal),
      queryDns(`_dmarc.${domain}`, 'TXT', context.signal),
      queryDns(domain, 'MX', context.signal),
    ]);
    const dkim: EmailEvidence['dkim'] = [];
    for (const selector of selectors) {
      context.signal.throwIfAborted();
      dkim.push({ selector, observation: await queryDns(`${selector}._domainkey.${domain}`, 'TXT', context.signal) });
    }
    return emailEvidenceSchema.parse({ schemaVersion: 1, sourceKey: 'email_dns', subjectDomain: domain,
      observedAt: new Date().toISOString(), spf, dmarc, mx, dkim });
  },
};
