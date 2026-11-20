import type { Confidence, FindingStatus, RiskDomainKey, Severity } from '@warden/shared';
import { describe, expect, it } from 'vitest';
import { computeScore, CRITICAL_CAP, gradeFor, InvalidWeightsError, type ScoringFinding, type WeightItem } from './index';

// Igual a la versión 1 sembrada en la migración de pesos.
const severityPoints = { critical: 40, high: 20, medium: 8, low: 3, info: 0 };
const confidenceFactors = { high: 1, medium: 0.75, low: 0.5 };
const V1: Record<RiskDomainKey, number> = {
  exposure: 25, email: 15, certs: 10, secrets: 20, reputation: 20, impersonation: 10,
};
const weights: WeightItem[] = Object.entries(V1).map(([riskDomain, weight]) => ({
  riskDomain: riskDomain as RiskDomainKey, weight, severityPoints, confidenceFactors,
}));
const ALL = new Set(Object.keys(V1) as RiskDomainKey[]);

const f = (riskDomain: RiskDomainKey, severity: Severity, confidence: Confidence = 'high', status: FindingStatus = 'open'): ScoringFinding =>
  ({ riskDomain, severity, confidence, status });
const domain = (result: ReturnType<typeof computeScore>, key: RiskDomainKey) =>
  result?.domains.find((d) => d.riskDomain === key);

describe('gradeFor', () => {
  it('aplica los umbrales fijos', () => {
    expect([100, 90, 89.99, 80, 70, 60, 50, 49.99, 0].map(gradeFor)).toEqual(['A', 'A', 'B', 'B', 'C', 'D', 'E', 'F', 'F']);
  });
});

describe('computeScore', () => {
  it('sin hallazgos todo es 100 y A', () => {
    const result = computeScore([], weights, ALL);
    expect(result).toMatchObject({ globalScore: 100, grade: 'A', excludedDomains: [] });
    expect(result?.domains.every((d) => d.score === 100 && d.findingsCount === 0)).toBe(true);
  });

  it('los hallazgos info no restan', () => {
    expect(domain(computeScore([f('email', 'info')], weights, ALL), 'email')).toMatchObject({ score: 100, findingsCount: 1 });
  });

  it('usa rendimientos decrecientes y nunca baja de 0', () => {
    const one = domain(computeScore([f('certs', 'high')], weights, ALL), 'certs')!;
    expect(one).toMatchObject({ score: 71.65, grade: 'C' });

    const manyLows = domain(computeScore(Array.from({ length: 10 }, () => f('certs', 'low')), weights, ALL), 'certs')!;
    expect(manyLows.score).toBeGreaterThan(55);

    const flood = domain(computeScore(Array.from({ length: 200 }, () => f('impersonation', 'high')), weights, ALL), 'impersonation')!;
    expect(flood).toMatchObject({ score: 0, grade: 'F' });
  });

  it('pondera por confianza', () => {
    const high = domain(computeScore([f('secrets', 'high', 'high')], weights, ALL), 'secrets')!.score;
    const low = domain(computeScore([f('secrets', 'high', 'low')], weights, ALL), 'secrets')!.score;
    expect(low).toBeGreaterThan(high);
  });

  it('un crítico abierto limita el dominio a D aunque su penalización sea baja', () => {
    const critical = domain(computeScore([f('exposure', 'critical', 'low')], weights, ALL), 'exposure')!;
    expect(critical).toMatchObject({ score: CRITICAL_CAP, grade: 'D' });
  });

  it('solo cuentan los hallazgos abiertos', () => {
    const result = computeScore([
      f('reputation', 'critical', 'high', 'false_positive'),
      f('reputation', 'high', 'high', 'accepted'),
      f('reputation', 'high', 'high', 'resolved'),
    ], weights, ALL);
    expect(domain(result, 'reputation')).toMatchObject({ score: 100, findingsCount: 0 });
  });

  it('el global es el promedio ponderado', () => {
    // exposure en 71.65 (peso 25) y el resto en 100: (71.65·25 + 100·75) / 100.
    expect(computeScore([f('exposure', 'high')], weights, ALL)?.globalScore).toBe(92.91);
  });

  it('excluye dominios sin datos y reparte su peso', () => {
    const covered = new Set<RiskDomainKey>(['exposure', 'email']);
    const result = computeScore([f('exposure', 'high'), f('secrets', 'critical')], weights, covered)!;
    expect(result.domains.map((d) => d.riskDomain)).toEqual(['exposure', 'email']);
    expect(result.excludedDomains).toEqual(['certs', 'secrets', 'reputation', 'impersonation']);
    // (71.65·25 + 100·15) / 40
    expect(result.globalScore).toBe(82.28);
  });

  it('sin ningún dominio con datos no hay calificación', () => {
    expect(computeScore([], weights, new Set())).toBeNull();
  });

  it('rechaza pesos que no suman 100 o incompletos', () => {
    expect(() => computeScore([], weights.slice(1), ALL)).toThrow(InvalidWeightsError);
    const incomplete = weights.map((w, i) => (i === 0 ? { ...w, severityPoints: { high: 20 } } : w));
    expect(() => computeScore([], incomplete, ALL)).toThrow('faltan puntos de critical');
  });
});
