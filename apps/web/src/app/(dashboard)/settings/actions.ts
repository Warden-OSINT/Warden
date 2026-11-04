'use server';

// Acciones de Configuración (solo admin). Usan la sesión del usuario: RLS ("admins manage")
// rechaza a quien no sea admin, y activate_scoring_weights valida que los pesos sumen 100.

import { CONFIDENCES, GRADES, RISK_DOMAIN_KEYS, SEVERITIES } from '@warden/shared';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

export interface ActionResult {
  error?: string;
  ok?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 20;

function permissionMessage(error: { code?: string; message: string }): string {
  return error.code === '42501' ? 'Solo un administrador puede cambiar esta configuración' : error.message;
}

/** Número no negativo del formulario; NaN si falta o es inválido. */
function readNumber(formData: FormData, name: string): number {
  const raw = String(formData.get(name) ?? '').trim().replace(',', '.');
  const n = raw === '' ? NaN : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * Crea una versión nueva de pesos (inactiva) y, si se pide, la activa. Una versión usada por
 * escaneos no se edita: los puntajes guardados deben poder explicarse con su versión.
 */
export async function createWeightVersion(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const weights = RISK_DOMAIN_KEYS.map((key) => ({ key, weight: readNumber(formData, `weight.${key}`) }));
  const points = Object.fromEntries(SEVERITIES.map((s) => [s, readNumber(formData, `points.${s}`)]));
  const factors = Object.fromEntries(CONFIDENCES.map((c) => [c, readNumber(formData, `factor.${c}`)]));

  if (weights.some((w) => Number.isNaN(w.weight) || w.weight > 100)) return { error: 'Cada peso debe ser un número entre 0 y 100' };
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  if (Math.abs(total - 100) > 0.01) return { error: `Los pesos suman ${total}; deben sumar 100` };
  if (Object.values(points).some(Number.isNaN)) return { error: 'Los puntos por severidad deben ser números no negativos' };
  if (Object.values(factors).some((f) => Number.isNaN(f) || f > 1)) {
    return { error: 'Los factores por confianza deben estar entre 0 y 1' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sesión expirada' };

  const [{ data: latest }, { data: domains, error: domainsError }] = await Promise.all([
    supabase.from('scoring_weights').select('version').order('version', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('risk_domains').select('id, key'),
  ]);
  if (domainsError) return { error: domainsError.message };
  const domainId = new Map((domains ?? []).map((d) => [d.key, d.id]));

  const { data: version, error } = await supabase
    .from('scoring_weights')
    .insert({ version: (latest?.version ?? 0) + 1, created_by: user.id, is_active: false })
    .select('id, version')
    .single();
  if (error) return { error: permissionMessage(error) };

  const { error: itemsError } = await supabase.from('scoring_weight_items').insert(
    weights.map((w) => ({
      weight_version_id: version.id,
      risk_domain_id: domainId.get(w.key)!,
      weight: w.weight,
      severity_points: points,
      confidence_factors: factors,
    })),
  );
  if (itemsError) {
    // Sin dominios la versión no sirve: se borra para no dejarla a medias.
    await supabase.from('scoring_weights').delete().eq('id', version.id);
    return { error: permissionMessage(itemsError) };
  }

  if (formData.get('activate') === 'on') {
    const { error: activateError } = await supabase.rpc('activate_scoring_weights', { p_weight_version_id: version.id });
    if (activateError) return { error: `Versión v${version.version} creada, pero no se activó: ${permissionMessage(activateError)}` };
  }

  revalidatePath('/settings/scoring');
  revalidatePath('/');
  return { ok: `Versión v${version.version} creada${formData.get('activate') === 'on' ? ' y activada' : ''}` };
}

export async function activateWeightVersion(versionId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc('activate_scoring_weights', { p_weight_version_id: versionId });
  if (error) return { error: permissionMessage(error) };
  revalidatePath('/settings/scoring');
  revalidatePath('/');
  return { ok: 'Versión activada: aplica a los escaneos que se encolen desde ahora' };
}

/** Umbral vacío = sin alertas de umbral (solo las de nota que baja). */
export async function saveAlertSettings(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const threshold = String(formData.get('threshold') ?? '').trim();
  if (threshold && !(GRADES as readonly string[]).includes(threshold)) return { error: 'Nota de umbral inválida' };

  const recipients = [...new Set(
    String(formData.get('recipients') ?? '')
      .split(/[\s,;]+/)
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean),
  )];
  const invalid = recipients.find((r) => !EMAIL_RE.test(r));
  if (invalid) return { error: `Correo inválido: ${invalid}` };
  if (recipients.length > MAX_RECIPIENTS) return { error: `Máximo ${MAX_RECIPIENTS} destinatarios` };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sesión expirada' };

  const { data: existing, error: readError } = await supabase.from('alert_settings').select('id').limit(1).maybeSingle();
  if (readError) return { error: permissionMessage(readError) };

  if (!threshold && recipients.length === 0) {
    if (existing) {
      const { data, error } = await supabase.from('alert_settings').delete().eq('id', existing.id).select('id');
      if (error) return { error: permissionMessage(error) };
      // RLS no devuelve error al filtrar filas: sin filas borradas no hubo permiso.
      if (data.length === 0) return { error: 'Solo un administrador puede cambiar esta configuración' };
    }
  } else {
    // threshold_grade es obligatorio en BD: sin umbral se guarda F, que nunca se cruza.
    const row = { threshold_grade: threshold || 'F', recipients, created_by: user.id };
    const { data, error } = existing
      ? await supabase.from('alert_settings').update(row).eq('id', existing.id).select('id')
      : await supabase.from('alert_settings').insert(row).select('id');
    if (error) return { error: permissionMessage(error) };
    if (data.length === 0) return { error: 'Solo un administrador puede cambiar esta configuración' };
  }

  revalidatePath('/settings/alerts');
  return { ok: 'Configuración de alertas guardada' };
}
