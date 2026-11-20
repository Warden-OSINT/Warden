import { describe, expect, it, vi } from 'vitest';
import { createGitleaksCollector, type GitleaksDeps } from './collector';
import { mapLeaks, type GitleaksLeak } from './mapper';

const ctx = { signal: new AbortController().signal, getSecret: () => undefined };
const leak = (over: Partial<GitleaksLeak>): GitleaksLeak => ({
  RuleID: 'aws-access-token', Description: 'AWS Access Key', File: 'config/.env', StartLine: 3,
  // Valor repetitivo (entropía baja): con uno que parezca llave, gitleaks reportaría este test.
  Commit: 'abc123', Date: '2026-05-01T00:00:00Z', Secret: 'NO-GUARDAR-NO-GUARDAR', ...over,
});

describe('mapLeaks', () => {
  it('agrupa el mismo secreto en un hallazgo y nunca incluye el valor', () => {
    const findings = mapLeaks([{
      fullName: 'Acme/api',
      leaks: [
        leak({}),
        leak({ File: 'old/.env', Commit: 'def456', Date: '2026-09-01T00:00:00Z' }),
        leak({ RuleID: 'generic-api-key', Description: 'Generic API Key', Secret: 'otro-secreto' }),
      ],
    }], new Date());

    expect(findings.map((f) => [f.evidence.ruleId, f.severity, f.confidence, f.evidence.occurrences])).toEqual([
      ['aws-access-token', 'critical', 'medium', 2],
      ['generic-api-key', 'medium', 'low', 1],
    ]);
    expect(findings[0]).toMatchObject({
      riskDomain: 'secrets',
      assetValue: 'github.com/acme',
      evidence: { file: 'old/.env', commit: 'def456', url: 'https://github.com/Acme/api/blob/def456/old/.env#L3' },
    });
    expect(JSON.stringify(findings)).not.toContain('NO-GUARDAR');
  });

  it('mantiene la huella si el secreto reaparece en otro commit', () => {
    const a = mapLeaks([{ fullName: 'acme/api', leaks: [leak({})] }], new Date());
    const b = mapLeaks([{ fullName: 'acme/api', leaks: [leak({ Commit: 'zzz', File: 'x.txt' })] }], new Date());
    expect(a[0]!.fingerprint).toBe(b[0]!.fingerprint);
  });
});

describe('gitleaksCollector', () => {
  const target = (values: string[]) => ({
    companyId: 'c1', primaryDomain: 'acme.com', assets: values.map((value) => ({ type: 'code_org' as const, value })),
  });

  it('sin organizaciones confirmadas falla en vez de reportar que no hay secretos', async () => {
    const deps: GitleaksDeps = { listRepos: vi.fn(), scanRepo: vi.fn() };
    await expect(createGitleaksCollector(deps).collect(target(['gitlab.com/acme']), ctx))
      .rejects.toThrow('Sin organizaciones de código');
    expect(deps.listRepos).not.toHaveBeenCalled();
  });

  it('omite forks y repos grandes, y no devuelve activos', async () => {
    const deps: GitleaksDeps = {
      listRepos: vi.fn(async () => [
        { full_name: 'acme/web', private: false, fork: false, size: 1000 },
        { full_name: 'acme/forked', private: false, fork: true, size: 10 },
        { full_name: 'acme/huge', private: false, fork: false, size: 900_000 },
      ]),
      scanRepo: vi.fn(async () => [leak({})]),
    };
    const result = await createGitleaksCollector(deps).collect(target(['github.com/acme', 'gitlab.com/acme']), ctx);

    expect(deps.listRepos).toHaveBeenCalledWith('acme', ctx.signal);
    expect(deps.scanRepo).toHaveBeenCalledTimes(1);
    expect(deps.scanRepo).toHaveBeenCalledWith('acme/web', ctx.signal);
    expect(result.assets).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.notices?.map((n) => n.subject)).toEqual(expect.arrayContaining(['gitlab.com/acme', 'acme/huge']));
  });

  it('falla la fuente si un repo no se pudo escanear', async () => {
    const deps: GitleaksDeps = {
      listRepos: vi.fn(async () => [{ full_name: 'acme/web', private: false, fork: false, size: 1 }]),
      scanRepo: vi.fn(async () => { throw Object.assign(new Error('spawn gitleaks ENOENT'), { code: 'ENOENT' }); }),
    };
    await expect(createGitleaksCollector(deps).collect(target(['github.com/acme']), ctx))
      .rejects.toThrow('git o gitleaks no están instalados');
  });
});
