'use server';

// Acciones del dashboard. Todas usan la sesión del usuario: RLS decide quién puede qué
// (miembros registran empresa/activos y piden escaneos; solo admin habilita fuentes).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { IMPLEMENTED_SOURCES, loadActiveCompany } from '@/lib/dashboard-data';

export interface ActionResult {
  error?: string;
}

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function registerCompany(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get('name') ?? '').trim();
  const domain = String(formData.get('domain') ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
  if (!name) return { error: 'El nombre es obligatorio' };
  if (!DOMAIN_RE.test(domain)) return { error: 'Dominio inválido (ejemplo: empresa.com.mx)' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sesión expirada' };

  // Empresa y dominio principal (lo declara el usuario, así que entra confirmado) en una sola
  // transacción: si algo falla, no queda una empresa sin su dominio.
  const { error } = await supabase.rpc('register_company', { p_name: name, p_domain: domain });
  if (error) {
    return { error: error.code === '23505' ? 'Ese dominio ya está registrado' : permissionMessage(error) };
  }

  revalidatePath('/');
  return {};
}

type AttributionStatus = 'confirmed' | 'discarded' | 'pending';
const ATTRIBUTION_STATUSES: readonly string[] = ['confirmed', 'discarded', 'pending'];

export async function setAssetStatus(assetId: string, status: AttributionStatus): Promise<ActionResult> {
  return setAssetsStatus([assetId], status);
}

/** Cambia la atribución de varios activos a la vez (p. ej. confirmar los subdominios de crt.sh). */
export async function setAssetsStatus(assetIds: string[], status: AttributionStatus): Promise<ActionResult> {
  if (!ATTRIBUTION_STATUSES.includes(status)) return { error: 'Estado inválido' };
  if (assetIds.length === 0) return {};
  if (assetIds.length > 2000) return { error: 'Demasiados activos a la vez' };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sesión expirada' };

  const { data, error } = await supabase
    .from('assets')
    .update({ attribution_status: status, confirmed_by: status === 'confirmed' ? user.id : null })
    .in('id', assetIds)
    .select('id');
  if (error) return { error: permissionMessage(error) };
  // RLS no devuelve error al filtrar filas: sin filas actualizadas no hubo permiso.
  if (data.length === 0) return { error: 'No tienes permiso para modificar estos activos' };

  revalidatePath('/');
  revalidatePath('/assets');
  return {};
}

const ASSET_PATTERNS = {
  domain: DOMAIN_RE,
  subdomain: DOMAIN_RE,
  ip: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/,
  ip_range: /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\/(?:3[0-2]|[12]?\d)$/,
  asn: /^AS\d{1,10}$/,
  // Solo GitHub: gitleaks clona desde github.com (docs/sources.md).
  code_org: /^github\.com\/[a-z0-9](?:[a-z0-9-]{0,38})$/,
} as const;

const ASSET_EXAMPLES: Record<keyof typeof ASSET_PATTERNS, string> = {
  domain: 'empresa.com.mx',
  subdomain: 'portal.empresa.com.mx',
  ip: '203.0.113.10',
  ip_range: '203.0.113.0/24',
  asn: 'AS64500',
  code_org: 'github.com/empresa',
};

/**
 * Registra un activo a mano. Lo declara un analista, así que entra confirmado (como el
 * dominio principal) y el siguiente escaneo ya lo incluye.
 */
export async function addAsset(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const type = String(formData.get('type') ?? '');
  if (!(type in ASSET_PATTERNS)) return { error: 'Tipo de activo inválido' };
  const assetType = type as keyof typeof ASSET_PATTERNS;
  let value = String(formData.get('value') ?? '').trim();
  value = assetType === 'asn' ? value.toUpperCase().replace(/^(\d)/, 'AS$1') : value.toLowerCase();
  if (assetType === 'code_org') value = value.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (assetType === 'domain' || assetType === 'subdomain') {
    value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  }
  if (!ASSET_PATTERNS[assetType].test(value)) {
    return { error: `Valor inválido (ejemplo: ${ASSET_EXAMPLES[assetType]})` };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sesión expirada' };

  const company = await loadActiveCompany(supabase);
  if (!company) return { error: 'Registra primero la empresa a evaluar' };

  const { error } = await supabase.from('assets').insert({
    company_id: company.id,
    asset_type: assetType,
    value,
    discovery_source: 'manual',
    attribution_status: 'confirmed',
    confirmed_by: user.id,
  });
  if (error) return { error: error.code === '23505' ? 'Ese activo ya está registrado' : permissionMessage(error) };

  revalidatePath('/');
  revalidatePath('/assets');
  return {};
}

/** Solo admin (política "admins manage" de sources) y solo fuentes con colector implementado. */
export async function setSourceEnabled(sourceKey: string, enabled: boolean): Promise<ActionResult> {
  if (!(IMPLEMENTED_SOURCES as readonly string[]).includes(sourceKey)) {
    return { error: 'Esa fuente no tiene colector implementado' };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('sources')
    .update({ is_enabled: enabled })
    .eq('source_key', sourceKey)
    .select('source_key');
  if (error) return { error: permissionMessage(error) };
  if (data.length === 0) return { error: 'Solo un admin puede habilitar fuentes' };

  revalidatePath('/');
  return {};
}

export async function requestScan(companyId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_scan', { p_company_id: companyId });
  if (error) return { error: permissionMessage(error) };

  revalidatePath('/');
  revalidatePath('/scans');
  return {};
}

/** Detiene un escaneo en cola o en curso; el worker corta las consultas en vuelo. */
export async function cancelScan(scanId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('cancel_scan', { p_scan_id: scanId });
  if (error) return { error: permissionMessage(error) };
  if (!data) return { error: 'El escaneo ya había terminado' };

  revalidatePath('/');
  revalidatePath('/scans');
  return {};
}

/** Pide (o vuelve a pedir) el resumen con IA de un reporte; lo genera el worker. */
export async function requestReport(scoreId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('request_report', { p_score_id: scoreId });
  if (error) return { error: permissionMessage(error) };

  revalidatePath(`/reports/${scoreId}`);
  return {};
}

const TRIAGE_STATUSES = ['open', 'false_positive', 'accepted', 'resolved'] as const;
type TriageStatus = (typeof TRIAGE_STATUSES)[number];

/**
 * Clasifica un hallazgo. RLS solo deja cambiar status, status_reason y status_by, y exige
 * status_by = usuario actual: así el worker distingue lo cerrado por un analista (no lo
 * reabre) de lo que él mismo resolvió.
 */
export async function triageFinding(findingId: string, status: TriageStatus, reason: string): Promise<ActionResult> {
  if (!(TRIAGE_STATUSES as readonly string[]).includes(status)) return { error: 'Estado inválido' };
  const trimmed = reason.trim().slice(0, 500);
  // Descartar o aceptar un riesgo sin explicar por qué no deja rastro útil para auditoría.
  if ((status === 'false_positive' || status === 'accepted') && !trimmed) {
    return { error: 'Explica el motivo para marcarlo así' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sesión expirada' };

  const { data, error } = await supabase
    .from('findings')
    .update({ status, status_reason: trimmed || null, status_by: user.id })
    .eq('id', findingId)
    .select('id');
  if (error) return { error: permissionMessage(error) };
  if (data.length === 0) return { error: 'No tienes permiso para clasificar este hallazgo' };

  revalidatePath('/findings');
  revalidatePath('/');
  return {};
}

function permissionMessage(error: { code?: string; message: string }): string {
  return error.code === '42501' ? 'No tienes permiso para esta acción' : error.message;
}
