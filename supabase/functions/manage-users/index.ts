import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createUserAdminHandler, UserAdminError, type ManagedUser } from './handler.ts';

// Solo el runtime de Supabase recibe esta llave; Next.js usa la sesión del admin.
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function fail(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') {
    throw new UserAdminError(409, 'Ese correo ya está registrado');
  }
  throw new UserAdminError(500, 'No se pudo completar la operación de usuarios');
}

Deno.serve(createUserAdminHandler({
  async authorize(token) {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    // getUser ya verificó la firma; el emisor limita esta función al Auth local.
    try {
      const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
      const issuer = new URL(payload.iss);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(issuer.hostname) || issuer.pathname !== '/auth/v1') return null;
    } catch { return null; }
    const { data: profile } = await supabase.from('profiles').select('role, is_active').eq('id', user.id).single();
    return profile?.is_active && profile.role === 'admin' ? user.id : null;
  },
  async execute(actorId, command) {
    if (command.action === 'list') {
      const { data, error } = await supabase.auth.admin.listUsers({ page: command.page, perPage: 50 });
      fail(error);
      const ids = data.users.map((user) => user.id);
      if (!ids.length) return { users: [], hasMore: false };
      const { data: profiles, error: profileError } = await supabase.from('profiles').select('*').in('id', ids);
      fail(profileError);
      const users: ManagedUser[] = data.users.map((user) => {
        const profile = profiles?.find((entry) => entry.id === user.id);
        return { id: user.id, email: user.email ?? '', fullName: profile?.full_name ?? '',
          role: profile?.role === 'admin' ? 'admin' : 'analyst', isActive: profile?.is_active ?? false,
          createdAt: user.created_at };
      });
      return { users, hasMore: data.users.length === 50 };
    }
    let targetId: string;
    if (command.action === 'create') {
      const { data, error } = await supabase.auth.admin.createUser({ email: command.email,
        password: command.password, email_confirm: true, user_metadata: { full_name: command.fullName } });
      fail(error);
      if (!data.user) throw new UserAdminError(500, 'No se pudo crear el usuario');
      targetId = data.user.id;
      // El trigger crea el perfil inactivo. La activación se hace en una operación explícita posterior.
      const { error: profileError } = await supabase.from('profiles').update({ role: command.role })
        .eq('id', targetId).select('id').single();
      if (profileError) {
        await supabase.auth.admin.deleteUser(targetId);
        fail(profileError);
      }
    } else {
      targetId = command.id;
      if (command.action === 'password') {
        const { error } = await supabase.auth.admin.updateUserById(targetId, { password: command.password });
        fail(error);
      } else {
        const { error } = await supabase.from('profiles').update({ full_name: command.fullName,
          role: command.role, is_active: command.isActive }).eq('id', targetId).select('id').single();
        fail(error);
      }
    }
    const { error: auditError } = await supabase.from('audit_log').insert({ actor_id: actorId,
      action: `user.${command.action}`, entity_type: 'profiles', entity_id: targetId });
    if (auditError) return { warning: 'El cambio se guardó, pero no se pudo registrar en la auditoría' };
    return { success: true };
  },
}, Deno.env.get('WARDEN_LOCAL_USER_ADMIN_ENABLED') === 'true'));
