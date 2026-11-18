import type { Json } from '@warden/db';
import { computeScore, type ScoreResult, type ScoringFinding, type WeightItem } from '@warden/scoring';
import {
  CONFIDENCES,
  FINDING_STATUSES,
  RISK_DOMAIN_KEYS,
  SEVERITIES,
  type Confidence,
  type RiskDomainKey,
  type Severity,
} from '@warden/shared';
import type { Db } from '../supabase';

interface ScanRow {
  id: string;
  company_id: string;
  weight_version_id: string | null;
}

// PostgREST corta las respuestas en 1000 filas por defecto.
const PAGE_SIZE = 1000;

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value);

/** jsonb `{ "critical": 40, … }` → mapa numérico; las claves desconocidas se ignoran. */
function numberMap<K extends string>(keys: readonly K[], value: Json): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of keys) {
      const n = value[key];
      if (typeof n === 'number') out[key] = n;
    }
  }
  return out;
}

export interface WeightItemRow {
  weight: number | string;
  severity_points: Json;
  confidence_factors: Json;
  risk_domains: { key: string };
}

/** Filas de scoring_weight_items → WeightItem; computeScore valida que estén completas. */
export function toWeightItems(rows: readonly WeightItemRow[]): WeightItem[] {
  return rows.flatMap((row) => {
    const key = row.risk_domains.key;
    if (!isOneOf(RISK_DOMAIN_KEYS, key)) return [];
    return [{
      riskDomain: key,
      // numeric llega como string desde PostgREST.
      weight: Number(row.weight),
      severityPoints: numberMap<Severity>(SEVERITIES, row.severity_points),
      confidenceFactors: numberMap<Confidence>(CONFIDENCES, row.confidence_factors),
    }];
  });
}

/**
 * Calcula y guarda la calificación del escaneo (scores + score_domains). Un dominio solo
 * entra al puntaje si alguna de sus fuentes terminó 'ok' en este escaneo.
 * Devuelve null si no se pudo calificar (sin versión de pesos o sin dominios con datos).
 */
export async function scoreScan(
  db: Db,
  scan: ScanRow,
): Promise<(ScoreResult & { scoreId: string; openFindings: ScoringFinding[] }) | null> {
  if (!scan.weight_version_id) {
    console.warn(`[score] ${scan.id} sin versión de pesos activa al encolarse: no se califica`);
    return null;
  }

  const [weightsRes, sourcesRes, domainsRes] = await Promise.all([
    db
      .from('scoring_weight_items')
      .select('weight, severity_points, confidence_factors, risk_domains!inner(key)')
      .eq('weight_version_id', scan.weight_version_id),
    db
      .from('scan_sources')
      .select('sources!inner(risk_domains(key))')
      .eq('scan_id', scan.id)
      .eq('status', 'ok'),
    db.from('risk_domains').select('id, key'),
  ]);
  if (weightsRes.error) throw weightsRes.error;
  if (sourcesRes.error) throw sourcesRes.error;
  if (domainsRes.error) throw domainsRes.error;

  const covered = new Set<RiskDomainKey>();
  for (const row of sourcesRes.data) {
    const key = row.sources.risk_domains?.key;
    if (key && isOneOf(RISK_DOMAIN_KEYS, key)) covered.add(key);
  }

  const findings = await loadOpenFindings(db, scan.company_id);
  const result = computeScore(findings, toWeightItems(weightsRes.data), covered);
  if (!result) {
    console.warn(`[score] ${scan.id} sin dominios con datos: no se califica`);
    return null;
  }

  // Un reintento del mensaje no debe duplicar el puntaje (scan_id es único).
  const { error: deleteError } = await db.from('scores').delete().eq('scan_id', scan.id);
  if (deleteError) throw deleteError;

  const { data: score, error: scoreError } = await db
    .from('scores')
    .insert({
      company_id: scan.company_id,
      scan_id: scan.id,
      weight_version_id: scan.weight_version_id,
      global_score: result.globalScore,
      grade: result.grade,
      excluded_domains: result.excludedDomains,
    })
    .select('id')
    .single();
  if (scoreError) throw scoreError;

  const domainIdByKey = new Map(domainsRes.data.map((d) => [d.key, d.id]));
  const rows = result.domains.flatMap((d) => {
    const domainId = domainIdByKey.get(d.riskDomain);
    return domainId === undefined
      ? []
      : [{ score_id: score.id, risk_domain_id: domainId, domain_score: d.score, grade: d.grade, findings_count: d.findingsCount }];
  });
  if (rows.length > 0) {
    const { error } = await db.from('score_domains').insert(rows);
    if (error) throw error;
  }
  return { ...result, scoreId: score.id, openFindings: findings };
}

async function loadOpenFindings(db: Db, companyId: string): Promise<ScoringFinding[]> {
  const findings: ScoringFinding[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('findings')
      .select('id, severity, confidence, status, risk_domains!inner(key)')
      .eq('company_id', companyId)
      .eq('status', 'open')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const f of data) {
      const key = f.risk_domains.key;
      // Los CHECK de BD garantizan estos valores; se filtra por si los enums se desincronizan.
      if (isOneOf(RISK_DOMAIN_KEYS, key) && isOneOf(SEVERITIES, f.severity)
        && isOneOf(CONFIDENCES, f.confidence) && isOneOf(FINDING_STATUSES, f.status)) {
        findings.push({ riskDomain: key, severity: f.severity, confidence: f.confidence, status: f.status });
      }
    }
    if (data.length < PAGE_SIZE) break;
  }
  return findings;
}
