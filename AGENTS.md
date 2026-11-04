# AGENTS.md — Contexto del proyecto Warden

Guía para developers y agentes de IA (Claude Code, Cursor, Copilot, Codex, etc.) que trabajen en este repositorio. Léela completa antes de hacer cambios. Si algo de aquí contradice el código, **el código manda**: actualiza este archivo en el mismo PR.

---

## 1. Qué es Warden

Warden es una plataforma que **califica el riesgo cibernético de una empresa** mediante un **KRI** (Key Risk Indicator): un puntaje numérico y una letra A–F, global y por dominio de riesgo.

La regla que define el producto: **solo se usa información pasiva (OSINT)**. Warden **nunca** envía tráfico a la infraestructura de la empresa evaluada. Consulta registros públicos (logs de Certificate Transparency, DNS público, feeds de reputación, repositorios públicos), pero no escanea puertos, no hace requests HTTP a sus servidores, no hace fuzzing.

> ⚠️ **Regla no negociable (no-contact):** cualquier código que contacte directamente activos de la empresa evaluada es un bug grave, no una feature. Está protegido en tres capas: tipo TypeScript, compuerta en runtime y CHECK constraint en la BD (ver §6).

### Alcance: una sola empresa

Warden es un proyecto universitario desarrollado para **una empresa real que lo contrató**. Esa empresa es la única que usa Warden y **la única que se evalúa**: no se evalúan proveedores ni terceros. El esquema admite varias filas en `companies`, pero en la práctica habrá una sola empresa con sus dominios y activos. Consecuencias:

- Las fuentes que exigen demostrar control del dominio (p. ej. HIBP) son viables: la empresa verifica sus propios dominios una vez.
- Las cuentas y llaves de servicios de pago deben ser **de la empresa**, no del equipo, para que sigan funcionando al terminar el proyecto.

### Usuarios y roles

| Rol | Puede |
|---|---|
| `analyst` | Leer todo lo operativo, registrar empresas y activos, clasificar (triage) hallazgos, solicitar escaneos. |
| `admin` | Todo lo anterior + configurar fuentes, pesos del KRI, programación, alertas y usuarios. |

Los usuarios nuevos se crean con `is_active = false`; un admin los activa en `public.profiles`.

### Los 6 dominios de riesgo

| key | Nombre | Fuente prevista |
|---|---|---|
| `exposure` | Exposición de servicios | Shodan InternetDB ✅ (SpiderFoot pasivo previsto) |
| `email` | Seguridad de correo (SPF/DKIM/DMARC/MX) | DNS público `email_dns` ✅ (SPF/DMARC/MX); checkdmarc previsto |
| `certs` | Certificados (CT logs + CAA) | crt.sh ✅ |
| `secrets` | Secretos filtrados en repos públicos | gitleaks ✅ (repos de activos `code_org`) |
| `reputation` | Listas de malware/phishing/botnets | abuse.ch ✅ (URLhaus, ThreatFox, Feodo) |
| `impersonation` | Typosquatting | `typosquat` ✅ (técnicas de dnstwist, solo vía dns.google) |

Estos valores deben coincidir en tres lugares: `packages/shared/src/index.ts`, los CHECK constraints de las migraciones y `supabase/seed.sql`.

---

## 2. Estado actual (octubre 2026)

| Área | Estado |
|---|---|
| Esquema de BD, RLS, colas, cron | ✅ Completo (`supabase/migrations/`) |
| Login con Supabase Auth | ✅ `apps/web/src/app/(auth)/login` |
| Usuarios locales | ✅ `/settings/users`: creación, nombre/rol, activación y contraseñas mediante la función local `manage-users`; requiere Supabase local, admin activo y función habilitada. Correo verificado y MFA pendientes (`docs/local-users.md`). |
| Dashboard | 🟡 Datos reales de Supabase (`lib/dashboard-data.ts`): registro de la empresa, paneles de exposición, correo y reputación, escaneo manual, confirmación de activos y habilitar `internetdb` (admin). KRI y notas por dominio desde `scores` (dominios sin datos marcados como cobertura parcial) y aviso si el último escaneo disparó una alerta. Sin sesión y con `WARDEN_DEV_SKIP_AUTH` usa `mock-dashboard.ts` |
| `POST /api/scans` | ✅ Encola escaneos manuales |
| Worker (cola → colectores → persistencia) | ✅ Funciona |
| Colectores del pipeline | ✅ `crtsh` (subdominios + hallazgos de `certs`: comodines, vencimientos, CAA), `typosquat` (dominios parecidos → `impersonation`), `gitleaks` (repos públicos de activos `code_org` → `secrets`; requiere `git` y `gitleaks` en el worker), `internetdb` (IPs → hallazgos de `exposure`, avisos de CDN), `email_dns` (SPF/DMARC/MX → hallazgos de `email`) y `abusech` (URLhaus/ThreatFox/Feodo → hallazgos de `reputation`; requiere `ABUSECH_AUTH_KEY`). Se habilitan desde la tarjeta **Fuentes de datos** del dashboard (admin). `hibp` sigue fuera |
| Motor de scoring | ✅ `@warden/scoring` (`computeScore`, puro) + `pipeline/score.ts` en el worker; pesos v1 en `seed.sql` (puntos por severidad/confianza como SUPUESTO) |
| Resúmenes con IA | ✅ Tras calificar, el worker encola `report_requests` (`request_report`) y genera el resumen con `@warden/ai` (`pipeline/report.ts`): contexto con nota, dominios y títulos de los hallazgos más severos, pasado por `redact()`. Se guarda en `reports` como `draft` (borrador sin revisión humana). Requiere `OPENROUTER_API_KEY` y `OPENROUTER_MODEL` |
| Análisis de correo / credenciales en brechas | 🟡 `@warden/risk-analysis` y adaptadores DNS/HIBP implementados; aún fuera de `runScan` y del catálogo productivo (ver `docs/risk-analysis.md`) |
| Página Escaneos (`/scans`) | ✅ Historial con estado, KRI y resultado por fuente (`lib/scan-history.ts`) |
| Página Hallazgos (`/findings`) | ✅ Filtros, evidencia y triage (`triageFinding`; motivo obligatorio para falso positivo / riesgo aceptado) |
| Página Activos (`/assets`) | ✅ Inventario con filtros, conteo de hallazgos abiertos, alta manual (entra confirmada) y confirmación/descarte individual o masivo (`lib/assets.ts`, `setAssetsStatus`, `addAsset`) |
| Página Reportes (`/reports`) | ✅ Un reporte por escaneo calificado (`lib/reports.ts`): KRI, notas por dominio, cobertura, fuentes, hallazgos abiertos y alertas; imprimible/PDF desde el navegador. Resumen ejecutivo con IA (estado, riesgos, recomendaciones y botón Regenerar) |
| Configuración (`/settings`) | ✅ Usuarios, **Pesos del KRI** (crear y activar versiones; `lib/scoring-settings.ts`) y **Alertas** (umbral, destinatarios e historial). Editar requiere admin |
| Alertas | 🟡 El worker registra `grade_drop` / `threshold_crossed` tras calificar (`pipeline/alerts.ts`), canal `in_app`. Envío por correo/webhook pendiente |
| Outbox SIEM/SOAR, archivado | 🔴 Solo tablas |

**El modelo de scoring está definido en [docs/scoring-model.md](docs/scoring-model.md); no lo cambies sin acordarlo con el equipo.** Los puntos por severidad y factores por confianza de la versión 1 siguen como SUPUESTO. Con datos reales, KRI y notas son `null` hasta que el worker guarde el primer puntaje en `scores`. Qué está hecho y qué falta del KRI (IA, envío de alertas, HIBP…): [docs/kri-plan.md](docs/kri-plan.md).

---

## 3. Stack

- **Lenguaje:** TypeScript en todo (ver [ADR 0001](docs/adr/0001-monorepo-typescript.md)). TS 7, `strict`, `noUncheckedIndexedAccess`.
- **Monorepo:** pnpm workspaces + Turborepo. Node 24. `pnpm@10`.
- **Web:** Next.js 16 (App Router) + React 19, CSS Modules (sin Tailwind ni librería de UI). Desplegada en Vercel.
- **Worker:** Node + `tsx`, en contenedor Docker (Railway/Fly/VM).
- **Datos:** Supabase — Postgres, Auth, Storage, colas (`pgmq`) y `pg_cron`.
- **IA:** OpenRouter (API compatible con OpenAI) para resúmenes ejecutivos.
- **Validación:** `zod` v4.
- **Tests:** `vitest`.
- **OSINT externo:** SpiderFoot (contenedor aparte, solo módulos pasivos).

---

## 4. Estructura del repositorio

```
Warden-/
├── apps/
│   ├── web/                    @warden/web — Next.js (Vercel)
│   │   └── src/
│   │       ├── app/
│   │       │   ├── (auth)/login/        Login (Client Component, Supabase Auth)
│   │       │   ├── (dashboard)/         Layout con TopNav + página principal
│   │       │   ├── api/scans/route.ts   POST → rpc('request_scan')
│   │       │   ├── layout.tsx           Root layout (lang="es")
│   │       │   └── globals.css          Tokens de color (--bg, --grade-a … --grade-f)
│   │       ├── components/              Componentes UI + *.module.css
│   │       │   ├── dashboard/           Gauge, activos, dominios, tendencia, hallazgos
│   │       │   ├── reports/             Lista y vista imprimible de reportes, alertas
│   │       │   └── settings/            Pesos del KRI y reglas de alerta
│   │       ├── lib/
│   │       │   ├── supabase/client.ts   Cliente para Client Components
│   │       │   ├── supabase/server.ts   Cliente para Server Components / Route Handlers
│   │       │   ├── dashboard-types.ts   Formas que consumen los componentes del dashboard
│   │       │   ├── dashboard-data.ts    loadDashboard(): consultas a Supabase con la sesión (RLS)
│   │       │   ├── reports.ts           Reportes por escaneo calificado (scores)
│   │       │   ├── alerts.ts            Alertas recientes
│   │       │   ├── scoring-settings.ts  Versiones de pesos y alert_settings
│   │       │   └── mock-dashboard.ts    Datos de ejemplo (solo dev sin sesión)
│   │       └── proxy.ts                 "Middleware" de Next 16: refresca sesión, redirige a /login
│   └── worker/                 @warden/worker — consumidor de colas
│       ├── Dockerfile          Construir desde la raíz: docker build -f apps/worker/Dockerfile .
│       └── src/
│           ├── index.ts        Loop: queue_read → runScan → queue_delete
│           ├── config.ts       Variables de entorno validadas con zod
│           ├── supabase.ts     Cliente con service role (omite RLS)
│           ├── jobs/run-scan.ts         Orquesta un escaneo (estados, reintentos)
│           └── pipeline/
│               ├── collect.ts  Ejecuta colectores tras la compuerta no-contact; registra scan_sources
│               └── persist.ts  Upsert de activos (pending) y hallazgos (por fingerprint)
├── packages/                   Lógica compartida, consumida como TS fuente (sin build)
│   ├── shared/                 @warden/shared — enums y tipos (dominios, severidades, colas…)
│   ├── db/                     @warden/db — tipos generados de Supabase (NO editar a mano)
│   ├── collectors/             @warden/collectors — un colector por carpeta + compuerta + registro
│   │   └── src/
│   │       ├── types.ts        Contrato Collector / NormalizedFinding
│   │       ├── registry.ts     Mapa de colectores activos
│   │       ├── no-contact-guard.ts
│   │       ├── fingerprint.ts  Huella estable para deduplicar hallazgos
│   │       ├── crtsh/          collector.ts + mapper.ts (subdominios) + certs.ts (hallazgos de certs) + tests
│   │       ├── typosquat/      fuzz.ts (permutaciones) + collector.ts/mapper.ts + tests (impersonation)
│   │       ├── gitleaks/       collector.ts (GitHub API + git + gitleaks) + mapper.ts + tests (secrets)
│   │       ├── internetdb/     collector.ts + mapper.ts + tests — puertos/CVE por IP (exposure)
│   │       ├── abusech/        collector.ts + mapper.ts + tests — URLhaus/ThreatFox/Feodo (reputation)
│   │       ├── dns/            resolve-ipv4.ts + doh.ts — consultas vía dns.google (DoH)
│   │       ├── email_dns/      provider.ts (DoH) + collector.ts/mapper.ts — observaciones de correo → hallazgos
│   │       ├── hibp/           provider.ts + mapper.ts — brechas agregadas por dominio
│   │       ├── http/           public-json.ts — cliente HTTP restringido compartido
│   │       └── providers.test.ts
│   ├── risk-analysis/          @warden/risk-analysis — analizadores y ejecutor común
│   │   └── src/
│   │       ├── types.ts        Contratos de módulos, proveedores y resultados
│   │       ├── schemas.ts      Validación común de dominios y evidencia
│   │       ├── target.ts       Atribución a dominios confirmados
│   │       ├── registry.ts     Registro de módulos de análisis
│   │       ├── runner.ts       runRiskAnalysis: ejecuta proveedores y analiza evidencia
│   │       ├── email/          analyzer.ts + schemas.ts
│   │       ├── credentials/    analyzer.ts + schemas.ts
│   │       ├── index.ts        Exports públicos del paquete
│   │       └── analysis.test.ts
│   ├── scoring/                @warden/scoring — motor del KRI (funciones puras, pendiente)
│   ├── ai/                     @warden/ai — cliente OpenRouter, prompts versionados, redact(), schemas
│   └── config/                 @warden/config — tsconfig.base.json
├── supabase/
│   ├── migrations/             SQL versionado (fuente de verdad del esquema)
│   ├── seed.sql                Catálogos: risk_domains y sources
│   ├── seeds/dev-admin.sql     Admin de desarrollo (solo local)
│   └── config.toml
├── infra/docker-compose.yml    Worker + SpiderFoot en local
├── docs/                       architecture.md, scoring-model.md, sources.md, adr/, diagrams/ (ER en Mermaid)
├── frontend/frontend/          ⚠️ LEGADO: prototipo Vite del login. Ya portado a apps/web. No desarrollar aquí.
└── .github/workflows/ci.yml    typecheck + test + validación de migraciones
```

### Grafo de dependencias entre paquetes

```
@warden/web     → shared, db
@warden/worker  → shared, db, collectors, scoring, ai
collectors      → shared, risk-analysis, zod
risk-analysis   → shared, zod (análisis puro y ejecutor de proveedores)
scoring         → shared
ai              → (zod)
db, shared      → (nada)
```

Reglas:
- `packages/*` **no importan de `apps/*`**.
- `apps/web` **no importa** `collectors` ni `ai`: el trabajo pesado, el tráfico a fuentes OSINT y las llaves viven en el worker.
- Los paquetes exportan TS fuente vía `"exports": { ".": "./src/index.ts" }`. Si la web necesita un paquete nuevo, añádelo a `transpilePackages` en `apps/web/next.config.ts`.
- `@warden/risk-analysis` contiene contratos/registro/ejecutor y módulos `email` y `credentials`.
  `credentials` no es un valor de `RiskDomainKey` ni reemplaza `secrets`; su incorporación al KRI
  requiere una decisión explícita y migraciones. `email_dns` está registrado en `collectAll` y en el
  seed (vía `email_dns/collector.ts`); `hibp` sigue sin registrarse.

---

## 5. Arquitectura y flujo de datos

```
┌────────────┐  POST /api/scans   ┌──────────────────────────────┐
│  apps/web  │ ─────────────────▶ │ Supabase                     │
│  (Vercel)  │  rpc request_scan  │  scans (queued)              │
│  sesión +  │ ◀──── lectura ──── │  pgmq: scan_requests         │◀── pg_cron cada 15 min:
│  RLS       │                    │  findings, scores, ...       │    enqueue_due_scans()
└────────────┘                    └──────────────┬───────────────┘
                                                 │ queue_read (service role)
                                                 ▼
                                  ┌──────────────────────────────┐      ┌─────────────┐
                                  │ apps/worker (contenedor)     │ ───▶ │ Fuentes OSINT│
                                  │ runScan:                     │      │ crt.sh, ...  │
                                  │  1. collect  (no-contact)    │      └─────────────┘
                                  │  2. persist  (upsert)        │      ┌─────────────┐
                                  │  3. score    (KRI)           │ ───▶ │ SpiderFoot  │
                                  │  4. alerts + report IA       │      └─────────────┘
                                  └──────────────────────────────┘ ───▶ OpenRouter (redactado)
```

### Ciclo de vida de un escaneo

1. **Disparo.** Manual: la web llama `POST /api/scans { companyId }` → `rpc('request_scan')`. Programado: `pg_cron` ejecuta `enqueue_due_scans()` cada 15 min según `schedules`.
2. Se crea una fila en `scans` con `status = 'queued'` y la versión de pesos activa, y se encola `{ scan_id }` en `scan_requests`.
3. El worker hace `queue_read` (visibility timeout = `QUEUE_VISIBILITY_TIMEOUT`, 900 s por defecto) y llama `runScan`:
   - Marca `running`. Carga la empresa y sus activos **confirmados**.
   - **collect** (`pipeline/collect.ts`): por cada colector registrado, aplica `checkCollector`; registra el resultado en `scan_sources` (`ok | failed | skipped | blocked`). Un colector que falla no tumba el escaneo.
   - **persist** (`pipeline/persist.ts`): activos descubiertos → `assets` con `attribution_status = 'pending'` (un analista los confirma). Hallazgos → upsert en `findings` por `(company_id, fingerprint)` **sin tocar el estado de triage**; fuentes en `finding_sources`.
   - **resolve** (`pipeline/resolve.ts`): cierra hallazgos que su fuente dejó de observar en escaneos exitosos consecutivos.
   - **score** (`pipeline/score.ts`): `computeScore` con los hallazgos `open` y la versión de pesos del escaneo; solo cuentan los dominios con alguna fuente `ok`. Guarda `scores` (con `excluded_domains`) y `score_domains`.
   - **alerts** (`pipeline/alerts.ts`): compara la nota con el puntaje anterior y el umbral de `alert_settings`; registra como mucho una alerta `in_app` por escaneo.
   - **report (IA):** `rpc('request_report')` encola `{ score_id }` en `report_requests`. El worker atiende esa cola cuando no hay escaneos (`pipeline/report.ts`) y guarda el resultado en `reports` (`pending` → `draft` o `failed` con `error_message`). Un fallo de la IA nunca tumba el escaneo; la web permite regenerar.
   - Marca `completed` o `failed`.
   - **Progreso y cancelación:** durante la recolección el worker guarda `scans.current_source` y `sources_total` (la web muestra "Consultando X · n de N"). Un miembro puede detenerlo con `rpc('cancel_scan')` → `status = 'cancelled'`; el worker lo revisa cada 3 s (`pipeline/cancellation.ts`), aborta las consultas en vuelo y no persiste ni califica resultados parciales. Uno cancelado en cola se descarta al leerlo.
4. Mientras el escaneo corre, el worker renueva la invisibilidad del mensaje cada tercio del timeout (`queue_set_vt`, `pipeline/visibility.ts`) para que un escaneo largo no se procese dos veces. Tras procesar, `queue_delete`. Si el worker muere (o se apaga), el latido se detiene y el mensaje reaparece al vencer el timeout; tras 3 intentos (`MAX_ATTEMPTS`) el escaneo se marca `failed`. Un mensaje cuyo escaneo ya no existe se descarta.

### Modelo de datos (resumen)

Fuente de verdad: `supabase/migrations/`. Diagrama ER: [docs/diagrams/warden_er_diagram.mmd](docs/diagrams/warden_er_diagram.mmd).

| Grupo | Tablas |
|---|---|
| Identidad | `profiles` (1:1 con `auth.users`, `role`, `is_active`), `audit_log` |
| Catálogos | `risk_domains`, `sources`, `source_credentials` (solo `secret_ref`, nunca el secreto) |
| Empresas | `companies`, `assets` (`pending/confirmed/discarded`), `schedules` |
| Scoring | `scoring_weights` (versionadas, una activa), `scoring_weight_items` |
| Escaneos | `scans`, `scan_sources`, `findings` (único por `company_id, fingerprint`), `finding_sources` |
| Resultados | `scores`, `score_domains`, `reports` (guarda `model_used`, `prompt_version`, `context_hash`) |
| Alertas / integración | `alert_settings`, `alerts`, `integration_outbox` (patrón outbox), `archives` |

Funciones SQL relevantes: `app_role()`, `is_member()`, `is_admin()`, `request_scan()`, `enqueue_due_scans()`, `activate_scoring_weights()` (valida que los pesos sumen 100), `queue_read()`, `queue_set_vt()`, `queue_delete()`.

---

## 6. Seguridad — reglas que un agente NO debe romper

1. **No-contact en tres capas.** Si agregas un colector:
   - `Collector.isNoContact` es el tipo literal `true` (un colector activo no compila).
   - `checkCollector()` exige que código **y** BD (`sources.is_no_contact`, `is_enabled`) coincidan.
   - CHECK `sources_enabled_requires_no_contact` en BD.
   No debilites ninguna de las tres. Si una herramienta tiene modos activos (p. ej. dnstwist con descarga de páginas, SpiderFoot), desactívalos explícitamente.
2. **Dos llaves de Supabase, dos mundos.**
   - `apps/web`: solo `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + sesión del usuario → todo pasa por RLS.
   - `apps/worker`: `SUPABASE_SECRET_KEY` (service role, omite RLS). **Nunca** debe aparecer en `apps/web`, en variables `NEXT_PUBLIC_*`, ni en Vercel.
   - Excepción para administración **local**: `supabase/functions/manage-users` recibe `SUPABASE_SERVICE_ROLE_KEY` del runtime de Supabase y usa `auth.admin`. Exige JWT válido con emisor local, admin activo y `WARDEN_LOCAL_USER_ADMIN_ENABLED=true`. No desplegarla en Cloud ni copiar su llave a la web. Ver `docs/local-users.md`.
3. **RLS siempre activo.** Toda tabla nueva necesita `enable row level security` + políticas, siguiendo el patrón de `20261001000800_enable_rls_policies.sql`, **y GRANTs explícitos** a `authenticated`/`service_role` (ver `20261014000200_grant_data_api_privileges.sql`): Supabase ya no expone automáticamente las tablas nuevas de `public` a la Data API. Los analistas solo pueden actualizar `status`, `status_reason`, `status_by` de `findings`.
4. **Funciones `security definer`** llevan `set search_path = ''`, nombres calificados (`public.x`) y `revoke/grant execute` explícitos.
5. **IA:** todo contexto pasa por `redact()` antes de ir a OpenRouter. La evidencia cruda (secretos, emails) nunca sale de Warden.
6. **Secretos de fuentes:** en BD solo se guarda `secret_ref` (nombre de la variable de entorno del worker).
7. `WARDEN_DEV_SKIP_AUTH=true` solo funciona fuera de producción; no lo uses como mecanismo real.

---

## 7. Convenciones

| Elemento | Convención | Ejemplo |
|---|---|---|
| Archivos y carpetas | kebab-case | `score-gauge.tsx`, `run-scan.ts` |
| Componentes y tipos | PascalCase | `ScoreGauge`, `CollectorResult` |
| Funciones y variables | camelCase | `collectAll`, `scanId` |
| Paquetes internos | `@warden/*` | `@warden/scoring` |
| Tablas y columnas | snake_case, tablas en plural | `scan_sources` |
| Migraciones | `YYYYMMDDHHMMSS_verbo_objeto.sql` | `20261001000500_create_scans_findings.sql` |
| Carpeta de colector | igual a `sources.source_key` | `collectors/src/crtsh/` |
| Prompts | `nombre.vN.ts`; **nunca editar una versión publicada** | `executive-summary.v1.ts` |
| Colas | snake_case | `scan_requests` |

Estilo de código:
- **Idioma:** comentarios, mensajes de error, textos de UI y commits en **español**. Identificadores en inglés.
- Comentarios cortos que explican el **porqué**, no el qué.
- Imports con alias `@/` dentro de `apps/web`; `import type` para tipos.
- Comillas simples, punto y coma, 2 espacios, trailing commas.
- Exports con nombre (excepto `page.tsx` / `layout.tsx` de Next).
- Enums como arrays `as const` + tipo derivado en `@warden/shared`, no `enum` de TS.
- Variables de entorno validadas con zod en el worker (`config.ts`).

### Web (Next.js)
- Server Components por defecto; `'use client'` solo si hay estado, eventos o hooks de navegación.
- En el servidor usa `@/lib/supabase/server`; en el cliente `@/lib/supabase/client`. Ambos tipados con `Database`.
- Estilos con CSS Modules y los tokens de `globals.css` (`var(--surface)`, `var(--grade-c)`…). Tema oscuro. No agregar Tailwind ni librerías de UI sin acordarlo.
- Next 16 usa `src/proxy.ts` (antes `middleware.ts`).
- Route Handlers: valida el body, delega en una RPC con la sesión del usuario, traduce `42501` a 403.
- Las formas del dashboard viven en `lib/dashboard-types.ts` (`DashboardData`, `CompanyOverview`, `ExposureHost`, …); `dashboard-data.ts` y `mock-dashboard.ts` producen la misma forma.
- Las mutaciones del dashboard son Server Actions en `app/(dashboard)/actions.ts` con la sesión del usuario; RLS decide el permiso (una actualización filtrada por RLS devuelve 0 filas, no error).

### Base de datos
- **Nunca edites una migración ya aplicada**: crea una nueva.
- Tras cambiar el esquema: `pnpm db:reset` y `pnpm db:types`, y commitea `packages/db/src/database.types.ts`.
- Si agregas un valor a un CHECK, actualízalo también en `@warden/shared`.

---

## 8. Recetas comunes

### Agregar una fuente OSINT (colector)
1. Documentarla en [docs/sources.md](docs/sources.md): licencia y **por qué es no-contact**.
2. Crear `packages/collectors/src/<source_key>/` con:
   - `collector.ts` que exporta un `Collector` (`isNoContact: true`, respeta `ctx.signal`).
   - `mapper.ts` con la transformación pura de la respuesta → `DiscoveredAsset[]` / `NormalizedFinding[]`.
   - `mapper.test.ts` con vitest.
3. Usar `fingerprint(sourceKey, ruleId, assetValue)` para cada hallazgo. Lo observado que no es hallazgo (p. ej. IPs de CDN omitidas) va en `CollectorResult.notices`; el worker lo guarda en `scan_sources.notices` junto con `assets_returned` / `findings_returned`. **No** incluir datos que cambien entre escaneos (fechas, conteos) o se duplicarán.
4. Registrarlo en `packages/collectors/src/registry.ts`.
5. Insertarlo en `supabase/seed.sql` (deshabilitado por defecto; un admin lo habilita).
6. Si requiere API key: variable en `.env.example` (sección worker) + fila en `source_credentials` con el `secret_ref`.

### Agregar una página al dashboard
1. Crear `apps/web/src/app/(dashboard)/<ruta>/page.tsx` (ya hereda `TopNav`).
2. Componentes en `apps/web/src/components/<área>/` con su `*.module.css`.
3. Consultar con `createClient()` de `@/lib/supabase/server`; RLS filtra por rol.

### Cambiar un prompt de IA
Crear `packages/ai/src/prompts/<nombre>.v(N+1).ts` y cambiar el import. No modificar la versión anterior: `reports.prompt_version` debe reflejar lo que realmente se usó.

### Cambiar el scoring
- Solo funciones puras en `packages/scoring` (sin BD ni red) para poder recalcular históricos.
- Entrada: `ScoringFinding[]` + `WeightItem[]` + dominios con datos; salida: `ScoreResult | null`.
- Cambiar puntos o pesos = **nueva versión** en `scoring_weights` (no editar una usada por escaneos). Cambiar la fórmula exige actualizar [docs/scoring-model.md](docs/scoring-model.md).

---

## 9. Comandos

```bash
corepack enable
pnpm install
cp .env.example .env            # completar con las llaves que imprime `pnpm db:start`
cp .env apps/web/.env.local     # Next.js solo lee variables de su propia carpeta
pnpm db:start                   # Supabase local (Docker): migraciones + seed
pnpm db:types                   # regenera packages/db/src/database.types.ts
pnpm dev                        # web (localhost:3000) + worker
pnpm typecheck                  # tsc en todos los paquetes
pnpm test                       # vitest
pnpm db:reset                   # recrea la BD local desde migraciones + seed
docker compose -f infra/docker-compose.yml up --build   # worker + SpiderFoot
```

Para ver el dashboard sin Supabase: `WARDEN_DEV_SKIP_AUTH=true` (la config `web` de `.claude/launch.json` ya lo hace).

Admin local: `supabase/seeds/dev-admin.sql` crea `admin@warden.test` (contraseña en ese archivo) activo y con rol `admin` en cada `pnpm db:start` / `pnpm db:reset`. Solo aplica en local y CI; `supabase db push` no ejecuta seeds.

Primer admin en un entorno real: regístrate y ejecuta
```sql
update public.profiles set role = 'admin', is_active = true where id = '<tu-user-id>';
```

### Variables de entorno

| Variable | Dónde | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web | URL de Supabase |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web | Llave pública (RLS) |
| `WARDEN_DEV_SKIP_AUTH` | web (solo dev) | Salta el login |
| `SUPABASE_URL` | worker | URL de Supabase |
| `SUPABASE_SECRET_KEY` | worker | Service role — **solo worker** |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | worker | Resúmenes con IA |
| `SPIDERFOOT_URL` | worker | API de SpiderFoot |
| `ABUSECH_AUTH_KEY` | worker | Auth-Key gratuita de abuse.ch (URLhaus, ThreatFox); cuenta de la empresa |
| `HIBP_API_KEY` | worker | API de brechas; requiere suscripción y dominio previamente verificado en HIBP |
| `QUEUE_VISIBILITY_TIMEOUT` | worker | Segundos de invisibilidad del mensaje (900) |

---

## 10. Flujo de trabajo con Git y CI

- Flujo de ramas: `feat/...` / `fix/...` → `dev` → `staging` → `main`.
  - `dev` (rama predeterminada): integración. Los PR de trabajo apuntan aquí.
  - `staging`: preproducción. Solo recibe PR desde `dev`.
  - `main`: producción. Solo recibe PR desde `staging`.
- Las tres ramas están protegidas con rulesets: sin push directo, sin force push ni borrado, y el PR exige que pasen los checks `check`, `migrations` y `flujo-ramas`. `flujo-ramas` (`.github/workflows/branch-flow.yml`) rechaza PR que se salten el flujo.
- Los PR de promoción (`dev → staging`, `staging → main`) se fusionan con **merge commit**, nunca squash ni rebase: así las ramas comparten historia y no reaparecen conflictos.
- CI (`.github/workflows/ci.yml`) corre `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test` y levanta Supabase para validar migraciones + seed. **Antes de abrir un PR, `pnpm typecheck` y `pnpm test` deben pasar localmente.**
- Si cambias dependencias, commitea `pnpm-lock.yaml`.
- Commits en español, en imperativo y descriptivos (p. ej. "Agrega colector de checkdmarc").

## 11. Checklist para agentes antes de terminar una tarea

- [ ] ¿El cambio respeta la regla no-contact?
- [ ] ¿Ninguna llave secreta llegó a `apps/web`?
- [ ] ¿Las tablas nuevas tienen RLS y políticas?
- [ ] ¿Los enums siguen sincronizados entre `@warden/shared`, CHECKs y seed?
- [ ] ¿Regeneraste `database.types.ts` si cambió el esquema?
- [ ] ¿`pnpm typecheck` y `pnpm test` pasan?
- [ ] ¿Actualizaste `docs/` (y este archivo) si cambió la arquitectura, una fuente o una convención?
- [ ] ¿No desarrollaste en `frontend/frontend/` (legado)?

---

## 12. Módulos de análisis de correo y credenciales

`@warden/risk-analysis` agrupa analizadores puros (`email`, `credentials`), sus contratos y el
ejecutor `runRiskAnalysis`. Los proveedores que hacen las consultas externas (`emailDnsProvider`,
`hibpProvider`) viven en `@warden/collectors` y usan el cliente HTTP restringido de
`collectors/src/http/public-json.ts` (hosts permitidos, solo HTTPS, sin redirects, timeout y
límite de tamaño). Contratos, ejemplo de uso y limitaciones: [docs/risk-analysis.md](docs/risk-analysis.md).

Reglas para trabajar con estos módulos:

- **Integración:** `email_dns` entra al pipeline como `Collector` (`email_dns/collector.ts`): llama
  al proveedor y a `emailModule.analyze` y convierte lo negativo en hallazgos de `email` con
  severidades marcadas como SUPUESTO en `mapper.ts`; todas las observaciones van a
  `scan_sources.notices`. Si una consulta SPF/DMARC/MX falla, la fuente queda `failed`.
  `www.` se quita del dominio principal (es un host, no un dominio de correo). `hibp` y el
  módulo `credentials` siguen sin integrarse.
- **Sin scoring:** los analizadores reportan observaciones (`observed | absent | unknown`) con cobertura `partial`,
  sin puntajes, letras ni severidades. Un fallo de consulta nunca significa ausencia de riesgo.
- **`credentials` no es un `RiskDomainKey`** ni reemplaza `secrets`; su resultado lleva
  `riskDomain: null` hasta decidir cómo entra al KRI (ver [docs/sources.md](docs/sources.md)).
- **Correo:** solo inspecciona publicación DNS (SPF, DMARC, MX y selectores DKIM conocidos).
  No enumerar selectores DKIM por fuerza bruta.
- **HIBP:** requiere `HIBP_API_KEY` (solo en el worker) y dominios verificados por la empresa.
  Warden no inicia verificaciones. Conservar y mostrar la atribución a HIBP (CC BY 4.0) en
  cualquier interfaz o reporte. Nunca guardar aliases, correos ni contraseñas.
- **Al integrar `hibp`:** registrar la fuente en el seed deshabilitada, cargar las
  políticas desde `sources` (nunca desde el navegador), mantener las tres capas no-contact y
  agregar `@warden/risk-analysis` como dependencia explícita del worker si se importa directo.
  Hoy hay dos contratos paralelos (`Collector` y `EvidenceProvider`); conviene unificarlos o
  definir cómo se conectan antes de integrar.
