import { afterEach, describe, expect, it, vi } from 'vitest';
import { typosquatCollector } from './collector';
import { generatePermutations, splitDomain } from './fuzz';
import { mapLookalikes } from './mapper';
import { resetResolverHealth } from '../dns/resolver';

const ctx = { signal: new AbortController().signal, getSecret: () => undefined };
const json = (body: unknown) => new Response(JSON.stringify(body));
afterEach(() => {
  vi.unstubAllGlobals();
  // El resolvedor recuerda cuál se cayó: sin esto un test afectaría al siguiente.
  resetResolverHealth();
});

describe('splitDomain', () => {
  it('separa el dominio registrable e ignora subdominios', () => {
    expect(splitDomain('www.empresa.com.mx')).toEqual({ label: 'empresa', suffix: 'com.mx' });
    expect(splitDomain('portal.example.com')).toEqual({ label: 'example', suffix: 'com' });
  });
});

describe('generatePermutations', () => {
  const domains = generatePermutations('www.empresa.com.mx').map((p) => p.domain);

  it('incluye técnicas comunes sin repetir ni incluir el original', () => {
    expect(domains).toEqual(expect.arrayContaining([
      'empresa.com', 'empesa.com.mx', 'emrpesa.com.mx', 'empressa.com.mx', 'enpresa.com.mx',
      'empresa-login.com.mx', 'emp-resa.com.mx', 'xn--mpresa-2of.com.mx',
    ]));
    expect(domains).not.toContain('empresa.com.mx');
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('solo produce nombres DNS válidos y respeta el límite', () => {
    expect(domains.every((d) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z.]+$/.test(d))).toBe(true);
    expect(generatePermutations('example.com', 10)).toHaveLength(10);
  });
});

describe('mapLookalikes', () => {
  const base = { domain: 'example.com', companyNs: ['ns1.dns-co.net.'], owned: new Set(['example.net']), observedAt: new Date() };

  it('gradúa severidad por MX/A, baja confianza con NS compartidos y omite dominios propios', () => {
    const { findings, notices } = mapLookalikes({
      ...base,
      lookalikes: [
        { domain: 'examp1e.com', fuzzer: 'homoglyph', a: ['203.0.113.5'], mx: ['10 mail.examp1e.com.'], ns: ['ns.other.net.'] },
        { domain: 'exampel.com', fuzzer: 'transposition', a: ['203.0.113.6'], mx: ['0 .'], ns: ['ns1.dns-co.net.'] },
        { domain: 'exmple.com', fuzzer: 'omission', a: [], mx: [], ns: undefined },
        { domain: 'example.net', fuzzer: 'tld-swap', a: ['198.51.100.1'], mx: [], ns: [] },
      ],
    });

    expect(findings.map((f) => [f.evidence.lookalike, f.severity, f.confidence])).toEqual([
      ['examp1e.com', 'high', 'medium'],
      ['exampel.com', 'medium', 'low'],
      ['exmple.com', 'low', 'medium'],
    ]);
    expect(findings.every((f) => f.riskDomain === 'impersonation' && f.assetValue === 'example.com')).toBe(true);
    expect(notices.map((n) => n.subject)).toEqual(['example.net']);
  });
});

describe('typosquatCollector', () => {
  it('solo consulta dns.google y no devuelve los parecidos como activos', async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      expect(url.hostname).toBe('dns.google');
      const name = url.searchParams.get('name');
      const type = url.searchParams.get('type');
      if (name === 'exampel.com' && type === 'A') return json({ Status: 0, Answer: [{ type: 1, data: '203.0.113.6' }] });
      if (name === 'exampel.com' && type === 'MX') return json({ Status: 0, Answer: [{ type: 15, data: '10 mx.exampel.com.' }] });
      if (type === 'NS') return json({ Status: 0, Answer: [] });
      return json({ Status: 3 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await typosquatCollector.collect({ companyId: 'c1', primaryDomain: 'example.com', assets: [] }, ctx);

    expect(result.assets).toEqual([]);
    expect(result.findings.map((f) => [f.evidence.lookalike, f.severity])).toEqual([['exampel.com', 'high']]);
  });

  it('se detiene en el primer lote si ningún resolvedor responde (red que los bloquea)', async () => {
    const fetchMock = vi.fn(async () => new Response('error', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(typosquatCollector.collect({ companyId: 'c1', primaryDomain: 'example.com', assets: [] }, ctx))
      .rejects.toThrow('El DNS público (dns.google y Cloudflare) no respondió a las primeras 8 consultas');
    // Un solo lote (8 nombres × 2 resolvedores), no los cientos de consultas con su timeout cada una.
    expect(fetchMock).toHaveBeenCalledTimes(16);
  });

  it('falla si el DNS público no responde para demasiados parecidos', async () => {
    let calls = 0;
    // El primer lote responde; después todo falla.
    vi.stubGlobal('fetch', vi.fn(async () => (++calls <= 8 ? json({ Status: 3 }) : new Response('error', { status: 500 }))));
    await expect(typosquatCollector.collect({ companyId: 'c1', primaryDomain: 'example.com', assets: [] }, ctx))
      .rejects.toThrow(/DNS público \(dns\.google y Cloudflare\) no respondió para \d+ de \d+ dominios parecidos/);
  });

  it('se detiene al cancelar el escaneo', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort(new Error('cancelado'));
      return json({ Status: 3 });
    }));
    await expect(typosquatCollector.collect(
      { companyId: 'c1', primaryDomain: 'example.com', assets: [] },
      { signal: controller.signal, getSecret: () => undefined },
    )).rejects.toThrow('cancelado');
  });
});
