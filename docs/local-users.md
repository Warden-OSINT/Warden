# Administración de usuarios

La ruta `/settings/users` permite a un **admin activo** crear cuentas con nombre,
usuario y contraseña, editar nombre/rol, activar o desactivar accesos y
cambiar contraseñas sin enviar correos. Puedes crear e ingresar como `analista`:
internamente se utiliza `analista@warden.test` en Supabase Auth. Los identificadores
admiten de 3 a 32 letras ASCII, números, puntos, guiones o guiones bajos y se
normalizan a minúsculas. El login sigue aceptando correos completos. La
verificación en dos pasos (TOTP) es obligatoria para todas las cuentas (ver
[MFA](#verificación-en-dos-pasos-mfa)); la verificación de correo queda pendiente.

## Preparación

1. Abre Docker Desktop y espera a que arranque el motor Linux.
2. Desde la raíz ejecuta `npx supabase start`. Aplica migraciones y seeds locales.
3. Configura `apps/web/.env.local` con **solo** la URL local y la llave publicable:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<llave-publicable-local>
   WARDEN_DEV_SKIP_AUTH=false
   ```

4. No hace falta levantar la función aparte: `supabase start` sirve
   `manage-users` y le pasa `WARDEN_USER_ADMIN_ENABLED=true` desde
   `[edge_runtime.secrets]` en `supabase/config.toml` (solo aplica en local).
   Si Supabase ya estaba corriendo antes de traer esta función, reinícialo con
   `npx supabase stop` y `pnpm db:start` (los datos se conservan).

   Supabase inyecta automáticamente `SUPABASE_URL` y
   `SUPABASE_SERVICE_ROLE_KEY` en su runtime de funciones. No copies esa llave a
   Next.js. Para depurar con recarga en caliente puedes seguir usando
   `npx supabase functions serve manage-users --env-file supabase/functions/.env.local`
   (copiando antes `supabase/functions/.env.example`).

5. Ejecuta `pnpm --filter @warden/web dev`. Entra con `admin@warden.test` y la
   contraseña de desarrollo `warden-dev-admin`. En el primer ingreso Warden pide
   vincular una app autenticadora (Google Authenticator u otra TOTP) y luego abre el
   dashboard. Abre Configuración → Usuarios → Administrar.
6. Crea una cuenta, actívala explícitamente en el listado, cierra sesión y comprueba
   el ingreso con las nuevas credenciales. Comprueba también que un analista no
   puede acceder a la administración y que desactivarlo retira su acceso a los
   datos protegidos por RLS.

No necesitas `db:reset` para esta función: utiliza el esquema existente. Ese comando
borra los datos de desarrollo y vuelve a aplicar seeds; úsalo solo si deseas
recrear la base local.

## Verificación en dos pasos (MFA)

Usa el soporte nativo de Supabase Auth: factor `totp`, niveles AAL1 (solo
contraseña) y AAL2 (contraseña + código). `supabase/config.toml` habilita
`[auth.mfa.totp]` (`enroll_enabled` y `verify_enabled`) en el stack local; en un
proyecto hospedado hay que activarlo en Authentication → MFA.

- **Obligatoria para todos.** Tras la contraseña, `/login` manda a `/mfa`. Si la
  cuenta no tiene factor verificado, `/mfa` muestra el QR y la clave manual y
  activa el factor al verificar el primer código. Si ya lo tiene, pide el código
  de 6 dígitos. Verificar sube la sesión a AAL2.
- **Proxy.** `src/proxy.ts` redirige a `/mfa` toda sesión AAL1 (reglas puras
  `mfaGate` y `hasFreshMfa` en `lib/mfa.ts`). Con MFA vigente, `/login` y `/mfa`
  mandan al dashboard (volver a iniciar sesión crearía una sesión AAL1 nueva);
  para cambiar de cuenta se usa "Cerrar sesión".
- **Una vez por semana.** La sesión de Supabase persiste (cookie de 400 días y el
  refresh conserva AAL2), así que el código no se pide en cada visita. El proxy
  lee la hora del último código TOTP del claim `amr` y, si pasaron 7 días
  (`MFA_REVERIFY_MS`), manda a `/mfa` a escribirlo otra vez sin pedir la
  contraseña. Cerrar sesión obliga a contraseña + código. Este límite semanal lo
  aplica la web; RLS solo exige AAL2.
- **RLS.** La migración `20261124000100_require_mfa_aal2.sql` hace que
  `app_role()` devuelva `null` si `auth.jwt()->>'aal'` no es `aal2`, así que
  `is_member()` e `is_admin()` (y todas sus políticas y RPCs) niegan el acceso
  con AAL1 aunque el JWT siga vigente. La política "own profile read" no depende
  de `app_role()`: el login aún puede comprobar `is_active` antes del código. El
  worker usa service role y no se ve afectado.
- **`manage-users`** rechaza tokens que no sean `aal2`.
- **Mis autenticadores.** Configuración → Seguridad lista los factores del
  usuario, permite agregar otro (p. ej. un teléfono nuevo) y darlos de baja. Al
  dar de baja, Auth baja la sesión a AAL1 y Warden vuelve a pedir el código o, si
  era el único, un factor nuevo.
- **Teléfono perdido.** Un admin abre el usuario en Configuración → Usuarios y
  pulsa **Restablecer MFA** (`resetMfa`: borra sus factores con
  `auth.admin.mfa`). No se puede restablecer la propia; si el único admin pierde
  su autenticador en local, borra sus filas de `auth.mfa_factors` desde Studio.
- Para probar sin teléfono, cualquier generador TOTP (SHA-1, 6 dígitos, 30 s)
  sirve con la clave manual que muestra la inscripción.

## Seguridad y alcance

- Next.js solo usa la llave publicable y la sesión del usuario. Las Server Actions
  verifican su perfil antes de invocar la función.
- `manage-users` verifica cada JWT mediante `auth.getUser(token)` contra el Auth
  de su propio proyecto, exige `aal2` y consulta que el perfil siga siendo admin
  activo. La verificación explícita permite `verify_jwt=false` sin exponer la
  función a usuarios anónimos.
- La llave administrativa vive únicamente en el runtime de Supabase. La función
  utiliza las APIs oficiales `auth.admin`; no escribe hashes ni tablas de Auth.
- Las cuentas nuevas quedan inactivas por el trigger existente. La activación es
  una acción independiente. No puedes quitarte el rol admin ni desactivarte.
- El login comprueba `is_active` después de autenticar y cierra la sesión si la
  cuenta todavía no está habilitada.
- Las contraseñas requieren 6 caracteres y como máximo 72 bytes. No se guardan
  en perfiles, logs ni auditoría ni se devuelven al navegador. Se envían a Auth
  para su almacenamiento mediante hash.
- La auditoría registra actor, acción e id de usuario. Un fallo de auditoría
  devuelve una advertencia porque el cambio ya pudo haberse guardado.
- Desactivar una cuenta retira sus permisos mediante RLS, incluso con un JWT
  vigente. No elimina la cuenta de Auth ni impide por sí solo que Auth emita una
  sesión. El cambio de contraseña no garantiza la revocación inmediata de
  sesiones ya emitidas; la administración global de sesiones queda pendiente.
- No hay borrado de cuentas. Desactivarlas conserva la atribución histórica.
- Funciona igual en local y en Supabase Cloud. En Cloud se despliega con
  `supabase functions deploy manage-users` (toma `verify_jwt = false` de
  `config.toml`; la función verifica el token por su cuenta) y se habilita con
  `supabase secrets set WARDEN_USER_ADMIN_ENABLED=true`. Sin ese secreto responde
  403. Para apagarla: `supabase secrets unset WARDEN_USER_ADMIN_ENABLED`.
- La llave con privilegios la inyecta el runtime de Supabase
  (`SUPABASE_SECRET_KEYS`, o `SUPABASE_SERVICE_ROLE_KEY` en proyectos con llaves
  heredadas); nunca se copia a Vercel ni a Next.js.
- Los identificadores sin `@` se guardan como `usuario@warden.test`, un dominio
  que no recibe correo: esas cuentas no pueden recuperar su contraseña por
  correo; un admin la cambia desde la página. La verificación por correo sigue
  pendiente.

## Verificación

`pnpm typecheck` comprueba la web y el handler compartido. El adaptador Deno se
comprueba con `npx deno check --config supabase/functions/manage-users/deno.json supabase/functions/manage-users/index.ts`.
`pnpm test` incluye las
pruebas del handler: autorización, modo deshabilitado, validación de contraseñas,
roles, protección de la propia cuenta y errores sin datos sensibles. Para validar
el adaptador Deno y las operaciones reales de Auth se necesita levantar Supabase
local y seguir el flujo de preparación anterior.
