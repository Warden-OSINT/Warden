// Carga los datos del dashboard desde Supabase con la sesión del usuario (RLS).
// Warden evalúa a una sola empresa, así que se usa la única empresa activa.

import {
  CONFIDENCES,
  GRADES,
  RISK_DOMAIN_KEYS,
  SCAN_SOURCE_STATUSES,
  SCAN_STATUSES,
  SEVERITIES,
  type AssetType,
  type Confidence,
  type Grade,
  type RiskDomainKey,
  type Severity,
} from '@warden/shared';
import type { Json } from '@warden/db';
import {
  DOMAIN_LABELS,
  type AssetRow,
  type AttributionStatus,
  type CdnHost,
  type DashboardData,
  type DomainScoreRow,
  type ExposureHost,
  type ExposureOverview,
  type EmailDomainStatus,
  type EmailOverview,
  type ReputationOverview,
  type ReputationSubjectStatus,
  type SourceStatus,
  type FindingRow,
  type ScanSummary,
  type TrendPoint,
} from './dashboard-types';
import { mockDashboard } from './mock-dashboard';
import { loadRecentAlerts } from './alerts';
import { createClient } from './supabase/server';

/** Fuente del dominio `exposure` con colector implementado (packages/collectors/src/internetdb). */
export const EXPOSURE_SOURCE_KEY = 'internetdb';
export const EMAIL_SOURCE_KEY = 'email_dns';
export const REPUTATION_SOURCE_KEY = 'abusech';

/**
 * Fuentes con colector registrado en packages/collectors/src/registry.ts. La web no importa
 * @warden/collectors (AGENTS.md §4), así que se mantiene a mano: habilitar una fuente sin
 * colector no haría nada.
 */
export const IMPLEMENTED_SOURCES = [EXPOSURE_SOURCE_KEY, EMAIL_SOURCE_KEY, REPUTATION_SOURCE_KEY, 'crtsh', 'typosquat', 'gitleaks'] as const;
export type ImplementedSource = (typeof IMPLEMENTED_SOURCES)[number];

const RECENT_FINDINGS = 8;
/** Hallazgos de un mismo escaneo comparten observed_at: se traen de sobra para elegir los más severos. */
const RECENT_FINDINGS_WINDOW = 200;
const TREND_POINTS = 12;

export type DashboardState =
  | { kind: 'ready'; data: DashboardData }
  /** Aún no se registra la empresa a evaluar. */
  | { kind: 'no-company'; isAdmin: boolean };

export type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function loadDashboard(): Promise<DashboardState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Sin sesión solo se llega aquí con WARDEN_DEV_SKIP_AUTH (el proxy redirige a /login).
    if (process.env.NODE_ENV !== 'production' && process.env.WARDEN_DEV_SKIP_AUTH === 'true') {
      return { kind: 'ready', data: mockDashboard };
    }
    throw new Error('Sesión requerida');
  }

  const [{ data: isAdmin }, company] = await Promise.all([
    supabase.rpc('is_admin'),
    loadActiveCompany(supabase),
  ]);
  if (!company) return { kind: 'no-company', isAdmin: isAdmin === true };

  const [assets, openFindings, recent, scores, lastScan, schedule, weights, sourceRuns, alerts] = await Promise.all([
    loadAssets(supabase, company.id),
    loadOpenFindingCounts(supabase, company.id),
    loadRecentFindings(supabase, company.id),
    loadScores(supabase, company.id),
    loadLastScan(supabase, company.id),
    supabase.from('schedules').select('next_run_at, is_active').eq('company_id', company.id).maybeSingle(),
    loadActiveWeights(supabase),
    loadSourceRuns(supabase, company.id),
    loadRecentAlerts(supabase, company.id, 1),
  ]);
  const [exposure, email, reputation] = await Promise.all([
    loadExposure(supabase, company.id, sourceRuns),
    loadEmail(supabase, company.id, sourceRuns),
    loadReputation(supabase, company.id, sourceRuns),
  ]);

  const latest = scores.latest;
  const domains: DomainScoreRow[] = RISK_DOMAIN_KEYS.map((key) => {
    const scored = latest?.domains.get(key);
    return {
      key,
      name: DOMAIN_LABELS[key],
      weight: weights.get(key) ?? null,
      score: scored?.score ?? null,
      grade: scored?.grade ?? null,
      findingsCount: openFindings.byDomain.get(key) ?? 0,
      excluded: latest?.excluded.has(key) ?? false,
    };
  });

  return {
    kind: 'ready',
    data: {
      mode: 'live',
      isAdmin: isAdmin === true,
      company: {
        id: company.id,
        name: company.name,
        primaryDomain: company.primary_domain,
        score: latest?.score ?? null,
        grade: latest?.grade ?? null,
        previousScore: scores.trend.at(-2)?.score ?? null,
        lastScanAt: lastScan.lastCompletedAt,
        nextScanAt: schedule.data?.is_active ? schedule.data.next_run_at : null,
        openFindings: openFindings.total,
        openCriticalFindings: openFindings.critical,
      },
      domains,
      assets,
      recentFindings: recent,
      trend: scores.trend,
      exposure,
      email,
      reputation,
      sources: sourceRuns.statuses,
      lastScan: lastScan.latest,
      // Solo si la alerta es del puntaje más reciente: una vieja ya se resolvió o se reemplazó.
      latestAlert: alerts[0] && alerts[0].at === scores.trend.at(-1)?.scannedAt ? alerts[0] : null,
    },
  };
}

/** La empresa evaluada: la activa más antigua (Warden evalúa a una sola empresa). */
export async function loadActiveCompany(supabase: Supabase) {
  const { data, error } = await supabase
    .from('companies')
    .select('id, name, primary_domain')
    .eq('status', 'active')
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadAssets(supabase: Supabase, companyId: string): Promise<AssetRow[]> {
  const { data, error } = await supabase
    .from('assets')
    .select('id, asset_type, value, attribution_status, discovery_source, last_seen')
    .eq('company_id', companyId)
    .order('value')
    .limit(1000);
  if (error) throw error;
  // Los CHECK constraints garantizan los valores de los campos de texto.
  return data.map((a) => ({
    id: a.id,
    type: a.asset_type as AssetType,
    value: a.value,
    status: a.attribution_status as AttributionStatus,
    discoverySource: a.discovery_source as 'auto' | 'manual',
    lastSeen: a.last_seen,
  }));
}

async function loadOpenFindingCounts(supabase: Supabase, companyId: string) {
  const { data, error } = await supabase
    .from('findings')
    .select('severity, risk_domains!inner(key)')
    .eq('company_id', companyId)
    .eq('status', 'open');
  if (error) throw error;

  const byDomain = new Map<RiskDomainKey, number>();
  let critical = 0;
  for (const f of data) {
    const key = f.risk_domains.key as RiskDomainKey;
    byDomain.set(key, (byDomain.get(key) ?? 0) + 1);
    if (f.severity === 'critical') critical += 1;
  }
  return { total: data.length, critical, byDomain };
}

async function loadRecentFindings(supabase: Supabase, companyId: string): Promise<FindingRow[]> {
  const [{ data, error }, { data: sources }] = await Promise.all([
    supabase
      .from('findings')
      .select('id, title, severity, confidence, observed_at, risk_domains!inner(key), finding_sources(source_key)')
      .eq('company_id', companyId)
      .eq('status', 'open')
      .order('observed_at', { ascending: false })
      .limit(RECENT_FINDINGS_WINDOW),
    supabase.from('sources').select('source_key, name'),
  ]);
  if (error) throw error;
  const sourceName = new Map((sources ?? []).map((s) => [s.source_key, s.name]));

  return data
    .map((f) => ({
      id: f.id,
      indicator: f.title,
      domain: f.risk_domains.key as RiskDomainKey,
      severity: f.severity as Severity,
      confidence: f.confidence as Confidence,
      source: f.finding_sources.map((s) => sourceName.get(s.source_key) ?? s.source_key).join(', ') || '—',
      observedAt: f.observed_at,
    }))
    // severity es text en BD: ordenarla allí sería alfabético (critical, high, info, low, medium).
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || severityRank(a.severity) - severityRank(b.severity))
    .slice(0, RECENT_FINDINGS);
}

/** Puntajes guardados por el worker (pipeline/score.ts). */
async function loadScores(supabase: Supabase, companyId: string) {
  const { data, error } = await supabase
    .from('scores')
    .select('global_score, grade, computed_at, excluded_domains, score_domains(domain_score, grade, risk_domains!inner(key))')
    .eq('company_id', companyId)
    .order('computed_at', { ascending: false })
    .limit(TREND_POINTS);
  if (error) throw error;

  const trend: TrendPoint[] = data
    .map((s) => ({ scannedAt: s.computed_at, score: Number(s.global_score), grade: asGrade(s.grade) }))
    .reverse();
  const first = data[0];
  const latest = first
    ? {
        score: Number(first.global_score),
        grade: asGrade(first.grade),
        excluded: new Set(first.excluded_domains),
        domains: new Map(
          first.score_domains.map((d) => [
            d.risk_domains.key as RiskDomainKey,
            { score: Number(d.domain_score), grade: asGrade(d.grade) },
          ]),
        ),
      }
    : null;
  return { trend, latest };
}

async function loadActiveWeights(supabase: Supabase): Promise<Map<RiskDomainKey, number>> {
  const { data } = await supabase
    .from('scoring_weight_items')
    .select('weight, risk_domains!inner(key), scoring_weights!inner(is_active)')
    .eq('scoring_weights.is_active', true);
  return new Map((data ?? []).map((w) => [w.risk_domains.key as RiskDomainKey, Number(w.weight)]));
}

async function loadLastScan(supabase: Supabase, companyId: string) {
  const [latestRes, completedRes] = await Promise.all([
    supabase
      .from('scans')
      .select('id, status, created_at, started_at, finished_at, error_message, sources_total, current:sources!scans_current_source_fkey(name), scan_sources(status)')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('scans')
      .select('finished_at')
      .eq('company_id', companyId)
      .eq('status', 'completed')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (latestRes.error) throw latestRes.error;

  const s = latestRes.data;
  const latest: ScanSummary | null = s
    ? {
        id: s.id,
        status: oneOf(SCAN_STATUSES, s.status, 'failed'),
        createdAt: s.created_at,
        finishedAt: s.finished_at,
        errorMessage: s.error_message,
        sourceFailures: s.scan_sources.some((r) => isSourceFailure(r.status)),
        startedAt: s.started_at,
        progress: { currentSource: s.current?.name ?? null, done: s.scan_sources.length, total: s.sources_total },
      }
    : null;
  return { latest, lastCompletedAt: completedRes.data?.finished_at ?? null };
}

interface SourceRuns {
  statuses: SourceStatus[];
  /** scan_sources.notices de la última corrida de cada fuente. */
  notices: Map<string, Json>;
}

/** Estado de cada fuente implementada y su resultado en el último escaneo que la registró. */
async function loadSourceRuns(supabase: Supabase, companyId: string): Promise<SourceRuns> {
  const [sourcesRes, runsRes] = await Promise.all([
    supabase
      .from('sources')
      .select('source_key, name, is_enabled, risk_domains(key)')
      .in('source_key', [...IMPLEMENTED_SOURCES]),
    // Cada escaneo registra todas las fuentes, así que la última corrida está entre las recientes.
    supabase
      .from('scan_sources')
      .select(
        'source_key, status, items_returned, assets_returned, findings_returned, message, notices, scans!inner(company_id, created_at)',
      )
      .in('source_key', [...IMPLEMENTED_SOURCES])
      .eq('scans.company_id', companyId)
      .order('scans(created_at)', { ascending: false })
      .limit(IMPLEMENTED_SOURCES.length * 5),
  ]);
  if (sourcesRes.error) throw sourcesRes.error;
  if (runsRes.error) throw runsRes.error;

  const latestRun = new Map<string, (typeof runsRes.data)[number]>();
  for (const run of runsRes.data) if (!latestRun.has(run.source_key)) latestRun.set(run.source_key, run);

  const statuses = IMPLEMENTED_SOURCES.flatMap((key): SourceStatus[] => {
    const s = sourcesRes.data.find((row) => row.source_key === key);
    if (!s) return [];
    const run = latestRun.get(key);
    const domainKey = s.risk_domains?.key;
    return [{
      sourceKey: key,
      name: s.name,
      riskDomain: domainKey && (RISK_DOMAIN_KEYS as readonly string[]).includes(domainKey) ? (domainKey as RiskDomainKey) : null,
      enabled: s.is_enabled,
      lastRun: run
        ? {
            status: oneOf(SCAN_SOURCE_STATUSES, run.status, 'failed'),
            assetsReturned: run.assets_returned,
            findingsReturned: run.findings_returned,
            itemsReturned: run.items_returned,
            message: run.message,
            at: run.scans.created_at,
          }
        : null,
    }];
  });
  return { statuses, notices: new Map([...latestRun].map(([key, run]) => [key, run.notices])) };
}

/** Hallazgos abiertos de exposición agrupados por IP, más el estado de la fuente. */
async function loadExposure(supabase: Supabase, companyId: string, runs: SourceRuns): Promise<ExposureOverview> {
  const findingsRes = await supabase
    .from('findings')
    .select('id, severity, confidence, observed_at, evidence, risk_domains!inner(key)')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .eq('risk_domains.key', 'exposure')
    .limit(2000);
  if (findingsRes.error) throw findingsRes.error;

  const source = runs.statuses.find((s) => s.sourceKey === EXPOSURE_SOURCE_KEY) ?? null;
  const cdnHosts = parseCdnHosts(runs.notices.get(EXPOSURE_SOURCE_KEY) ?? []);

  const hosts = new Map<string, ExposureHost>();
  for (const f of findingsRes.data) {
    const ev = asRecord(f.evidence);
    const ip = typeof ev.ip === 'string' ? ev.ip : null;
    if (!ip) continue;
    const severity = oneOf(SEVERITIES, f.severity, 'info');

    let host = hosts.get(ip);
    if (!host) {
      host = {
        ip,
        resolvedFrom: stringArray(ev.resolvedFrom),
        worstSeverity: severity,
        services: [],
        cves: [],
        observedAt: f.observed_at,
      };
      hosts.set(ip, host);
    }
    if (severityRank(severity) < severityRank(host.worstSeverity)) host.worstSeverity = severity;
    if (f.observed_at > host.observedAt) host.observedAt = f.observed_at;

    // Evidencia escrita por internetdb/mapper.ts: { port, service } o { cve, inKev, epss }.
    if (typeof ev.cve === 'string') {
      host.cves.push({
        findingId: f.id,
        cve: ev.cve,
        severity,
        inKev: ev.inKev === true,
        epss: typeof ev.epss === 'number' ? ev.epss : null,
      });
    } else if (typeof ev.port === 'number') {
      host.services.push({
        findingId: f.id,
        port: ev.port,
        service: typeof ev.service === 'string' ? ev.service : 'desconocido',
        severity,
        confidence: oneOf(CONFIDENCES, f.confidence, 'low'),
      });
    }
  }

  for (const host of hosts.values()) {
    host.services.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.port - b.port);
    host.cves.sort(
      (a, b) => severityRank(a.severity) - severityRank(b.severity) || (b.epss ?? 0) - (a.epss ?? 0),
    );
  }

  return {
    source,
    cdnHosts,
    hosts: [...hosts.values()].sort(
      (a, b) => severityRank(a.worstSeverity) - severityRank(b.worstSeverity) || a.ip.localeCompare(b.ip),
    ),
  };
}

/** Estado de SPF/DMARC/MX por dominio (avisos de email_dns) y hallazgos abiertos de correo. */
async function loadEmail(supabase: Supabase, companyId: string, runs: SourceRuns): Promise<EmailOverview> {
  const { data, error } = await supabase
    .from('findings')
    .select('id, title, severity, risk_domains!inner(key)')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .eq('risk_domains.key', 'email')
    .limit(200);
  if (error) throw error;

  return {
    source: runs.statuses.find((s) => s.sourceKey === EMAIL_SOURCE_KEY) ?? null,
    domains: parseEmailDomains(runs.notices.get(EMAIL_SOURCE_KEY) ?? []),
    findings: data
      .map((f) => ({ id: f.id, title: f.title, severity: oneOf(SEVERITIES, f.severity, 'info') }))
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
  };
}

/** Avisos 'observation' de email_dns (ruleId/state del analizador de @warden/risk-analysis). */
export function parseEmailDomains(notices: Json): EmailDomainStatus[] {
  if (!Array.isArray(notices)) return [];
  const domains = new Map<string, EmailDomainStatus>();
  for (const n of notices) {
    const notice = asRecord(n);
    if (notice.kind !== 'observation') continue;
    const d = asRecord(notice.details ?? null);
    if (typeof d.domain !== 'string' || typeof d.ruleId !== 'string') continue;
    let status = domains.get(d.domain);
    if (!status) {
      status = {
        domain: d.domain,
        spf: 'unknown',
        spfAllowsAll: false,
        dmarc: 'unknown',
        dmarcPolicy: null,
        mxCount: null,
        nullMx: false,
      };
      domains.set(d.domain, status);
    }
    const observed = d.state === 'observed';
    switch (d.ruleId) {
      case 'email.spf.records':
        status.spf = observed ? (status.spf === 'multiple' ? 'multiple' : 'present') : d.state === 'absent' ? 'missing' : 'unknown';
        break;
      case 'email.spf.multiple-records':
        if (observed) status.spf = 'multiple';
        break;
      case 'email.spf.allows-all':
        status.spfAllowsAll = observed;
        break;
      case 'email.dmarc.records':
        status.dmarc = observed ? (status.dmarc === 'multiple' ? 'multiple' : 'present') : d.state === 'absent' ? 'missing' : 'unknown';
        break;
      case 'email.dmarc.multiple-records':
        if (observed) status.dmarc = 'multiple';
        break;
      case 'email.dmarc.policy':
        status.dmarcPolicy = observed && typeof d.policy === 'string' ? d.policy : null;
        break;
      case 'email.mx.records':
        status.mxCount = d.state === 'unknown' ? null : typeof d.recordCount === 'number' ? d.recordCount : 0;
        break;
      case 'email.mx.null':
        status.nullMx = observed;
        break;
    }
  }
  return [...domains.values()];
}

/** Activos revisados en abuse.ch (avisos de abusech) y hallazgos abiertos de reputación. */
async function loadReputation(supabase: Supabase, companyId: string, runs: SourceRuns): Promise<ReputationOverview> {
  const { data, error } = await supabase
    .from('findings')
    .select('id, title, severity, evidence, risk_domains!inner(key)')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .eq('risk_domains.key', 'reputation')
    .limit(200);
  if (error) throw error;

  return {
    source: runs.statuses.find((s) => s.sourceKey === REPUTATION_SOURCE_KEY) ?? null,
    subjects: parseReputationSubjects(runs.notices.get(REPUTATION_SOURCE_KEY) ?? []),
    findings: data
      .map((f) => {
        const ev = asRecord(f.evidence);
        return {
          id: f.id,
          title: f.title,
          severity: oneOf(SEVERITIES, f.severity, 'info'),
          subject: typeof ev.subject === 'string' ? ev.subject : null,
        };
      })
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity)),
  };
}

/** Avisos 'observation' de abusech (abusech/mapper.ts); los activos listados van primero. */
export function parseReputationSubjects(notices: Json): ReputationSubjectStatus[] {
  if (!Array.isArray(notices)) return [];
  const subjects = notices.flatMap((n): ReputationSubjectStatus[] => {
    const notice = asRecord(n);
    if (notice.kind !== 'observation') return [];
    const d = asRecord(notice.details ?? null);
    if (typeof d.subject !== 'string') return [];
    const count = (v: unknown) => (typeof v === 'number' ? v : 0);
    return [{
      subject: d.subject,
      type: d.subjectType === 'ip' ? 'ip' : 'domain',
      resolvedFrom: stringArray(d.resolvedFrom),
      urlhausOnline: count(d.urlhausOnline),
      urlhausTotal: count(d.urlhausTotal),
      threatfoxIocs: count(d.threatfoxIocs),
      feodo: typeof d.feodo === 'number' ? d.feodo : null,
      blocklists: stringArray(d.blocklists),
    }];
  });
  const listed = (s: ReputationSubjectStatus) =>
    s.urlhausTotal + s.threatfoxIocs + (s.feodo ?? 0) + s.blocklists.length > 0;
  return subjects.sort(
    (a, b) => Number(listed(b)) - Number(listed(a)) || a.type.localeCompare(b.type) || a.subject.localeCompare(b.subject),
  );
}

/** Una fuente que falló o fue bloqueada no aportó datos, aunque el escaneo terminara. */
export function isSourceFailure(status: string): boolean {
  return status === 'failed' || status === 'blocked';
}

/** Avisos de tipo 'cdn' que guarda el colector internetdb en scan_sources.notices. */
export function parseCdnHosts(notices: Json): CdnHost[] {
  if (!Array.isArray(notices)) return [];
  return notices.flatMap((n) => {
    const notice = asRecord(n);
    if (notice.kind !== 'cdn') return [];
    const d = asRecord(notice.details ?? null);
    const ip = typeof d.ip === 'string' ? d.ip : typeof notice.subject === 'string' ? notice.subject : null;
    if (!ip) return [];
    return [{
      ip,
      provider: typeof d.provider === 'string' ? d.provider : null,
      resolvedFrom: stringArray(d.resolvedFrom),
      portsObserved: typeof d.portsObserved === 'number' ? d.portsObserved : 0,
    }];
  });
}

function severityRank(s: Severity): number {
  return SEVERITIES.indexOf(s);
}

/** grade es char(1) en BD: se recorta por si viniera con relleno. */
export function asGrade(value: string): Grade {
  return oneOf(GRADES, value.trim(), 'F');
}

/** Valor de un CHECK constraint de texto; `fallback` si la BD devolviera algo inesperado. */
export function oneOf<T extends string>(allowed: readonly T[], value: string, fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function asRecord(value: Json): Record<string, Json | undefined> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringArray(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
