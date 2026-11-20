'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { displayIdentifier, normalizeIdentifier, toAuthEmail } from '@/lib/local-user';
import { isLocalUserAdminEnabled } from '@/lib/local-user-admin';
import type { ManagedUser, UserCommand } from '../../../../../../../supabase/functions/manage-users/handler';

export interface UserActionResult {
  error?: string;
  message?: string;
  warning?: string;
}

interface UserResponse extends UserActionResult {
  users?: ManagedUser[];
  hasMore?: boolean;
}

async function invoke(command: UserCommand): Promise<UserResponse> {
  if (!isLocalUserAdminEnabled()) return { error: 'La administración de usuarios solo está habilitada con Supabase local' };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sesión expirada' };
  const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single();
  if (profile?.role !== 'admin' || !profile.is_active) return { error: 'Solo un administrador activo puede gestionar usuarios' };
  try {
    const { data, error } = await supabase.functions.invoke('manage-users', { body: command });
    if (error) {
      if (error.context instanceof Response) {
        const body = await error.context.json().catch(() => null);
        if (typeof body?.error === 'string') return { error: body.error };
      }
      return { error: 'No se pudo contactar la función manage-users. Reinicia Supabase local (`npx supabase stop` y `pnpm db:start`).' };
    }
    return data as { users?: ManagedUser[]; hasMore?: boolean; error?: string; warning?: string };
  } catch {
    return { error: 'No se pudo conectar con Supabase local' };
  }
}

export async function loadUsers(page: number) {
  return invoke({ action: 'list', page });
}

export async function createUser(_previous: UserActionResult, form: FormData): Promise<UserActionResult> {
  if (form.get('password') !== form.get('confirmPassword')) return { error: 'Las contraseñas no coinciden' };
  const result = await invoke({ action: 'create', email: String(form.get('email') ?? ''),
    password: String(form.get('password') ?? ''), fullName: String(form.get('fullName') ?? ''),
    role: String(form.get('role') ?? '') as 'admin' | 'analyst' });
  if (result.error) return { error: result.error };
  revalidatePath('/settings/users');
  const username = displayIdentifier(toAuthEmail(normalizeIdentifier(String(form.get('email') ?? ''))));
  return { message: `Usuario «${username}» creado. Actívalo en la lista para que pueda entrar.`, warning: result.warning };
}

export async function updateUser(_previous: UserActionResult, form: FormData): Promise<UserActionResult> {
  const result = await invoke({ action: 'update', id: String(form.get('id') ?? ''),
    fullName: String(form.get('fullName') ?? ''), role: String(form.get('role') ?? '') as 'admin' | 'analyst',
    isActive: form.get('isActive') === 'on' });
  if (result.error) return { error: result.error };
  revalidatePath('/settings/users');
  return { message: 'Usuario actualizado', warning: result.warning };
}

export async function changeUserPassword(_previous: UserActionResult, form: FormData): Promise<UserActionResult> {
  if (form.get('password') !== form.get('confirmPassword')) return { error: 'Las contraseñas no coinciden' };
  const result = await invoke({ action: 'password', id: String(form.get('id') ?? ''), password: String(form.get('password') ?? '') });
  if (result.error) return { error: result.error };
  return { message: 'Contraseña actualizada', warning: result.warning };
}
