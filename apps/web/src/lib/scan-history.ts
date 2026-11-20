// Historial de escaneos de la empresa evaluada con el resultado de cada fuente
// (tablas scans + scan_sources), para diagnosticar fallos sin ir a la BD.

import {
  RISK_DOMAIN_KEYS,
  SCAN_SOURCE_STATUSES,
  SCAN_STATUSES,
  type Grade,
  type RiskDomainKey,
  type ScanSourceStatus,
  type ScanStatus,
} from '@warden/shared';
import { asGrade, isSourceFailure, loadActiveCompany, oneOf, parseCdnHosts } from './dashboard-data';
import type { ScanSummary } from './dashboard-types';
import { createClient } from './supabase/server';

const HISTORY_LIMIT = 50;

export interface ScanSourceRun {
  sourceKey: string;
  name: string;
  status: ScanSourceStatus;
  /** Total previo a la migración del desglose; sirve para filas antiguas. */
  itemsReturned: number;
  assetsReturned: number;
  findingsReturned: number;
  /** IPs omitidas por ser de un CDN. */
  cdnCount: number;
  latencyMs: number | null;
  message: string | null;
}

/** Calificación guardada por el worker para un escaneo (tablas scores + score_domains). */
export interface ScanScore {
  score: number;
  grade: Grade;
  /** Variación contra el escaneo calificado anterior; null si es el primero. */
  delta: number | null;
  domains: { key: RiskDomainKey; score: number; grade: Grade }[];
  /** Dominios sin datos en ese escaneo, excluidos del KRI. */
  excludedDomains: RiskDomainKey[];
}

export interface ScanHistoryRow {
  id: string;
  status: ScanStatus;
  trigger: 'manual' | 'scheduled';
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  sources: ScanSourceRun[];
  /** Fuente que el worker consulta ahora (solo en curso) y total de colectores. */
  currentSource: string | null;
  sourcesTotal: number | null;
  /** null si el escaneo no se calificó (anterior al scoring, fallido o sin dominios con datos). */
  score: ScanScore | null;
}

export type ScanHistoryState =
  | { kind: 'ready'; company: { id: string; name: string; primaryDomain: string }; scans: ScanHistoryRow[] }
  | { kind: 'no-company' }
  /** Dev con WARDEN_DEV_SKIP_AUTH y sin sesión: no hay datos que consultar. */
  | { kind: 'no-session' };

export async function loadScanHistory(): Promise<ScanHistoryState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'no-session' };

  const company = await loadActiveCompany(supabase);
  if (!company) return { kind: 'no-company' };

  const [scansRes, { data: sources }] = await Promise.all([
    supabase
      .from('scans')
      .select(
        'id, status, trigger_type, created_at, started_at, finished_at, error_message, sources_total, current:sources!scans_current_source_fkey(name), scan_sources(source_key, status, items_returned, assets_returned, findings_returned, notices, latency_ms, message), scores(global_score, grade, excluded_domains, score_domains(domain_score, grade, risk_domains!inner(key)))',
      )
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
    supabase.from('sources').select('source_key, name'),
  ]);
  if (scansRes.error) throw scansRes.error;
  const sourceName = new Map((sources ?? []).map((s) => [s.source_key, s.name]));

  const isDomain = (key: string): key is RiskDomainKey => (RISK_DOMAIN_KEYS as readonly string[]).includes(key);
  const rows = scansRes.data.map((s) => {
    // scores.scan_id es único: PostgREST lo embebe como objeto (o null), no como arreglo.
    const raw = s.scores;
    const score: Omit<ScanScore, 'delta'> | null = raw
      ? {
          score: Number(raw.global_score),
          grade: asGrade(raw.grade),
          domains: raw.score_domains
            .flatMap((d) => (isDomain(d.risk_domains.key)
              ? [{ key: d.risk_domains.key, score: Number(d.domain_score), grade: asGrade(d.grade) }]
              : []))
            .sort((a, b) => RISK_DOMAIN_KEYS.indexOf(a.key) - RISK_DOMAIN_KEYS.indexOf(b.key)),
          excludedDomains: raw.excluded_domains.filter(isDomain),
        }
      : null;
    return { s, score };
  });

  return {
    kind: 'ready',
    company: { id: company.id, name: company.name, primaryDomain: company.primary_domain },
    scans: rows.map(({ s, score }, i) => ({
      id: s.id,
      status: oneOf(SCAN_STATUSES, s.status, 'failed'),
      trigger: s.trigger_type === 'scheduled' ? 'scheduled' : 'manual',
      createdAt: s.created_at,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
      errorMessage: s.error_message,
      currentSource: s.current?.name ?? null,
      sourcesTotal: s.sources_total,
      sources: s.scan_sources
        .map((r) => ({
          sourceKey: r.source_key,
          name: sourceName.get(r.source_key) ?? r.source_key,
          status: oneOf(SCAN_SOURCE_STATUSES, r.status, 'failed'),
          itemsReturned: r.items_returned,
          assetsReturned: r.assets_returned,
          findingsReturned: r.findings_returned,
          cdnCount: parseCdnHosts(r.notices).length,
          latencyMs: r.latency_ms,
          message: r.message,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      score: score && { ...score, delta: previousScore(rows, i) },
    })),
  };
}

/** Puntaje del escaneo calificado inmediatamente anterior (la lista va del más nuevo al más viejo). */
function previousScore(rows: { score: { score: number } | null }[], index: number): number | null {
  const current = rows[index]?.score;
  const previous = rows.slice(index + 1).find((r) => r.score)?.score;
  return current && previous ? Math.round((current.score - previous.score) * 100) / 100 : null;
}

/** Resumen del escaneo más reciente, en la forma que usa ScanControls. */
export function latestScanSummary(scans: ScanHistoryRow[]): ScanSummary | null {
  const s = scans[0];
  return s
    ? {
        id: s.id,
        status: s.status,
        createdAt: s.createdAt,
        finishedAt: s.finishedAt,
        errorMessage: s.errorMessage,
        sourceFailures: s.sources.some((r) => isSourceFailure(r.status)),
        startedAt: s.startedAt,
        progress: { currentSource: s.currentSource, done: s.sources.length, total: s.sourcesTotal },
      }
    : null;
}
