import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicIpv4 } from '../dns/resolve-ipv4';
import type { CollectorTarget } from '../types';
import { internetdbCollector } from './collector';
import { resetResolverHealth } from '../dns/resolver';

const ctx = { signal: new AbortController().signal, getSecret: () => undefined };
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

describe('isPublicIpv4', () => {
  it('descarta rangos privados y reservados', () => {
    expect(['10.0.0.1', '192.168.1.1', '172.16.0.1', '127.0.0.1', '100.64.0.1', '169.254.1.1', '999.1.1.1']
      .some(isPublicIpv4)).toBe(false);
    expect(isPublicIpv4('203.0.113.10')).toBe(true);
  });
});

describe('internetdbCollector', () => {
  it('solo contacta fuentes públicas permitidas y resuelve activos a IPs públicas', async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      if (url.hostname === 'dns.google') {
        return json(url.searchParams.get('name') === 'vpn.example.com'
          ? { Status: 0, Answer: [{ type: 5, data: 'edge.example.net.' }, { type: 1, data: '203.0.113.10' }] }
          : { Status: 0, Answer: [{ type: 1, data: '10.0.0.5' }] });
      }
      if (url.hostname === 'www.cisa.gov') return json({ vulnerabilities: [{ cveID: 'CVE-2019-0708' }] });
      if (url.hostname === 'api.first.org') {
        expect(url.searchParams.get('cve')).toBe('CVE-2019-0708');
        return json({ data: [{ cve: 'CVE-2019-0708', epss: '0.97' }] });
      }
      expect(url.hostname).toBe('internetdb.shodan.io');
      return url.pathname === '/203.0.113.10'
        ? json({ ip: '203.0.113.10', ports: [3389], cpes: [], hostnames: [], tags: [], vulns: ['CVE-2019-0708'] })
        : json({ detail: 'No information available' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await internetdbCollector.collect(target, ctx);

    expect(result.assets).toEqual([
      { type: 'ip', value: '198.51.100.7' },
      { type: 'ip', value: '203.0.113.10' },
    ]);
    expect(result.findings.map((f) => [f.title, f.severity])).toEqual([
      ['Servicio RDP expuesto en 203.0.113.10:3389', 'critical'],
      ['Posible vulnerabilidad CVE-2019-0708 en 203.0.113.10', 'critical'],
    ]);
    expect(result.findings[1]?.evidence).toMatchObject({ inKev: true, epss: 0.97 });
    const hosts = new Set(fetchMock.mock.calls.map(([url]) => url.hostname));
    expect(hosts).toEqual(new Set(['dns.google', 'internetdb.shodan.io', 'www.cisa.gov', 'api.first.org']));
  });

  it('si KEV y EPSS fallan, el CVE queda en medium sin tumbar el colector', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      if (url.hostname === 'dns.google') return json({ Status: 0, Answer: [{ type: 1, data: '203.0.113.10' }] });
      if (url.hostname === 'internetdb.shodan.io') {
        return json({ ip: '203.0.113.10', ports: [], cpes: [], hostnames: [], tags: [], vulns: ['CVE-2024-0001'] });
      }
      return json({}, 500);
    }));
    const result = await internetdbCollector.collect({ ...target, assets: [] }, ctx);
    expect(result.findings).toMatchObject([{ severity: 'medium', evidence: { inKev: false, epss: null } }]);
  });

  it('falla si ninguna consulta DNS responde, aunque haya IPs confirmadas', async () => {
    const fetchMock = vi.fn(async (_url: URL) => json({}, 503));
    vi.stubGlobal('fetch', fetchMock);
    await expect(internetdbCollector.collect(target, ctx)).rejects.toThrow(/DNS público/);
    // Prueba los dos resolvedores públicos y nada más (ni InternetDB sin IPs resueltas).
    expect(new Set(fetchMock.mock.calls.map(([url]) => url.hostname))).toEqual(new Set(['dns.google', 'cloudflare-dns.com']));
  });

  it('falla si ninguna consulta a InternetDB responde', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => url.hostname === 'dns.google'
      ? json({ Status: 0, Answer: [{ type: 1, data: '203.0.113.10' }] })
      : json({}, 503)));
    await expect(internetdbCollector.collect(target, ctx)).rejects.toMatchObject({ status: 503 });
  });
});
