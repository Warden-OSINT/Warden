// Inventario de activos de la empresa evaluada con sus hallazgos abiertos.

import { ASSET_TYPES } from '@warden/shared';
import type { AssetRow, AttributionStatus } from './dashboard-types';
import { loadActiveCompany, oneOf } from './dashboard-data';
import { createClient } from './supabase/server';

// Igual que en el dashboard: una sola empresa, cabe en una página y se filtra en el cliente.
const ASSETS_LIMIT = 2000;
const ATTRIBUTION_STATUSES = ['pending', 'confirmed', 'discarded'] as const satisfies readonly AttributionStatus[];

export interface AssetDetail extends AssetRow {
  firstSeen: string;
  openFindings: number;
}

export type AssetsState =
  | { kind: 'ready'; company: { name: string; primaryDomain: string }; assets: AssetDetail[] }
  | { kind: 'no-company' }
  /** Dev con WARDEN_DEV_SKIP_AUTH y sin sesión: no hay datos que consultar. */
  | { kind: 'no-session' };

export async function loadAssets(): Promise<AssetsState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: 'no-session' };

  const company = await loadActiveCompany(supabase);
  if (!company) return { kind: 'no-company' };

  const [assetsRes, findingsRes] = await Promise.all([
    supabase
      .from('assets')
      .select('id, asset_type, value, attribution_status, discovery_source, first_seen, last_seen')
      .eq('company_id', company.id)
      .order('value')
      .limit(ASSETS_LIMIT),
    supabase
      .from('findings')
      .select('asset_id')
      .eq('company_id', company.id)
      .eq('status', 'open')
      .not('asset_id', 'is', null),
  ]);
  if (assetsRes.error) throw assetsRes.error;
  if (findingsRes.error) throw findingsRes.error;

  const findingsByAsset = new Map<string, number>();
  for (const f of findingsRes.data) {
    if (f.asset_id) findingsByAsset.set(f.asset_id, (findingsByAsset.get(f.asset_id) ?? 0) + 1);
  }

  return {
    kind: 'ready',
    company: { name: company.name, primaryDomain: company.primary_domain },
    assets: assetsRes.data.map((a) => ({
      id: a.id,
      type: oneOf(ASSET_TYPES, a.asset_type, 'domain'),
      value: a.value,
      status: oneOf(ATTRIBUTION_STATUSES, a.attribution_status, 'pending'),
      discoverySource: a.discovery_source === 'auto' ? 'auto' : 'manual',
      firstSeen: a.first_seen,
      lastSeen: a.last_seen,
      openFindings: findingsByAsset.get(a.id) ?? 0,
    })),
  };
}
