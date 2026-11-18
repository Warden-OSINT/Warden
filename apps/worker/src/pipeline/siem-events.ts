import type { TablesInsert } from '@warden/db';
import type { ScoreResult, ScoringFinding } from '@warden/scoring';
import { SEVERITIES, type AlertType, type Grade, type RiskDomainKey, type Severity, type SiemEventType } from '@warden/shared';
import type { Db } from '../supabase';
import type { RaisedAlert } from './alerts';

/**
 * Eventos para el SIEM. Solo llevan notas, conteos y enlaces: nunca evidencia, activos ni
 * correos (la evidencia cruda no sale de Warden). Se guardan ya armados en
 * integration_outbox.payload; event_id lo agrega el envío (siem.ts) con el id del outbox.
 */
interface BaseEvent {
  event_type: SiemEventType;
  /** ISO 8601; el envío lo convierte en el `time` de Splunk. */
  occurred_at: string;
  company: { name: string; primary_domain: string };
  score_id: string;
  report_url: string | null;
}

export interface ScoreEvent extends BaseEvent {
  event_type: 'score';
  scan_id: string;
  global_score: number;
  grade: Grade;
  previous_grade: Grade | null;
  weights_version: number | null;
  domains: { key: RiskDomainKey; score: number; grade: Grade; open_findings: number }[];
  excluded_domains: RiskDomainKey[];
  open_findings: Record<Severity, number>;
}

export interface AlertEvent extends BaseEvent {
  event_type: 'alert';
  alert_id: string;
  alert_type: AlertType;
  previous_grade: Grade | null;
  new_grade: Grade;
  threshold_grade: Grade | null;
  global_score: number;
}

export interface SiemContext {
  occurredAt: string;
  company: { name: string; primaryDomain: string };
  scanId: string;
  scoreId: string;
  /** URL pública de la web (WARDEN_WEB_URL) para el enlace al reporte. */
  webUrl: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function reportUrl(webUrl: string | null, scoreId: string): string | null {
  return webUrl ? new URL(`/reports/${scoreId}`, webUrl).toString() : null;
}

function base(ctx: SiemContext) {
  return {
    occurred_at: ctx.occurredAt,
    company: { name: ctx.company.name, primary_domain: ctx.company.primaryDomain },
    score_id: ctx.scoreId,
    report_url: reportUrl(ctx.webUrl, ctx.scoreId),
  };
}

export function countBySeverity(findings: readonly Pick<ScoringFinding, 'severity'>[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

export function buildScoreEvent(
  ctx: SiemContext,
  score: ScoreResult & { openFindings: readonly ScoringFinding[] },
  extra: { previousGrade: Grade | null; weightsVersion: number | null },
): ScoreEvent {
  return {
    event_type: 'score',
    ...base(ctx),
    scan_id: ctx.scanId,
    global_score: round2(score.globalScore),
    grade: score.grade,
    previous_grade: extra.previousGrade,
    weights_version: extra.weightsVersion,
    domains: score.domains.map((d) => ({
      key: d.riskDomain,
      score: round2(d.score),
      grade: d.grade,
      open_findings: d.findingsCount,
    })),
    excluded_domains: [...score.excludedDomains],
    open_findings: countBySeverity(score.openFindings),
  };
}

export function buildAlertEvent(
  ctx: SiemContext,
  alert: RaisedAlert,
  score: { globalScore: number; grade: Grade },
): AlertEvent {
  return {
    event_type: 'alert',
    ...base(ctx),
    alert_id: alert.alertId,
    alert_type: alert.type,
    previous_grade: alert.previousGrade,
    new_grade: score.grade,
    threshold_grade: alert.thresholdGrade,
    global_score: round2(score.globalScore),
  };
}

/**
 * Registra en integration_outbox los eventos del puntaje recién guardado (y de su alerta, si
 * hubo) para que el worker los mande aparte: un Splunk caído no afecta al escaneo.
 */
export async function enqueueSiemEvents(
  db: Db,
  input: {
    ctx: SiemContext;
    weightVersionId: string | null;
    score: ScoreResult & { openFindings: readonly ScoringFinding[] };
    previousGrade: Grade | null;
    alert: RaisedAlert | null;
  },
): Promise<void> {
  let weightsVersion: number | null = null;
  if (input.weightVersionId) {
    const { data, error } = await db.from('scoring_weights').select('version').eq('id', input.weightVersionId).maybeSingle();
    if (error) throw error;
    weightsVersion = data?.version ?? null;
  }

  const scoreEvent = buildScoreEvent(input.ctx, input.score, { previousGrade: input.previousGrade, weightsVersion });
  const rows: TablesInsert<'integration_outbox'>[] = [{
    destination: 'siem',
    event_type: scoreEvent.event_type,
    score_id: input.ctx.scoreId,
    payload: { ...scoreEvent },
  }];
  if (input.alert) {
    const alertEvent = buildAlertEvent(input.ctx, input.alert, input.score);
    rows.push({
      destination: 'siem',
      event_type: alertEvent.event_type,
      score_id: input.ctx.scoreId,
      payload: { ...alertEvent },
    });
  }
  const { error } = await db.from('integration_outbox').insert(rows);
  if (error) throw error;
}
