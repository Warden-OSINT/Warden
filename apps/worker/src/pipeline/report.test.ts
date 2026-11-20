import { describe, expect, it, vi } from 'vitest';

// report.ts importa la config del worker; en los tests no hay variables de entorno.
vi.mock('../config', () => ({ config: {} }));

const { buildReportContext, TOP_FINDINGS } = await import('./report');

describe('buildReportContext', () => {
  const base = {
    companyName: 'Empresa',
    globalScore: 84.8,
    grade: 'B',
    domains: [{ name: 'Certificados', grade: 'B', findingsCount: 3 }],
    excludedDomains: ['Secretos filtrados'],
  };

  it('ordena por severidad, omite info, limita la cantidad y marca dominios sin datos', () => {
    const openFindings = [
      { title: 'Info', severity: 'info', domain: 'Correo' },
      { title: 'Baja', severity: 'low', domain: 'Correo' },
      { title: 'Crítica', severity: 'critical', domain: 'Secretos' },
      ...Array.from({ length: 20 }, (_, i) => ({ title: `Alta ${String(i).padStart(2, '0')}`, severity: 'high', domain: 'Suplantación' })),
    ];
    const ctx = buildReportContext({ ...base, openFindings });

    expect(ctx.topFindings).toHaveLength(TOP_FINDINGS);
    expect(ctx.topFindings[0]).toEqual({ title: 'Crítica', severity: 'critical', domain: 'Secretos' });
    expect(ctx.topFindings.some((f) => f.severity === 'info' || f.severity === 'low')).toBe(false);
    expect(ctx.domains).toContainEqual({ name: 'Secretos filtrados', grade: 'sin datos', findingsCount: 0 });
  });

  it('sin hallazgos envía una lista vacía', () => {
    expect(buildReportContext({ ...base, openFindings: [] }).topFindings).toEqual([]);
  });
});
