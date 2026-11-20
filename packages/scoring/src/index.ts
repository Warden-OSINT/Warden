// Motor del KRI. Solo funciones puras: recibe hallazgos y una versión de pesos,
// devuelve la calificación. Sin acceso a BD ni red, para que sea testeable y
// para poder recalcular calificaciones históricas.
//
// Modelo aprobado el 28 de octubre de 2026 (docs/scoring-model.md):
// - Escala 0–100, más alto es mejor.
// - Por dominio: 100 · e^(−Σ puntos_severidad × factor_confianza / SATURATION). Rendimientos
//   decrecientes: muchos hallazgos bajos no equivalen a uno crítico, y el puntaje nunca baja de 0.
// - Solo cuentan hallazgos `open`.
// - Letras fijas (A ≥ 90 … E ≥ 50, F < 50); un crítico abierto limita el dominio a D.
// - Global = promedio ponderado de los dominios con datos; los dominios sin datos se excluyen
//   y su peso se reparte entre los demás.

import {
  CONFIDENCES,
  gradeFor,
  SEVERITIES,
  type Confidence,
  type FindingStatus,
  type Grade,
  type RiskDomainKey,
  type Severity,
} from '@warden/shared';

// Los umbrales viven en @warden/shared porque la web también los dibuja (tendencia del KRI).
export { gradeFor };

export interface ScoringFinding {
  riskDomain: RiskDomainKey;
  severity: Severity;
  confidence: Confidence;
  status: FindingStatus;
}

/** Espejo de scoring_weight_items para una versión de pesos. */
export interface WeightItem {
  riskDomain: RiskDomainKey;
  /** Porcentaje; la suma de todos los dominios es 100. */
  weight: number;
  severityPoints: Partial<Record<Severity, number>>;
  confidenceFactors: Partial<Record<Confidence, number>>;
}

export interface DomainScore {
  riskDomain: RiskDomainKey;
  score: number;
  grade: Grade;
  /** Hallazgos abiertos del dominio. */
  findingsCount: number;
}

export interface ScoreResult {
  globalScore: number;
  grade: Grade;
  /** Solo dominios con datos en el escaneo. */
  domains: DomainScore[];
  /** Dominios con peso pero sin datos (fuente fallida, omitida o deshabilitada). */
  excludedDomains: RiskDomainKey[];
}

/**
 * Puntos de penalización con los que un dominio queda en ~37 (100 · e^−1).
 * Con los puntos de la versión 1: un `high` de confianza alta deja el dominio en ~72.
 */
export const SATURATION = 60;
/** Techo de un dominio con un hallazgo crítico abierto: la mejor nota posible es D. */
export const CRITICAL_CAP = 69;

/** numeric(5, 2) en BD. */
const round2 = (value: number) => Math.round(value * 100) / 100;

export class InvalidWeightsError extends Error {
  constructor(message: string) {
    super(`Versión de pesos inválida: ${message}`);
    this.name = 'InvalidWeightsError';
  }
}

function validateWeights(weights: readonly WeightItem[]): void {
  const seen = new Set<RiskDomainKey>();
  let total = 0;
  for (const item of weights) {
    if (seen.has(item.riskDomain)) throw new InvalidWeightsError(`dominio ${item.riskDomain} repetido`);
    seen.add(item.riskDomain);
    if (!(item.weight >= 0)) throw new InvalidWeightsError(`peso negativo en ${item.riskDomain}`);
    total += item.weight;
    // Un valor faltante cambiaría el resultado en silencio; mejor fallar.
    for (const s of SEVERITIES) {
      const points = item.severityPoints[s];
      if (points === undefined || !(points >= 0)) throw new InvalidWeightsError(`faltan puntos de ${s} en ${item.riskDomain}`);
    }
    for (const c of CONFIDENCES) {
      const factor = item.confidenceFactors[c];
      if (factor === undefined || !(factor >= 0)) throw new InvalidWeightsError(`falta el factor de ${c} en ${item.riskDomain}`);
    }
  }
  if (Math.abs(total - 100) > 0.01) throw new InvalidWeightsError(`los pesos suman ${total}, deben sumar 100`);
}

/** Puntaje de un dominio a partir de sus hallazgos abiertos. */
export function scoreDomain(findings: readonly ScoringFinding[], item: WeightItem): DomainScore {
  let penalty = 0;
  let hasCritical = false;
  for (const f of findings) {
    penalty += (item.severityPoints[f.severity] ?? 0) * (item.confidenceFactors[f.confidence] ?? 0);
    if (f.severity === 'critical') hasCritical = true;
  }
  let score = 100 * Math.exp(-penalty / SATURATION);
  if (hasCritical) score = Math.min(score, CRITICAL_CAP);
  const rounded = round2(score);
  return { riskDomain: item.riskDomain, score: rounded, grade: gradeFor(rounded), findingsCount: findings.length };
}

/**
 * Calificación global y por dominio. `coveredDomains` son los dominios con al menos una
 * fuente exitosa en el escaneo: un dominio sin datos no significa que no tenga riesgo.
 * Devuelve null si ningún dominio con peso tiene datos.
 */
export function computeScore(
  findings: readonly ScoringFinding[],
  weights: readonly WeightItem[],
  coveredDomains: ReadonlySet<RiskDomainKey>,
): ScoreResult | null {
  validateWeights(weights);

  const open = findings.filter((f) => f.status === 'open');
  const domains: DomainScore[] = [];
  const excludedDomains: RiskDomainKey[] = [];
  let weighted = 0;
  let totalWeight = 0;

  for (const item of weights) {
    if (!coveredDomains.has(item.riskDomain)) {
      if (item.weight > 0) excludedDomains.push(item.riskDomain);
      continue;
    }
    const domain = scoreDomain(open.filter((f) => f.riskDomain === item.riskDomain), item);
    domains.push(domain);
    weighted += domain.score * item.weight;
    totalWeight += item.weight;
  }

  if (totalWeight === 0) return null;
  const globalScore = round2(weighted / totalWeight);
  return { globalScore, grade: gradeFor(globalScore), domains, excludedDomains };
}
