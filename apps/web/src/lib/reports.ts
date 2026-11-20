// Reportes del KRI: uno por escaneo calificado (tabla scores). El resumen ejecutivo con IA
// (tabla reports) todavía no se genera; la página deja su lugar reservado.

import {
  ALERT_TYPES,
  CONFIDENCES,
  FINDING_ASSET_SCOPE_COLUMNS,
  REPORT_STATUSES,
  RISK_DOMAIN_KEYS,
  SCAN_SOURCE_STATUSES,
  SEVERITIES,
  type AlertType,
  type Confidence,
  type ReportStatus,
  type Grade,
  type RiskDomainKey,
  type ScanSourceStatus,
  type Severity,
  onlyInScopeFindings,
} from '@warden/shared';
import type { Json } from '@warden/db';
import { asGrade, loadActiveCompany, oneOf } from './dashboard-data';
import { createClient } from './supabase/server';

const REPORTS_LIMIT = 50;
// Una sola empresa: los hallazgos abiertos caben en una página y se filtran en el cliente.
const FINDINGS_LIMIT = 1000;

const isDomain = (key: string): key is RiskDomainKey => (RISK_DOMAIN_KEYS as readonly string[]).includes(key);

export interface ReportAlert {
  type: AlertType;
  previousGrade: Grade | null;
  newGrade: Grade;
}

export interface ReportSummary {
  id: string;
  computedAt: string;
  scanCreatedAt: string;
  trigger: 'manual' | 'scheduled';
  score: number;
  grade: Grade;
  /** Variación contra el reporte anterior; null si es el primero. */
  delta: number | null;
  excludedDomains: RiskDomainKey[];
  alerts: ReportAlert[];
}

export interface ReportDomain {
  key: RiskDomainKey;
  /** Peso en la versión usada; null si la versión no lo incluye. */
  weight: number | null;
  score: number | null;
  grade: Grade | null;
  findingsCount: number;
  excluded: boolean;
}

export interface ReportFinding {
  id: string;
  title: string;
  domain: RiskDomainKey;
  severity: Severity;
  confidence: Confidence;
  observedAt: string;
  asset: string | null;
  sources: string[];
}

export interface ReportDetail extends ReportSummary {
  company: { name: string; primaryDomain: string };
  weightVersion: number | null;
  domains: ReportDomain[];
  sources: { key: string; name: string; status: ScanSourceStatus }[];
  /** Estado actual (de más a menos severo): el historial de triage por escaneo no se guarda. */
  openFindings: { total: number; bySeverity: Record<Severity, number>; items: ReportFinding[] };
  /** Resumen con IA (tabla reports); null si nunca se pidió. */
  ai: ReportAi | null;
}

export interface ReportAi {
  status: ReportStatus;
  summary: string | null;
  keyRisks: string[];
  recommendations: string[];
  model: string | null;
  promptVersion: string | null;
  generatedAt: string | null;
  error: string | null;
}

export type ReportsState =
  | { kind: 'ready'; company: { name: string; primaryDomain: string }; reports: ReportSummary[] }
  | { kind: 'no-company' }
  | { kind: 'no-session' };

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function session(): Promise<
  | { supabase: Supabase; company: NonNullable<Awaited<ReturnType<typeof loadActiveCompany>>> }
  | { kind: 'no-company' | 'no-session' }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'no-session' };
  const company = await loadActiveCompany(supabase);
  if (!company) return { kind: 'no-company' };
  return { supabase, company };
}

function toAlerts(rows: { alert_type: string; previous_grade: string | null; new_grade: string }[]): ReportAlert[] {
  return rows.map((a) => ({
    type: oneOf(ALERT_TYPES, a.alert_type, 'grade_drop'),
    previousGrade: a.previous_grade ? asGrade(a.previous_grade) : null,
    newGrade: asGrade(a.new_grade),
  }));
}

export async function loadReports(): Promise<ReportsState> {
  const s = await session();
  if ('kind' in s) return s;
  const { supabase, company } = s;

  const { data, error } = await supabase
    .from('scores')
    .select('id, global_score, grade, computed_at, excluded_domains, scans!inner(created_at, trigger_type), alerts(alert_type, previous_grade, new_grade)')
    .eq('company_id', company.id)
    .order('computed_at', { ascending: false })
    .limit(REPORTS_LIMIT);
  if (error) throw error;

  return {
    kind: 'ready',
    company: { name: company.name, primaryDomain: company.primary_domain },
    reports: data.map((r, i) => {
      const previous = data[i + 1];
      const score = Number(r.global_score);
      return {
        id: r.id,
        computedAt: r.computed_at,
        scanCreatedAt: r.scans.created_at,
        trigger: r.scans.trigger_type === 'scheduled' ? 'scheduled' : 'manual',
        score,
        grade: asGrade(r.grade),
        delta: previous ? Math.round((score - Number(previous.global_score)) * 100) / 100 : null,
        excludedDomains: r.excluded_domains.filter(isDomain),
        alerts: toAlerts(r.alerts),
      };
    }),
  };
}

export type ReportDetailState = { kind: 'ready'; report: ReportDetail } | { kind: 'not-found' | 'no-company' | 'no-session' };

export async function loadReport(scoreId: string): Promise<ReportDetailState> {
  const s = await session();
  if ('kind' in s) return s;
  const { supabase, company } = s;

  const { data: score, error } = await supabase
    .from('scores')
    .select(
      'id, scan_id, global_score, grade, computed_at, excluded_domains, weight_version_id, scans!inner(created_at, trigger_type), alerts(alert_type, previous_grade, new_grade), score_domains(domain_score, grade, findings_count, risk_domains!inner(key)), reports(status, summary_text, content, model_used, prompt_version, generated_at, error_message)',
    )
    .eq('company_id', company.id)
    .eq('id', scoreId)
    .maybeSingle();
  if (error) throw error;
  if (!score) return { kind: 'not-found' };

  const [previousRes, weightsRes, versionRes, sourcesRes, findingsRes] = await Promise.all([
    supabase
      .from('scores')
      .select('global_score')
      .eq('company_id', company.id)
      .lt('computed_at', score.computed_at)
      .order('computed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('scoring_weight_items')
      .select('weight, risk_domains!inner(key)')
      .eq('weight_version_id', score.weight_version_id),
    supabase.from('scoring_weights').select('version').eq('id', score.weight_version_id).maybeSingle(),
    supabase.from('scan_sources').select('source_key, status, sources!inner(name)').eq('scan_id', score.scan_id),
    onlyInScopeFindings(
      supabase
        .from('findings')
        .select(
          `id, title, severity, confidence, observed_at, risk_domains!inner(key), assets(value, ${FINDING_ASSET_SCOPE_COLUMNS}), finding_sources(source_key)`,
        )
        .eq('company_id', company.id)
        .eq('status', 'open'),
    ).limit(FINDINGS_LIMIT),
  ]);
  for (const res of [previousRes, weightsRes, versionRes, sourcesRes, findingsRes]) if (res.error) throw res.error;

  const weights = new Map((weightsRes.data ?? []).map((w) => [w.risk_domains.key, Number(w.weight)]));
  const scored = new Map(score.score_domains.map((d) => [d.risk_domains.key, d]));
  const excluded = score.excluded_domains.filter(isDomain);

  const sourceName = new Map((sourcesRes.data ?? []).map((r) => [r.source_key, r.sources.name]));
  const findings = (findingsRes.data ?? []).flatMap((f): ReportFinding[] =>
    isDomain(f.risk_domains.key)
      ? [{
          id: f.id,
          title: f.title,
          domain: f.risk_domains.key,
          severity: oneOf(SEVERITIES, f.severity, 'info'),
          confidence: oneOf(CONFIDENCES, f.confidence, 'low'),
          observedAt: f.observed_at,
          asset: f.assets?.value ?? null,
          sources: f.finding_sources.map((x) => sourceName.get(x.source_key) ?? x.source_key),
        }]
      : []);
  const bySeverity = Object.fromEntries(SEVERITIES.map((sev) => [sev, 0])) as Record<Severity, number>;
  for (const f of findings) bySeverity[f.severity] += 1;

  const scoreValue = Number(score.global_score);
  const previous = previousRes.data ? Number(previousRes.data.global_score) : null;

  return {
    kind: 'ready',
    report: {
      id: score.id,
      computedAt: score.computed_at,
      scanCreatedAt: score.scans.created_at,
      trigger: score.scans.trigger_type === 'scheduled' ? 'scheduled' : 'manual',
      score: scoreValue,
      grade: asGrade(score.grade),
      delta: previous === null ? null : Math.round((scoreValue - previous) * 100) / 100,
      excludedDomains: excluded,
      alerts: toAlerts(score.alerts),
      company: { name: company.name, primaryDomain: company.primary_domain },
      weightVersion: versionRes.data?.version ?? null,
      domains: RISK_DOMAIN_KEYS.map((key) => {
        const d = scored.get(key);
        return {
          key,
          weight: weights.get(key) ?? null,
          score: d ? Number(d.domain_score) : null,
          grade: d ? asGrade(d.grade) : null,
          findingsCount: d?.findings_count ?? 0,
          excluded: excluded.includes(key),
        };
      }),
      sources: (sourcesRes.data ?? [])
        .map((r) => ({ key: r.source_key, name: r.sources.name, status: oneOf(SCAN_SOURCE_STATUSES, r.status, 'failed') }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      openFindings: {
        total: findings.length,
        bySeverity,
        items: findings.sort(
          (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.title.localeCompare(b.title),
        ),
      },
      ai: toReportAi(score.reports),
    },
  };
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

function toReportAi(row: {
  status: string;
  summary_text: string | null;
  content: Json | null;
  model_used: string | null;
  prompt_version: string | null;
  generated_at: string;
  error_message: string | null;
} | null): ReportAi | null {
  if (!row) return null;
  const content = row.content && typeof row.content === 'object' && !Array.isArray(row.content) ? row.content : {};
  const status = oneOf(REPORT_STATUSES, row.status, 'failed');
  return {
    status,
    summary: row.summary_text,
    keyRisks: strings(content.key_risks),
    recommendations: strings(content.recommendations),
    model: row.model_used,
    promptVersion: row.prompt_version,
    // generated_at tiene default now() al crear la fila: solo cuenta si ya se generó.
    generatedAt: status === 'pending' || status === 'failed' ? null : row.generated_at,
    error: row.error_message,
  };
}
