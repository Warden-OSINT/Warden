-- SOLO DESARROLLO LOCAL: crea un admin activo para no registrarlo a mano tras cada
-- `pnpm db:reset`. Supabase solo aplica seeds en `db start`/`db reset` locales (y en CI);
-- `supabase db push` no los ejecuta. Nunca usar estas credenciales fuera de local.
--
--   Email:      admin@warden.test
--   Contraseña: warden-dev-admin

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  -- GoTrue falla al iniciar sesión si estos tokens son null en vez de cadena vacía.
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-00000000a001',
  'authenticated',
  'authenticated',
  'admin@warden.test',
  extensions.crypt('warden-dev-admin', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}',
  '{"full_name": "Admin de desarrollo"}',
  now(),
  now(),
  '', '', '', ''
);

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values (
  '00000000-0000-4000-8000-00000000a001',
  '00000000-0000-4000-8000-00000000a001',
  '00000000-0000-4000-8000-00000000a001',
  'email',
  '{"sub": "00000000-0000-4000-8000-00000000a001", "email": "admin@warden.test", "email_verified": true}',
  now(),
  now(),
  now()
);

-- El trigger on_auth_user_created ya creó el perfil como analyst inactivo.
update public.profiles
set role = 'admin', is_active = true
where id = '00000000-0000-4000-8000-00000000a001';
