import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateExecutiveSummary, parseModelJson, redact } from './index';

afterEach(() => vi.unstubAllGlobals());

describe('parseModelJson', () => {
  it('acepta JSON puro, en bloque ```json o con texto alrededor', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(parseModelJson('Aquí está:\n{"a":3}\nSaludos')).toEqual({ a: 3 });
    expect(() => parseModelJson('sin json')).toThrow('La IA no devolvió JSON');
  });
});

describe('redact', () => {
  it('quita correos, llaves y tokens antes de enviar el contexto', () => {
    // Armada al ejecutar: escrita completa, gitleaks la reporta como llave de AWS real
    // cuando escanea este repositorio (es público y Warden se evalúa con él en demos).
    const fakeAwsKey = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
    const text = redact(`admin@empresa.com ${fakeAwsKey} eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl`);
    expect(text).toBe('[email] [aws-key] [jwt]');
  });
});

describe('generateExecutiveSummary', () => {
  it('envía el contexto redactado y valida la respuesta', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
      expect(body.messages[1]!.content).not.toContain('ana@empresa.com');
      return new Response(JSON.stringify({
        model: 'proveedor/modelo',
        choices: [{ message: { content: '```json\n{"summary":"Riesgo bajo.","key_risks":["CAA"],"recommendations":["Publicar CAA"]}\n```' } }],
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await generateExecutiveSummary(
      {
        companyName: 'Empresa',
        grade: 'B',
        globalScore: 85,
        domains: [],
        topFindings: [{ title: 'Correo de contacto ana@empresa.com expuesto', severity: 'low', domain: 'Correo' }],
      },
      { apiKey: 'k', model: 'proveedor/modelo' },
    );

    expect(result).toMatchObject({
      summary: { summary: 'Riesgo bajo.', key_risks: ['CAA'], recommendations: ['Publicar CAA'] },
      modelUsed: 'proveedor/modelo',
      promptVersion: 'executive-summary.v1',
    });
    expect(result.contextHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
