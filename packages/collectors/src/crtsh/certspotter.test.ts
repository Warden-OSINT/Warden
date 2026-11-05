import { afterEach, describe, expect, it, vi } from 'vitest';
import { issuerOrganization } from './certs';
import { dnOrganization, fetchCertSpotter, MAX_PAGES, toCrtshEntry } from './certspotter';
import { crtshCollector } from './collector';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.unstubAllGlobals());

const issuance = (id: string, names: string[], issuerDn = 'CN=R11,O=Let\'s Encrypt,C=US') => ({
  id,
  cert_sha256: `sha-${id}`,
  dns_names: names,
  not_before: '2026-10-01T00:00:00Z',
  not_after: '2026-12-30T00:00:00Z',
  issuer: { friendly_name: "Let's Encrypt", name: issuerDn },
});

describe('dnOrganization', () => {
  it('lee O= de un DN RFC 2253, también con comas escapadas', () => {
    expect(dnOrganization("CN=R11,O=Let's Encrypt,C=US")).toBe("Let's Encrypt");
    expect(dnOrganization('CN=DigiCert Global G2 TLS RSA SHA256 2020 CA1,O=DigiCert\\, Inc.,C=US')).toBe('DigiCert, Inc.');
    expect(dnOrganization('CN=Sin organización')).toBeNull();
  });

  it('da el mismo nombre de emisora que crt.sh', () => {
    const entry = toCrtshEntry(issuance('1', ['a.empresa.com'], 'CN=X,O=DigiCert\\, Inc.,C=US'));
    // crt.sh: `C=US, O="DigiCert, Inc.", CN=X`
    expect(issuerOrganization(entry.issuer_name)).toBe(issuerOrganization('C=US, O="DigiCert, Inc.", CN=X'));
    expect(entry.name_value).toBe('a.empresa.com');
  });
});

describe('fetchCertSpotter', () => {
  it('pagina con `after` hasta la página vacía', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json([issuance('1', ['a.empresa.com']), issuance('2', ['*.empresa.com'])]))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchCertSpotter('empresa.com', new AbortController().signal, 'llave');

    expect(result).toMatchObject({ truncated: false });
    expect(result.entries).toHaveLength(2);
    const second = new URL(fetchMock.mock.calls[1]![0] as URL);
    expect(second.searchParams.get('after')).toBe('2');
    expect(second.searchParams.get('include_subdomains')).toBe('true');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer llave' } });
  });

  it('marca el resultado como incompleto al llegar al tope de páginas', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => json([issuance(String(++n), ['a.empresa.com'])])));
    const result = await fetchCertSpotter('empresa.com', new AbortController().signal);
    expect(result.truncated).toBe(true);
    expect(n).toBe(MAX_PAGES);
  });
});

describe('crtshCollector con respaldo', () => {
  const ctx = { signal: new AbortController().signal, getSecret: () => undefined };
  const target = { companyId: 'c1', primaryDomain: 'empresa.com', assets: [] };

  it('usa Cert Spotter si crt.sh no responde y lo indica en los avisos', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
      const host = new URL(url).hostname;
      if (host === 'crt.sh') throw new TypeError('fetch failed');
      if (host === 'dns.google') return json({ Status: 0, Answer: [] });
      return json(new URL(url).searchParams.has('after') ? [] : [issuance('1', ['portal.empresa.com'])]);
    }));

    const result = await crtshCollector.collect(target, ctx);

    expect(result.assets).toEqual([{ type: 'subdomain', value: 'portal.empresa.com' }]);
    expect(result.notices?.[0]).toMatchObject({ details: { fallback: 'certspotter', crtshError: 'fetch failed' } });
  });

  it('falla con ambos errores si el respaldo tampoco responde', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL | string) => {
      if (new URL(url).hostname === 'crt.sh') throw new TypeError('fetch failed');
      return json({ code: 'rate_limited' }, 429);
    }));

    await expect(crtshCollector.collect(target, ctx)).rejects.toThrow('fetch failed; respaldo Cert Spotter: La fuente pública devolvió HTTP 429.');
  });
});
