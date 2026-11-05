import { afterEach, describe, expect, it, vi } from 'vitest';
import { COOLDOWN_MS, dohLookup, resetResolverHealth } from './resolver';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const signal = new AbortController().signal;
const answer = { Status: 0, Answer: [{ type: 1, data: '203.0.113.10' }] };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetResolverHealth();
});

describe('dohLookup', () => {
  it('usa dns.google cuando responde', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) => json(answer));
    vi.stubGlobal('fetch', fetchMock);
    expect(await dohLookup('a.empresa.com', 'A', signal)).toEqual({ status: 0, answers: answer.Answer });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0].hostname).toBe('dns.google');
  });

  it('pasa a Cloudflare si dns.google no responde, y lo deja en pausa', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: URL, _init?: RequestInit) => {
      if (url.hostname === 'dns.google') throw new TypeError('fetch failed');
      return json(answer);
    });
    vi.stubGlobal('fetch', fetchMock);

    expect(await dohLookup('a.empresa.com', 'A', signal)).toMatchObject({ status: 0 });
    const cloudflare = fetchMock.mock.calls[1]!;
    expect(cloudflare[0].hostname).toBe('cloudflare-dns.com');
    expect(cloudflare[1]).toMatchObject({ redirect: 'error', headers: { accept: 'application/dns-json' } });

    // En pausa: la siguiente consulta va directo a Cloudflare, sin esperar el timeout de Google.
    fetchMock.mockClear();
    await dohLookup('b.empresa.com', 'A', signal);
    expect(fetchMock.mock.calls.map(([url]) => url.hostname)).toEqual(['cloudflare-dns.com']);

    // Pasada la pausa, se vuelve a intentar primero dns.google.
    vi.advanceTimersByTime(COOLDOWN_MS + 1);
    fetchMock.mockClear();
    await dohLookup('c.empresa.com', 'A', signal);
    expect(fetchMock.mock.calls[0]![0].hostname).toBe('dns.google');
  });

  it('un SERVFAIL prueba el otro resolvedor sin pausar dns.google', async () => {
    const fetchMock = vi.fn(async (url: URL) => json(url.hostname === 'dns.google' ? { Status: 2 } : { Status: 3 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await dohLookup('x.empresa.com', 'A', signal)).toEqual({ status: 3, answers: [] });
    fetchMock.mockClear();
    await dohLookup('y.empresa.com', 'A', signal);
    expect(fetchMock.mock.calls[0]![0].hostname).toBe('dns.google');
  });

  it('devuelve undefined si ningún resolvedor da una respuesta útil', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 503)));
    expect(await dohLookup('a.empresa.com', 'A', signal)).toBeUndefined();
  });

  it('una cancelación del escaneo se propaga en vez de probar el respaldo', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort(new Error('cancelado'));
      throw new DOMException('aborted', 'AbortError');
    }));
    await expect(dohLookup('a.empresa.com', 'A', controller.signal)).rejects.toThrow('cancelado');
  });
});
