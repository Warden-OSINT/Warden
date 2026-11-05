# Plan para completar el KRI

> Plan de trabajo, actualizado el 29 de octubre de 2026. El modelo de scoring está en
> [scoring-model.md](scoring-model.md); aquí se ordena el trabajo y se registra qué está hecho.
> PRs en [Warden-OSINT/Warden](https://github.com/Warden-OSINT/Warden) (antes `Rorronarvaez1/Warden-`).

## Estado

| Fase | Estado | PR |
|---|---|---|
| 0 — Decisiones del modelo | ✅ Aprobadas el 28 de octubre | `docs/scoring-model.md` |
| 1 — Hallazgos de `certs` | ✅ Hecha | #29 |
| 2 — Colectores `typosquat` y `gitleaks` | ✅ Hecha | #29 |
| 3 — Motor de scoring | ✅ Hecha | #30 |
| 4 — Después del score | 🟡 Hecha; falta el webhook de alertas | #31, IA en `feat/resumen-ia`, correo en `feat/alertas-correo` |
| Extra — Progreso y cancelación de escaneos | ✅ Hecha | #32 |
| Extra — Dashboard y ayudas emergentes | ✅ Hecha | este PR |

| Dominio | Fuente | ¿Genera hallazgos? |
|---|---|---|
| `exposure` | `internetdb` | ✅ puertos y CVE por IP |
| `email` | `email_dns` | ✅ SPF, DMARC, MX |
| `reputation` | `abusech` | ✅ URLhaus, ThreatFox, Feodo (requiere `ABUSECH_AUTH_KEY`) |
| `certs` | `crtsh` | ✅ comodines, vencimientos, CAA |
| `secrets` | `gitleaks` | ✅ repos públicos de activos `code_org` (requiere `git` y `gitleaks`) |
| `impersonation` | `typosquat` | ✅ dominios parecidos vía DNS público (dns.google, respaldo Cloudflare) |

## Fase 1 — Hallazgos de `certs` ✅

`crtsh/certs.ts`: comodines vigentes, vencimientos sin renovación en CT (≤ 14 días o vencidos
hace ≤ 30), falta de CAA y emisoras recientes fuera de CAA. Reintenta 429/502/503/504 de crt.sh
(3 intentos). Descartado: algoritmos o llaves débiles (la salida JSON de crt.sh no los incluye).

## Fase 2 — Colectores ✅

- **`typosquat`** (antes `dnstwist`): técnicas de dnstwist implementadas en TypeScript; solo
  consulta el DNS público (dns.google, respaldo Cloudflare). Si el primer lote de consultas falla completo (red que bloquea DoH),
  la fuente se detiene en segundos.
- **`gitleaks`**: repos públicos de las organizaciones `code_org` (`github.com/<org>`); sin
  forks, ≤ 200 MB y hasta 20 repos por escaneo. Sin organizaciones confirmadas, la fuente falla
  (no hay datos de `secrets`). Probado en vivo con
  [Warden-OSINT/Gitleaks-demo](https://github.com/Warden-OSINT/Gitleaks-demo): 4 secretos falsos,
  uno solo en el historial.

## Fase 3 — Motor de scoring ✅

`@warden/scoring` (`computeScore`) y `apps/worker/src/pipeline/score.ts`. Pesos v1 en
`supabase/seed.sql`; los dominios sin datos quedan en `scores.excluded_domains` (cobertura
parcial). El dashboard, Escaneos y Reportes muestran el KRI; la tendencia usa una escala fija
0–100 con bandas por nota.

## Fase 4 — Después del score 🟡

Hecho (sin IA):

- [x] **Alertas**: tras calificar, el worker registra `grade_drop` o `threshold_crossed`
      (`pipeline/alerts.ts`, canal `in_app`). Se ven en el dashboard, en Reportes y en
      Configuración → Alertas.
- [x] **Página Reportes**: un reporte por escaneo calificado, imprimible, con explorador
      interactivo de hallazgos por dominio. El resumen ejecutivo queda reservado para la IA.
- [x] **Configuración de alertas** (admin): umbral de nota y destinatarios.
- [x] **Versiones de pesos** (admin): crear una versión a partir de la activa y activarla.

Pendiente:

- [x] **Resumen ejecutivo con IA**: tras calificar se encola `report_requests`; el worker
      genera el resumen con `@warden/ai` (contexto redactado con `redact()`) y lo guarda en
      `reports` con `model_used`, `prompt_version` y `context_hash`. El reporte muestra el
      estado, los riesgos y las recomendaciones, con botón Regenerar.
- [x] **Envío de alertas por correo** vía `integration_outbox` y SMTP (`pipeline/notify.ts`),
      con reintentos; el estado de cada envío se ve en Configuración → Alertas.
- [ ] Envío por webhook.
- [ ] PDF generado en el servidor (hoy: imprimir / guardar como PDF desde el navegador).

## Extras hechos fuera del plan original

- **Progreso y cancelación de escaneos** (#32): la web muestra "Consultando X · n de N fuentes"
  y permite cancelar (`cancel_scan`); un escaneo cancelado no persiste ni califica resultados.
- **Dashboard**: activos limitados a 15 filas con scroll, Reputación y Correo apilados junto a
  Fuentes, barras de desplazamiento del tema oscuro.
- **Ayudas emergentes** (`InfoTip`): explicaciones en lenguaje simple para personas sin
  formación en ciberseguridad (KRI, dominios, pesos, puntos y factores).

## Pendientes

- `hibp` (opcional): registrarlo como colector y contarlo dentro de `secrets`.
- Construir la imagen Docker del worker y probarla (incluye `git` y `gitleaks`).
- Extender las ayudas emergentes a Hallazgos, Reportes y Escaneos (severidad, confianza,
  estados de triage).

## Pendientes de validar con el equipo

- Severidades de cada regla de los colectores (marcadas como SUPUESTO).
- Puntos por severidad (40/20/8/3/0) y factores por confianza (1/0.75/0.5) de los pesos v1.
- Visibilidad del repo Warden: si es público, gitleaks también lo escanea y reporta los secretos
  falsos de sus tests.
