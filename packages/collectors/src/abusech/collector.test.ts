import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CollectorTarget } from '../types';
import { abusechCollector, reputationNames } from './collector';
import { resetResolverHealth } from '../dns/resolver';

const ctx = { signal: new AbortController().signal, getSecret: (ref: string) => (ref === 'ABUSECH_AUTH_KEY' ? 'k' : undefined) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const target: CollectorTarget = {
  companyId: 'c1',
  primaryDomain: 'example.com',
  assets: [
    { type: 'subdomain', value: 'vpn.example.com' },
    { type: 'ip', value: '198.51.100.7' },
  ],
};
afterEach(() => {
  vi.unstubAllGlobals();
  // El resolvedor recuerda cuál se cayó: sin esto un test afectaría al siguiente.
  resetResolverHealth();
});

/** Simula dns.google y abuse.ch; `urlhaus`/`threatfox` responden por host consultado. */
function stubFeeds(options: { urlhaus?: Record<string, unknown>; threatfox?: Record<string, unknown>; fail?: string } = {}) {
  const fetchMock = vi.fn(async (url: URL, init: RequestInit) => {
    if (url.hostname === options.fail) return json({}, 503);
    if (url.hostname === 'dns.google') {
      return json(url.searchParams.get('name') === 'vpn.example.com'
        ? { Status: 0, Answer: [{ type: 1, data: '203.0.113.10' }] }
        : { Status: 3 });
    }
    if (url.hostname === 'feodotracker.abuse.ch') {
      return json([{ ip_address: '203.0.113.10', port: 443, status: 'online', malware: 'QakBot' }]);
    }
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('auth-key')).toBe('k');
    if (url.hostname === 'urlhaus-api.abuse.ch') {
      const host = (init.body as URLSearchParams).get('host')!;
      return json(options.urlhaus?.[host] ?? { query_status: 'no_results' });
    }
    expect(url.hostname).toBe('threatfox-api.abuse.ch');
    const term = JSON.parse(init.body as string).search_term as string;
    return json(options.threatfox?.[term] ?? { query_status: 'no_result', data: 'Your search did not yield any results' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('reputationNames', () => {
  it('incluye el dominio principal y dominios/subdominios confirmados sin duplicados', () => {
    expect(reputationNames({ ...target, assets: [...target.assets, { type: 'domain', value: 'EXAMPLE.com' }] }))
      .toEqual(['example.com', 'vpn.example.com']);
  });

  it('agrega el apex cuando el dominio principal es www.', () => {
    expect(reputationNames({ ...target, primaryDomain: 'www.example.com', assets: [] }))
      .toEqual(['www.example.com', 'example.com']);
  });
});

describe('abusechCollector', () => {
  it('solo contacta dns.google y abuse.ch, y cruza dominios e IPs con los feeds', async () => {
    const fetchMock = stubFeeds({
      urlhaus: {
        'vpn.example.com': {
          query_status: 'ok',
          urls: [{ id: 1, url: 'http://vpn.example.com/x.exe', url_status: 'online' }],
          blacklists: { spamhaus_dbl: 'not listed', surbl: 'not listed' },
        },
      },
    });

    const result = await abusechCollector.collect(target, ctx);

    expect(result.assets).toEqual([{ type: 'ip', value: '198.51.100.7' }, { type: 'ip', value: '203.0.113.10' }]);
    expect(result.findings.map((f) => [f.assetValue, f.severity])).toEqual([
      ['vpn.example.com', 'critical'],
      ['203.0.113.10', 'critical'],
    ]);
    expect(result.notices?.map((n) => n.subject)).toEqual(['example.com', 'vpn.example.com', '198.51.100.7', '203.0.113.10']);
    expect(new Set(fetchMock.mock.calls.map(([url]) => url.hostname))).toEqual(new Set([
      'dns.google', 'feodotracker.abuse.ch', 'urlhaus-api.abuse.ch', 'threatfox-api.abuse.ch',
    ]));
  });

  it('falla sin Auth-Key en lugar de reportar un resultado incompleto', async () => {
    const fetchMock = stubFeeds();
    await expect(abusechCollector.collect(target, { ...ctx, getSecret: () => undefined })).rejects.toThrow(/ABUSECH_AUTH_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falla si un feed no responde: un resultado parcial no es ausencia de listados', async () => {
    stubFeeds({ fail: 'threatfox-api.abuse.ch' });
    await expect(abusechCollector.collect(target, ctx)).rejects.toThrow();
  });

  it('falla ante un query_status inesperado', async () => {
    stubFeeds({ urlhaus: { 'example.com': { query_status: 'unknown_auth_key' } } });
    await expect(abusechCollector.collect(target, ctx)).rejects.toThrow(/URLhaus respondió unknown_auth_key/);
  });
});
