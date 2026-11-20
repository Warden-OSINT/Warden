import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollectorTarget } from '../types';
import { emailDnsCollector, emailDomains } from './collector';
import { resetResolverHealth } from '../dns/resolver';

const ctx = { signal: new AbortController().signal, getSecret: () => undefined };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
// Formato real de la API JSON de dns.google: TXT sin comillas y con fragmentos ya unidos.
const txt = (value: string) => ({ type: 16, data: value });
afterEach(() => {
  vi.unstubAllGlobals();
  // El resolvedor recuerda cuál se cayó: sin esto un test afectaría al siguiente.
  resetResolverHealth();
});

/** Simula dns.google con registros por nombre y tipo; lo no definido responde NXDOMAIN. */
function stubDns(records: Record<string, { type: number; data: string }[] | 'fail'>) {
  const fetchMock = vi.fn(async (url: URL) => {
    expect(url.hostname).toBe('dns.google');
    const answer = records[`${url.searchParams.get('name')} ${url.searchParams.get('type')}`];
    if (answer === 'fail') return json({}, 503);
    return answer ? json({ Status: 0, Answer: answer }) : json({ Status: 3 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const target = (primaryDomain: string, assets: CollectorTarget['assets'] = []): CollectorTarget =>
  ({ companyId: 'c1', primaryDomain, assets });

describe('emailDomains', () => {
  it('quita www. y deduplica con los dominios confirmados', () => {
    expect(emailDomains(target('www.example.com', [
      { type: 'domain', value: 'example.com' },
      { type: 'domain', value: 'example.mx' },
      { type: 'subdomain', value: 'mail.example.com' },
    ]))).toEqual(['example.com', 'example.mx']);
  });
});

describe('emailDnsCollector', () => {
  it('genera hallazgos solo de lo negativo y avisos con todo lo observado', async () => {
    const fetchMock = stubDns({
      'example.com TXT': [txt('v=spf1 include:_spf.example.net +all')],
      '_dmarc.example.com TXT': [txt('v=DMARC1; p=none; rua=mailto:d@example.com')],
      'example.com MX': [{ type: 15, data: '10 mx.example.com.' }],
    });

    const result = await emailDnsCollector.collect(target('www.example.com'), ctx);

    expect(result.findings.map((f) => [f.title, f.severity, f.riskDomain])).toEqual([
      ['SPF de example.com permite cualquier emisor (+all)', 'high', 'email'],
      ['DMARC de example.com solo monitorea (p=none): no bloquea suplantación', 'low', 'email'],
    ]);
    expect(result.findings.every((f) => f.assetValue === 'example.com')).toBe(true);
    expect(result.notices).toContainEqual(expect.objectContaining({
      kind: 'observation',
      details: expect.objectContaining({ ruleId: 'email.dmarc.policy', state: 'observed', policy: 'none' }),
    }));
    // Solo SPF, DMARC y MX: sin selectores no se consulta DKIM.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('también acepta TXT en formato de zona (con comillas y fragmentos)', async () => {
    stubDns({
      'example.com TXT': [{ type: 16, data: '"v=spf1 include:_spf.example.net " "-all"' }],
      '_dmarc.example.com TXT': [{ type: 16, data: '"v=DMARC1; p=reject"' }],
      'example.com MX': [{ type: 15, data: '10 mx.example.com.' }],
    });
    const result = await emailDnsCollector.collect(target('example.com'), ctx);
    expect(result.findings).toEqual([]);
  });

  it('reporta SPF y DMARC ausentes', async () => {
    stubDns({ 'example.com MX': [{ type: 15, data: '10 mx.example.com.' }] });
    const result = await emailDnsCollector.collect(target('example.com'), ctx);
    expect(result.findings.map((f) => f.title)).toEqual([
      'Sin registro SPF en example.com',
      'Sin registro DMARC en example.com',
    ]);
  });

  it('falla si una consulta no responde, en vez de reportar ausencia', async () => {
    stubDns({ 'example.com TXT': 'fail' });
    await expect(emailDnsCollector.collect(target('example.com'), ctx)).rejects.toThrow(/SPF de example\.com/);
  });
});
