// Hallazgos de la empresa evaluada con su fuente, activo y estado de triage.

import {
  CONFIDENCES,
  FINDING_ASSET_SCOPE_COLUMNS,
  FINDING_STATUSES,
  RISK_DOMAIN_KEYS,
  SEVERITIES,
  type Confidence,
  type FindingStatus,
  type RiskDomainKey,
  type Severity,
  isAssetInScope,
} from '@warden/shared';
import type { Json } from '@warden/db';
import { loadActiveCompany, oneOf } from './dashboard-data';
import { createClient } from './supabase/server';

// Una sola empresa con pocas fuentes: cabe en una página y se filtra en el cliente.
const FINDINGS_LIMIT = 1000;

export interface FindingDetail {
  id: string;
  title: string;
  domain: RiskDomainKey;
  severity: Severity;
  confidence: Confidence;
  status: FindingStatus;
  statusReason: string | null;
  /** Lo cerró el worker al dejar de observarlo (status_by null), no un analista. */
  autoResolved: boolean;
  observedAt: string;
  asset: string | null;
  /**
   * Estado del activo cuando está fuera de alcance (descartado o manual sin confirmar):
   * el hallazgo no cuenta en el KRI ni en el dashboard. null si cuenta.
   */
  assetOutOfScope: 'discarded' | 'unconfirmed' | null;
  sources: string[];
  evidence: Json;
}

export type FindingsState =
  | { kind: 'ready'; company: { name: string; primaryDomain: string }; findings: FindingDetail[] }
  | { kind: 'no-company' }
  /** Dev con WARDEN_DEV_SKIP_AUTH y sin sesión: no hay datos que consultar. */
  | { kind: 'no-session' };

export async function loadFindings(): Promise<FindingsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'no-session' };

  const company = await loadActiveCompany(supabase);
  if (!company) return { kind: 'no-company' };

  const [findingsRes, { data: sources }] = await Promise.all([
    supabase
      .from('findings')
      .select(
        `id, title, severity, confidence, status, status_reason, status_by, observed_at, evidence, risk_domains!inner(key), assets(value, ${FINDING_ASSET_SCOPE_COLUMNS}), finding_sources(source_key)`,
      )
      .eq('company_id', company.id)
      .order('observed_at', { ascending: false })
      .limit(FINDINGS_LIMIT),
    supabase.from('sources').select('source_key, name'),
  ]);
  if (findingsRes.error) throw findingsRes.error;
  const sourceName = new Map((sources ?? []).map((s) => [s.source_key, s.name]));

  return {
    kind: 'ready',
    company: { name: company.name, primaryDomain: company.primary_domain },
    findings: findingsRes.data.map((f) => {
      const status = oneOf(FINDING_STATUSES, f.status, 'open');
      return {
        id: f.id,
        title: f.title,
        domain: oneOf(RISK_DOMAIN_KEYS, f.risk_domains.key, 'exposure'),
        severity: oneOf(SEVERITIES, f.severity, 'info'),
        confidence: oneOf(CONFIDENCES, f.confidence, 'low'),
        status,
        statusReason: f.status_reason,
        autoResolved: status === 'resolved' && f.status_by === null,
        observedAt: f.observed_at,
        asset: f.assets?.value ?? null,
        assetOutOfScope: isAssetInScope(f.assets)
          ? null
          : f.assets?.attribution_status === 'discarded' ? 'discarded' : 'unconfirmed',
        sources: f.finding_sources.map((s) => sourceName.get(s.source_key) ?? s.source_key),
        evidence: f.evidence,
      };
    }),
  };
}
