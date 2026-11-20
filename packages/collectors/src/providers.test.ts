import { afterEach, describe, expect, it, vi } from 'vitest';
import { runRiskAnalysis } from '@warden/risk-analysis';
import { decodeTxtRecord, emailDnsProvider } from './email_dns/provider';
import { mapHibpDomain } from './hibp/mapper';
import { hibpProvider } from './hibp/provider';
import { fetchPublicJson, SourceHttpError } from './http/public-json';
import { resetResolverHealth } from './dns/resolver';

const target = { primaryDomain: 'example.com', confirmedDomains: [] };
const context = { signal: new AbortController().signal, getSecret: () => 'a'.repeat(32) };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => {
  vi.unstubAllGlobals();
  // El resolvedor recuerda cuál se cayó: sin esto un test afectaría al siguiente.
  resetResolverHealth();
});

describe('Cliente HTTP público', () => {
  it('rechaza destinos de la empresa y bloquea redirects en hosts autorizados', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json([]));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchPublicJson(new URL('https://example.com'), context.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await fetchPublicJson(new URL('https://haveibeenpwned.com/api/v3/breaches'), context.signal);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });

  it('conserva HTTP 429 y Retry-After sin registrar el cuerpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secreto', { status: 429, headers: { 'retry-after': '30' } })));
    await expect(fetchPublicJson(new URL('https://haveibeenpwned.com/api/v3/breaches'), context.signal))
      .rejects.toMatchObject({ status: 429, retryAfter: '30' });
  });
});

describe('Proveedor de correos', () => {
  it('une fragmentos TXT y decodifica escapes DNS', () => {
    expect(decodeTxtRecord('"v=spf1 ""-all"')).toBe('v=spf1 -all');
    expect(decodeTxtRecord('"v=spf1\\032-all"')).toBe('v=spf1 -all');
    expect(() => decodeTxtRecord('"v=spf1" basura')).toThrow();
  });

  it('acepta el TXT sin comillas que entrega la API JSON de dns.google', () => {
    expect(decodeTxtRecord('v=DMARC1; p=none; rua=mailto:d@example.com')).toBe('v=DMARC1; p=none; rua=mailto:d@example.com');
  });

  it('consulta solo resolvedores públicos y distingue SERVFAIL de NXDOMAIN', async () => {
    const fetchMock = vi.fn(async (url: URL) => {
      expect(['dns.google', 'cloudflare-dns.com']).toContain(url.hostname);
      if (url.hostname === 'dns.google') expect(url.searchParams.get('edns_client_subnet')).toBe('0.0.0.0/0');
      return json(url.searchParams.get('name')?.startsWith('_dmarc') ? { Status: 3 } : { Status: 2 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const executions = await runRiskAnalysis(target, [emailDnsProvider], [
      { sourceKey: 'email_dns', isEnabled: true, isNoContact: true },
    ], context);
    const result = executions[0];
    expect(result?.status).toBe('ok');
    if (result?.status === 'ok') {
      expect(result.result.observations.find((v) => v.ruleId === 'email.spf.records')?.state).toBe('unknown');
      expect(result.result.observations.find((v) => v.ruleId === 'email.dmarc.records')?.state).toBe('absent');
    }
    // SERVFAIL se reintenta en Cloudflare (SPF y MX); el NXDOMAIN de DMARC basta con dns.google.
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe('Proveedor HIBP', () => {
  it('agrega cuentas sin aliases y deduplica nombres repetidos por cuenta', () => {
    const result = mapHibpDomain({ alice: ['Adobe', 'Adobe'], bob: ['Adobe', 'Unknown'] },
      [{ Name: 'Adobe', DataClasses: ['Passwords'], IsVerified: true }], 'example.com', '2026-10-12T12:00:00Z');
    expect(result.breaches).toEqual([
      { breachId: 'Adobe', affectedAccounts: 2, includesPasswords: true, verified: true },
      { breachId: 'Unknown', affectedAccounts: 1, includesPasswords: null, verified: null },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/alice|bob/);
  });

  it('trata 404 como ausencia y 403 como fallo de autorización', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) =>
      url.pathname.includes('breachedDomain') ? json({}, 404) : json([])));
    expect(await hibpProvider.collect(target, context)).toMatchObject({ breaches: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({}, 403)));
    await expect(hibpProvider.collect(target, context)).rejects.toBeInstanceOf(SourceHttpError);
  });

  it('rechaza consultas sin key antes de hacer tráfico', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(hibpProvider.collect(target, { ...context, getSecret: () => undefined })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('conserva exposición desconocida si el catálogo falla y nunca consulta la empresa', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
      expect(url.hostname).toBe('haveibeenpwned.com');
      return url.pathname.includes('breachedDomain') ? json({ alice: ['Adobe'] }) : json({}, 503);
    }));
    expect(await hibpProvider.collect(target, context)).toMatchObject({
      breaches: [{ breachId: 'Adobe', affectedAccounts: 1, includesPasswords: null, verified: null }],
    });
  });
});
