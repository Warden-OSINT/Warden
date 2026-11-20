# Administración local de usuarios

La ruta `/settings/users` permite a un **admin activo** crear cuentas con nombre,
usuario y contraseña, editar nombre/rol, activar o desactivar accesos y
cambiar contraseñas sin enviar correos. Puedes crear e ingresar como `analista`:
internamente se utiliza `analista@warden.test` en Supabase Auth. Los identificadores
admiten de 3 a 32 letras ASCII, números, puntos, guiones o guiones bajos y se
normalizan a minúsculas. El login sigue aceptando correos completos. La
verificación de correo y MFA quedan pendientes.

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
   `manage-users` y le pasa `WARDEN_LOCAL_USER_ADMIN_ENABLED=true` desde
   `[edge_runtime.secrets]` en `supabase/config.toml` (solo aplica en local).
   Si Supabase ya estaba corriendo antes de traer esta función, reinícialo con
   `npx supabase stop` y `pnpm db:start` (los datos se conservan).

   Supabase inyecta automáticamente `SUPABASE_URL` y
   `SUPABASE_SERVICE_ROLE_KEY` en su runtime de funciones. No copies esa llave a
   Next.js. Para depurar con recarga en caliente puedes seguir usando
   `npx supabase functions serve manage-users --env-file supabase/functions/.env.local`
   (copiando antes `supabase/functions/.env.example`).

5. Ejecuta `pnpm --filter @warden/web dev`. Entra con `admin@warden.test` y la
   contraseña de desarrollo `warden-dev-admin`, y abre Configuración → Usuarios → Administrar.
6. Crea una cuenta, actívala explícitamente en el listado, cierra sesión y comprueba
   el ingreso con las nuevas credenciales. Comprueba también que un analista no
   puede acceder a la administración y que desactivarlo retira su acceso a los
   datos protegidos por RLS.

No necesitas `db:reset` para esta función: utiliza el esquema existente. Ese comando
borra los datos de desarrollo y vuelve a aplicar seeds; úsalo solo si deseas
recrear la base local.

## Seguridad y alcance

- Next.js solo usa la llave publicable y la sesión del usuario. Las Server Actions
  verifican su perfil antes de invocar la función.
- `manage-users` verifica cada JWT mediante `auth.getUser(token)`, exige un emisor
  de Auth en localhost/127.0.0.1/::1 y consulta que el perfil siga siendo admin
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
- La página se deshabilita con `NODE_ENV=production` o una URL de Supabase remota.
  No desplegar esta función en Cloud: la futura administración productiva deberá
  diseñar verificación por correo, MFA y políticas de sesiones.

## Verificación

`pnpm typecheck` comprueba la web y el handler compartido. El adaptador Deno se
comprueba con `npx deno check --config supabase/functions/manage-users/deno.json supabase/functions/manage-users/index.ts`.
`pnpm test` incluye las
pruebas del handler: autorización, modo deshabilitado, validación de contraseñas,
roles, protección de la propia cuenta y errores sin datos sensibles. Para validar
el adaptador Deno y las operaciones reales de Auth se necesita levantar Supabase
local y seguir el flujo de preparación anterior.
