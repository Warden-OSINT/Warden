# Modelo de scoring del KRI

> **Estado: definido** (aprobado el 28 de octubre de 2026). Implementado en `@warden/scoring`
> (`computeScore`) y guardado por el worker en `apps/worker/src/pipeline/score.ts`.

## Reglas

1. **Escala:** 0–100, más alto es mejor.
2. **Puntaje por dominio:** `100 · e^(−penalización / 60)`, donde la penalización es
   `Σ puntos_severidad × factor_confianza` de los hallazgos abiertos del dominio. Los rendimientos
   son decrecientes: muchos hallazgos `low` no equivalen a uno `critical`, y el puntaje nunca
   baja de 0. La constante 60 (`SATURATION`) hace que un `high` de confianza alta deje el
   dominio en ~72.
3. **Hallazgos que cuentan:** solo `open`. `accepted` (ya pasó triage con motivo),
   `false_positive` y `resolved` no restan. Además, el activo del hallazgo debe seguir en
   alcance: cuentan los hallazgos sin activo, los de activos `confirmed` y los de activos
   `pending` descubiertos por una fuente (`discovery_source = 'auto'`: subdominios e IPs que
   salen de activos confirmados y aún nadie revisa). No cuentan los de activos `discarded` ni
   los de activos manuales en `pending`: un activo manual entra confirmado, así que solo llega
   ahí si un analista le quitó la confirmación. Volver a confirmarlo recupera sus hallazgos sin
   tocar el triage. El filtro se aplica al cargar los hallazgos (`onlyInScopeFindings` de
   `@warden/shared`), no en `computeScore`; el dashboard, los reportes, el resumen con IA y el
   evento de Splunk usan el mismo criterio, y /findings oculta esos hallazgos por defecto.
4. **Letras:** A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, E ≥ 50, F < 50.
   Techo: un hallazgo `critical` abierto limita el dominio a 69 (D).
5. **Global:** promedio ponderado de los dominios con datos, con la letra según los mismos umbrales.
6. **Dominios sin datos:** un dominio entra al puntaje solo si alguna de sus fuentes terminó `ok`
   en el escaneo. Si todas fallaron, se omitieron o están deshabilitadas, el dominio se excluye,
   su peso se reparte entre los demás y queda en `scores.excluded_domains` (el dashboard lo
   muestra como cobertura parcial). Darle 100 ocultaría riesgo. Sin ningún dominio con datos,
   el escaneo no se califica.
7. **`credentials` (HIBP):** contará dentro de `secrets` cuando se integre; no se agrega un
   séptimo dominio.

## Versión 1 de pesos

Sembrada en `supabase/seed.sql` (activa). Un admin puede crear versiones nuevas; cada escaneo
guarda la versión usada (`scans.weight_version_id`), así que los puntajes históricos se pueden
recalcular con `computeScore`.

| Dominio | Peso |
|---|---|
| `exposure` | 25 |
| `email` | 15 |
| `certs` | 10 |
| `secrets` | 20 |
| `reputation` | 20 |
| `impersonation` | 10 |

SUPUESTO (pendiente de validar con el equipo), igual en todos los dominios:

| Severidad | Puntos | | Confianza | Factor |
|---|---|---|---|---|
| `critical` | 40 | | `high` | 1 |
| `high` | 20 | | `medium` | 0.75 |
| `medium` | 8 | | `low` | 0.5 |
| `low` | 3 | | | |
| `info` | 0 | | | |

`computeScore` rechaza una versión incompleta (falta una severidad o confianza) o cuyos pesos
no suman 100, en lugar de calificar en silencio con valores por defecto.

## Ejemplos (versión 1)

| Hallazgos abiertos en el dominio | Puntaje | Letra |
|---|---|---|
| Ninguno | 100 | A |
| 1 `low` (confianza alta) | 95.1 | A |
| 1 `medium` (alta) | 87.5 | B |
| 1 `high` (alta) | 71.7 | C |
| 1 `critical` (baja) | 69 (techo) | D |
| 10 `low` (alta) | 60.7 | D |
| 1 `critical` (alta) | 51.3 | E |
