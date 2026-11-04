# Warden

Plataforma que califica el riesgo cibernético de una empresa mediante un KRI, usando solo información pasiva (OSINT, sin contacto con la infraestructura evaluada).

## Estructura

```
apps/web            Next.js (Vercel): dashboard y API ligera
apps/worker         Node en contenedor: cola → colectores → hallazgos → score → reporte
packages/collectors Integraciones OSINT, una carpeta por fuente + compuerta no-contact
packages/scoring    Motor del KRI (funciones puras)
packages/ai         Cliente OpenRouter, prompts versionados, validación y redacción
packages/db         Tipos generados de Supabase
packages/shared     Enums y tipos compartidos
packages/config     tsconfig base
supabase/           Migraciones, seed y config local
infra/              docker-compose (worker + SpiderFoot)
docs/               Arquitectura, ADRs, modelo de scoring, fuentes, diagrama ER
```

Más detalle en [docs/architecture.md](docs/architecture.md).

Administración de usuarios locales: [docs/local-users.md](docs/local-users.md).

## Desarrollo local

Guía paso a paso para correr Warden en tu máquina. Los comandos están en PowerShell (Windows); en macOS/Linux usa `cp` en lugar de `Copy-Item`.

### 1. Requisitos (una sola vez)

| Herramienta | Para qué | Instalación |
|---|---|---|
| **Node.js 24** | Ejecutar el proyecto | https://nodejs.org |
| **Git** | Clonar el repo | https://git-scm.com |
| **Docker Desktop** | Supabase local corre en contenedores | https://www.docker.com/products/docker-desktop |
| **Supabase CLI v3** (3.0.0 o posterior) | `pnpm db:start`, `db:reset`, `db:types` | `scoop install supabase` (o `npm i -g supabase`); si ya la tienes: `scoop update supabase` |

Verifica:

```powershell
node --version; docker --version; supabase --version
```

### 2. Clonar e instalar dependencias

```powershell
git clone https://github.com/Warden-OSINT/Warden.git
cd Warden
```

Warden usa **pnpm** (gestor de paquetes con soporte de monorepos), no npm. `corepack`, que viene con Node, instala la versión fijada en `package.json`. Este comando deja `pnpm` en el PATH sin permisos de administrador:

```powershell
corepack enable pnpm --install-directory "$env:APPDATA\npm"
```

Cierra y vuelve a abrir la terminal, y luego:

```powershell
pnpm install
```

### 3. Levantar la base de datos local

Abre **Docker Desktop** y espera a que esté corriendo. Después:

```powershell
pnpm db:start
```

La primera vez tarda unos minutos (descarga imágenes). Aplica migraciones y seeds, e imprime URLs y llaves; puedes volver a verlas con `supabase status`.

### 4. Variables de entorno

```powershell
Copy-Item .env.example .env
```

En **`.env`** (raíz, lo lee el worker) completa:

- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: la **Publishable key** (`sb_publishable_...`).
- `SUPABASE_SECRET_KEY`: la **Secret key** (`sb_secret_...`).

Crea **`apps/web/.env.local`** (Next.js solo lee variables de su propia carpeta) con **solo** estas líneas:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
WARDEN_DEV_SKIP_AUTH=false
```

> ⚠️ **Nunca pongas `SUPABASE_SECRET_KEY` en `apps/web`.** Es la llave de service role: omite RLS y solo la usa el worker.

### 5. Correr el proyecto

```powershell
pnpm dev
```

- Web: http://localhost:3000
- Supabase Studio (panel de la BD): http://127.0.0.1:54323

### 6. Iniciar sesión

El seed local crea un admin activo en cada `db:start` / `db:reset`: usuario `admin@warden.test`; la contraseña está en el comentario de [supabase/seeds/dev-admin.sql](supabase/seeds/dev-admin.sql). Solo existe en local; `supabase db push --remote` no ejecuta seeds.

Para ver el dashboard sin Supabase (datos de ejemplo, sin login), arranca solo la web con `WARDEN_DEV_SKIP_AUTH=true`:

```powershell
$env:WARDEN_DEV_SKIP_AUTH = "true"; pnpm --filter @warden/web dev
```

### Comandos del día a día

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Web + worker |
| `pnpm db:start` / `supabase stop` | Prende / apaga Supabase local |
| `pnpm db:reset` | Recrea la BD desde migraciones + seed (**borra datos locales**) |
| `pnpm db:types` | Regenera `packages/db/src/database.types.ts` tras una migración |
| `pnpm typecheck` / `pnpm test` | Lo que corre el CI; debe pasar antes de abrir un PR |

### Problemas comunes

| Síntoma | Solución |
|---|---|
| `Unable to find package manager binary` | `pnpm` no está en el PATH: repite el paso 2 y reabre la terminal. |
| `failed to connect to the docker API` | Docker Desktop no está abierto. |
| `Your project's URL and Key are required` | Falta la llave en `apps/web/.env.local`, o no reiniciaste `pnpm dev`. |
| Inicias sesión pero no ves datos | Tu perfil no está activo; en Studio → SQL Editor: `update public.profiles set role = 'admin', is_active = true where id = (select id from auth.users where email = 'tu@email');` |
| Un escaneo se queda "En cola" | El worker apunta a otra base: `SUPABASE_URL` y `SUPABASE_SECRET_KEY` del `.env` raíz deben ser los de `supabase status` (local), no los de la nube. Reinicia `pnpm dev`. |
| Escaneo "Con fallos": `dns.google no respondió…` | La red bloquea DNS por HTTPS (pasa en la red de la universidad, incluso vía hotspot si el teléfono comparte esa Wi-Fi). Usa datos móviles; si https://api.ipify.org muestra una IP `131.178.x.x`, sigues saliendo por el Tec. El historial está en **Escaneos**. |

### Entornos reales: primer admin

Regístrate y ejecuta en SQL:

```sql
update public.profiles set role = 'admin', is_active = true where id = '<tu-user-id>';
```

## Convenciones

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivos y carpetas | kebab-case | `score-gauge.tsx`, `run-scan.ts` |
| Componentes y tipos | PascalCase | `ScoreGauge`, `CollectorResult` |
| Paquetes internos | `@warden/*` | `@warden/scoring` |
| Tablas y columnas | snake_case, tablas en plural | `scan_sources` |
| Migraciones | `YYYYMMDDHHMMSS_verbo_objeto.sql` | `20261001000500_create_scans_findings.sql` |
| Carpeta de colector | igual a `sources.source_key` | `collectors/src/crtsh/` |
| Prompts | `nombre.vN.ts`, nunca editar una versión publicada | `executive-summary.v1.ts` |
| Colas | snake_case | `scan_requests` |
