# Plan de integración con Splunk

> Plan de trabajo del 18 de noviembre de 2026. Alcance acordado: **alertas y calificación de
> escaneos** primero; los eventos de hallazgos quedan para una fase posterior si hay tiempo.

## Decisión

Warden **empuja** eventos a Splunk por **HTTP Event Collector (HEC)** desde el worker, usando el
patrón outbox que ya existe para el correo (`integration_outbox` + `claim_outbox`), con
`destination = 'siem'` (valor ya permitido por el CHECK desde la migración inicial).

Descartado:

- **Splunk lee Supabase (DB Connect / pull):** exigiría darle credenciales de la BD a Splunk
  (rompe el modelo de dos llaves) y perdería los eventos de transición.
- **Enviar evidencia cruda:** viola la regla 5 de AGENTS.md (secretos y correos no salen de Warden).
- **Enviar el texto del reporte con IA:** es un borrador (`draft`) sin revisión humana; solo se
  manda el enlace.

## Alcance por fase

| Fase | Contenido | Estado |
|---|---|---|
| 1 — Alertas y calificación | `warden:score` por escaneo calificado y `warden:alert` por alerta | ✅ Implementada (rama `feat/splunk`) |
| 2 — Visibilidad y carga inicial | Configuración → Splunk (estado y reintento de fallidos) y carga inicial del último puntaje | ✅ Implementada (rama `feat/splunk-fase2`) |
| 3 — Hallazgos | `warden:finding` (abierto, resuelto, reabierto, triage) | ⬜ si hay tiempo |

## Eventos (fase 1)

Formato HEC (`POST /services/collector/event`, header `Authorization: Splunk <token>`). Se manda
**un evento por petición**: son dos como mucho por escaneo, y así un evento rechazado no arrastra
a los demás. Campos comunes: `time` (epoch en segundos del
`computed_at`), `host: "warden"`, `source: "warden"`, `sourcetype`, `index` (si se configura).

Dentro de `event` siempre va `event_id` (= `integration_outbox.id`): HEC no deduplica, y un
reintento tras un timeout puede duplicar; en Splunk se usa `dedup event_id`.

### `warden:score`

```json
{
  "event_id": 123,
  "event_type": "score",
  "company": { "name": "Empresa", "primary_domain": "empresa.com" },
  "scan_id": "uuid", "score_id": "uuid",
  "global_score": 72.5, "grade": "C",
  "previous_grade": "B",
  "weights_version": 1,
  "domains": [{ "key": "exposure", "score": 60, "grade": "D" }],
  "excluded_domains": ["secrets"],
  "open_findings": { "critical": 0, "high": 2, "medium": 5, "low": 3, "info": 1 },
  "report_url": "https://warden.../reports/<score_id>"
}
```

### `warden:alert`

```json
{
  "event_id": 124,
  "event_type": "alert",
  "alert_type": "threshold_crossed",
  "company": { "name": "Empresa", "primary_domain": "empresa.com" },
  "score_id": "uuid",
  "previous_grade": "B", "new_grade": "D", "threshold_grade": "C",
  "global_score": 58.1,
  "report_url": "https://warden.../reports/<score_id>"
}
```

Solo conteos, notas y títulos agregados: **ninguna evidencia, activo sensible ni correo**. Los
destinatarios de correo de `alert_settings` tampoco se mandan.

## Pasos de implementación (fase 1)

### 1. Migración `supabase/migrations/20261118000100_add_siem_outbox.sql`

- `alter table integration_outbox add column score_id uuid references public.scores (id) on delete cascade;`
  Un reintento del escaneo borra el puntaje anterior; así sus eventos aún no enviados se borran
  con él (igual que `alert_id` para el correo). Índice sobre `score_id`.
- No hace falta cambiar el CHECK de `destination` (`siem` ya existe) ni crear tablas nuevas, así
  que no hay RLS nueva. `claim_outbox` ya filtra por destino.
- `pnpm db:reset` + `pnpm db:types` y commitear `database.types.ts`.

### 2. `@warden/shared`

- `SIEM_EVENT_TYPES = ['score', 'alert'] as const` y su tipo; comentar que el sourcetype es
  `warden:<tipo>`. (En fase 3 se agrega `finding`.)

### 3. Configuración del worker (`apps/worker/src/config.ts` y `.env.example`)

| Variable | Uso |
|---|---|
| `SPLUNK_HEC_URL` | p. ej. `https://splunk.empresa.com:8088`. Sin ella, **no se encolan** eventos `siem` |
| `SPLUNK_HEC_TOKEN` | Token HEC de la empresa, limitado al índice de Warden. **Solo worker** |
| `SPLUNK_INDEX` | Opcional; si se omite, el índice por defecto del token |

`refine`: con `SPLUNK_HEC_URL` es obligatorio `SPLUNK_HEC_TOKEN`. No se agrega opción para
desactivar la verificación TLS; en local se usa HEC sin TLS (ver paso 7).

### 4. Encolar eventos (`apps/worker/src/pipeline/siem-events.ts`)

- Funciones puras `buildScoreEvent(...)` y `buildAlertEvent(...)` que arman el payload (fáciles
  de probar), y `enqueueSiemEvents(db, ...)` que inserta las filas con `destination = 'siem'`,
  `event_type`, `score_id` / `alert_id` y el payload **ya armado** (foto del momento).
- Llamarla en `jobs/run-scan.ts` justo después de `raiseScoreAlert` (que debe devolver también
  el `id` de la alerta creada). Un fallo al encolar se registra con `console.warn` y **no tumba
  el escaneo**, igual que `request_report`.
- Solo se encola si `SPLUNK_HEC_URL` está definido.

### 5. Envío (`apps/worker/src/pipeline/siem.ts` + `splunk.ts`)

- `siem.ts`: cliente HEC mínimo con `fetch` (`createHecSender`), timeout de 10 s, sin redirects.
  Interfaz `SiemSender` para simularlo en tests (como `Mailer`). `splunk.ts` lo crea desde `config`.
- `deliverSiemEvents`, copia de `notify.ts`: `claim_outbox('siem', 10, 180)` → un POST por
  evento → `sent` o `afterFailure` (la misma regla pura de `notify.ts`).
- Manejo de respuestas HEC: `200` → `sent`; `400` (evento inválido) → `failed` directo, no se
  reintenta; `401/403` (token) y `5xx`/red → reintento con espera.
- `index.ts`: agregar `pollSiemEvents()` al ciclo, después de `pollEmailAlerts()`, y un log
  al arrancar indicando si Splunk está configurado.

### 6. Tests (vitest)

- `buildScoreEvent` / `buildAlertEvent`: forma del payload y que no incluyen evidencia.
- Cliente HEC: arma el cuerpo concatenado y el header correctos; clasifica 400 vs 5xx.
- `deliverSiemEvents` con `SiemSender` falso: marca `sent`, reintenta y pasa a `failed`.

### 7. Entorno local

- Servicio opcional `splunk` en `infra/docker-compose.yml` (imagen `splunk/splunk`, puerto
  8088, perfil `splunk` para que no arranque por defecto). Quien lo levante acepta la licencia
  de Splunk vía `SPLUNK_START_ARGS=--accept-license` y define `SPLUNK_PASSWORD` y
  `SPLUNK_HEC_TOKEN` en su `.env`. HEC sin TLS solo en local (`SPLUNK_HEC_SSL=false`).
- Mientras no haya token de la empresa, el demo usa este Splunk local con un token del equipo
  (cualquier UUID en `SPLUNK_HEC_TOKEN`). Así los datos de la empresa no salen de la máquina.
  En producción solo cambian `SPLUNK_HEC_URL` y `SPLUNK_HEC_TOKEN`; el código es el mismo.
- Pasos:
  1. En `.env`: `SPLUNK_PASSWORD`, `SPLUNK_HEC_TOKEN` (p. ej. un UUID), aceptar licencia y
     términos (`SPLUNK_START_ARGS`, `SPLUNK_GENERAL_TERMS`) y `SPLUNK_HEC_URL=http://127.0.0.1:8088`.
     `SPLUNK_INDEX` vacío: el token de la imagen escribe en `main`.
  2. `docker compose --env-file .env -f infra/docker-compose.yml --profile splunk up -d splunk`
     (tarda unos minutos la primera vez; web en http://localhost:8000, usuario `admin`).
  3. `pnpm dev`, escaneo manual y en Splunk: `index=main sourcetype=warden:*`.

### 8. Documentación

- `docs/architecture.md`: paso de envío a SIEM en el ciclo de vida del escaneo.
- `AGENTS.md`: fila "Outbox SIEM/SOAR" en §2, variables en §9 y `siem.ts` en §4.
- Este archivo: marcar la fase 1 como hecha con su PR.

## Lado Splunk (lo configura la empresa)

- Cuenta, índice (`warden`) y token HEC **de la empresa**, para que sigan funcionando al terminar
  el proyecto. Confirmar que su licencia incluye HEC; el volumen es de pocos KB por escaneo.
- Búsquedas de ejemplo:

```spl
index=warden sourcetype=warden:score | dedup event_id | timechart span=1d latest(global_score)
index=warden sourcetype=warden:alert | dedup event_id | table _time alert_type previous_grade new_grade report_url
```

## Fase 2: visibilidad y carga inicial ✅

- **Configuración → Splunk (SIEM)** (`/settings/splunk`, solo admin; RLS de `integration_outbox`
  solo da lectura a admin): conteos de enviados, pendientes y fallidos, último envío y los 20
  eventos más recientes con su error (`lib/siem.ts`, `components/settings/siem-status.tsx`).
- **Reintentar fallidos**: RPC `retry_failed_siem_events()` (`security definer`, solo admin)
  devuelve los `failed` a `pending` con `attempts = 0`; sirve tras corregir el token o la URL.
- **Carga inicial** (`pipeline/siem-backfill.ts`): al arrancar con Splunk configurado, el worker
  encola el último puntaje de cada empresa si nunca se envió, para que Splunk no arranque vacío.
  En lugar del botón "Reenviar último puntaje" que se había previsto: no requiere acción y la web
  sigue sin escribir en el outbox. Los hallazgos abiertos del evento son los de ese momento.

## Fase 3 (si hay tiempo): eventos de hallazgos

- `warden:finding` con `fingerprint`, dominio, severidad, confianza, título, activo y `change`
  (`opened`, `resolved`, `reopened`, `triaged`), sin evidencia.
- Encolar en `persist.ts` (nuevos/reabiertos) y `resolve.ts` (resueltos). El triage ocurre en la
  web, que no debe escribir en el outbox: usar un trigger `security definer` sobre `findings`
  que encole al cambiar `status`.
- Carga inicial con los hallazgos `open` al activar la integración.

## Riesgos y supuestos

- **Duplicados:** un timeout después de que Splunk aceptó el lote provoca reenvío → `dedup event_id`.
  Si un escaneo se reintenta después de enviar su puntaje, Splunk conserva el evento anterior
  (otro `score_id`); es aceptable porque el reintento solo ocurre si el escaneo no terminó.
- **Splunk caído:** los eventos quedan `pending` y se reintentan (1, 5, 15, 60 min); después,
  `failed`. Nunca afecta al escaneo.
- **No-contact:** Splunk es un destino de integración de la propia empresa, no un activo evaluado;
  la regla no aplica, pero el envío vive solo en el worker y nunca en `apps/web`.
