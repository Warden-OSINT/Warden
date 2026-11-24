-- MFA obligatoria para todos: un usuario solo cuenta como miembro (y por tanto
-- como admin) si su sesión es AAL2, es decir, si verificó su factor TOTP en este
-- inicio de sesión. Con AAL1 todas las políticas basadas en is_member()/is_admin()
-- niegan el acceso, aunque el JWT siga vigente. La lectura del propio perfil
-- ("own profile read": id = auth.uid()) sigue disponible para que el login
-- compruebe is_active antes del segundo factor.
-- El service role (worker) no pasa por app_role(): omite RLS.
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;
