// Versiones de pesos del KRI y configuración de alertas. Las lee cualquier miembro
// (scoring_weights) o solo un admin (alert_settings, por RLS).

import {
  CONFIDENCES,
  GRADES,
  RISK_DOMAIN_KEYS,
  SEVERITIES,
  type Confidence,
  type Grade,
  type RiskDomainKey,
  type Severity,
} from '@warden/shared';
import type { Json } from '@warden/db';
import { createClient } from './supabase/server';

export interface WeightVersion {
  id: string;
  version: number;
  isActive: boolean;
  effectiveFrom: string;
  weights: Record<RiskDomainKey, number>;
  /** De la v1 en adelante son iguales en todos los dominios; se muestran los del primero. */
  severityPoints: Record<Severity, number>;
  confidenceFactors: Record<Confidence, number>;
}

export interface AlertSettings {
  thresholdGrade: Grade | null;
  recipients: string[];
}

function numbers<K extends string>(keys: readonly K[], value: Json | undefined): Record<K, number> {
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(keys.map((k) => [k, typeof obj[k] === 'number' ? obj[k] : 0])) as Record<K, number>;
}

export async function loadScoringSettings(): Promise<
  { kind: 'ready'; isAdmin: boolean; versions: WeightVersion[] } | { kind: 'no-session' }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'no-session' };

  const [{ data: isAdmin }, versionsRes] = await Promise.all([
    supabase.rpc('is_admin'),
    supabase
      .from('scoring_weights')
      .select('id, version, is_active, effective_from, scoring_weight_items(weight, severity_points, confidence_factors, risk_domains!inner(key))')
      .order('version', { ascending: false }),
  ]);
  if (versionsRes.error) throw versionsRes.error;

  return {
    kind: 'ready',
    isAdmin: isAdmin === true,
    versions: versionsRes.data.map((v) => {
      const items = v.scoring_weight_items;
      const byKey = new Map(items.map((i) => [i.risk_domains.key, Number(i.weight)]));
      return {
        id: v.id,
        version: v.version,
        isActive: v.is_active,
        effectiveFrom: v.effective_from,
        weights: Object.fromEntries(RISK_DOMAIN_KEYS.map((k) => [k, byKey.get(k) ?? 0])) as Record<RiskDomainKey, number>,
        severityPoints: numbers(SEVERITIES, items[0]?.severity_points),
        confidenceFactors: numbers(CONFIDENCES, items[0]?.confidence_factors),
      };
    }),
  };
}

export async function loadAlertSettings(): Promise<
  { kind: 'ready'; isAdmin: boolean; settings: AlertSettings } | { kind: 'no-session' }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'no-session' };

  const [{ data: isAdmin }, settingsRes] = await Promise.all([
    supabase.rpc('is_admin'),
    supabase.from('alert_settings').select('threshold_grade, recipients').limit(1).maybeSingle(),
  ]);
  if (settingsRes.error) throw settingsRes.error;
  const grade = settingsRes.data?.threshold_grade?.trim();
  const recipients = settingsRes.data?.recipients;

  return {
    kind: 'ready',
    isAdmin: isAdmin === true,
    settings: {
      // F no se puede cruzar (no hay nota peor): se guarda así cuando no hay umbral.
      thresholdGrade: grade && grade !== 'F' && (GRADES as readonly string[]).includes(grade) ? (grade as Grade) : null,
      recipients: Array.isArray(recipients) ? recipients.filter((r): r is string => typeof r === 'string') : [],
    },
  };
}
