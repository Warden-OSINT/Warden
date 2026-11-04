import { afterEach, describe, expect, it, vi } from 'vitest';
import { crtshCollector, fetchCrtsh } from './collector';

const ctx = { signal: new AbortController().signal, getSecret: () => undefined };
afterEach(() => vi.unstubAllGlobals());

describe('crtshCollector', () => {
  it('busca subdominios del dominio sin www.', async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify([
      { name_value: 'shop.example.com\n*.example.com\nwww.example.com', not_before: '', not_after: '', issuer_name: '' },
    ])));
    vi.stubGlobal('fetch', fetchMock);

    const result = await crtshCollector.collect({ companyId: 'c1', primaryDomain: 'www.example.com', assets: [] }, ctx);

    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('q')).toBe('%.example.com');
    expect(result.assets).toEqual([
      { type: 'subdomain', value: 'shop.example.com' },
      { type: 'subdomain', value: 'www.example.com' },
    ]);
  });
});

describe('fetchCrtsh', () => {
  const url = 'https://crt.sh/?q=%25.example.com&output=json';
  const ok = () => new Response(JSON.stringify([{ name_value: 'a.example.com', not_before: '', not_after: '', issuer_name: '' }]));

  it('reintenta los 502 transitorios y devuelve la respuesta buena', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(ok());
    vi.stubGlobal('fetch', fetchMock);

    const entries = await fetchCrtsh(url, ctx.signal, [0, 0]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(entries).toHaveLength(1);
  });

  it('falla tras agotar los intentos', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCrtsh(url, ctx.signal, [0, 0])).rejects.toThrow('crt.sh respondió 502 tras 3 intentos');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('no reintenta errores que no son transitorios', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCrtsh(url, ctx.signal, [0, 0])).rejects.toThrow(/^crt\.sh respondió 404$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('usa el cliente restringido: sin redirects y con timeout', async () => {
    const fetchMock = vi.fn(async (_url: URL, _init?: RequestInit) => ok());
    vi.stubGlobal('fetch', fetchMock);

    await fetchCrtsh(url, ctx.signal, [0, 0]);

    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
    expect(fetchMock.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
  });

  it('rechaza respuestas que exceden el tope de tamaño', async () => {
    const huge = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(huge)));

    await expect(fetchCrtsh(url, ctx.signal, [0, 0])).rejects.toThrow('excede el límite');
  });
});
