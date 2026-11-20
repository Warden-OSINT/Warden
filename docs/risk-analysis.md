# Módulos de análisis de riesgo

`@warden/risk-analysis` implementa análisis puro de evidencia, sin BD, red ni scoring.
`@warden/collectors` exporta los proveedores `emailDnsProvider` y `hibpProvider`.
El ejecutor compartido `runRiskAnalysis` conecta proveedores y analizadores; devuelve
resultados independientes `ok`, `failed`, `skipped` o `blocked` por fuente.

## Archivos generales

- `types.ts`: contratos de objetivo, evidencia, observaciones, proveedores y resultados.
- `schemas.ts`: versión de evidencia, dominios DNS y estados de consulta.
- `target.ts`: atribución exacta a dominios confirmados; no basta un sufijo parecido.
- `registry.ts`: registro de módulos; futuras áreas se agregan aquí.
- `runner.ts`: compuerta no-contact, cancelación, aislamiento de fallos y errores sin datos crudos.
- `collectors/src/http/public-json.ts`: HTTP con destinos permitidos explícitos,
  redirects bloqueados, timeout de 15 segundos y límite de respuesta de 5 MiB.

## Correos

El proveedor `email_dns` consulta TXT, DMARC y MX por DNS sobre HTTPS (`dns/resolver.ts`:
`dns.google` y, si falla, `cloudflare-dns.com`). No resuelve mediante el DNS del sistema, no usa servidores autoritativos como destino
directo y no abre conexiones HTTP/SMTP a la empresa. Solo consulta DKIM cuando el
analista proporciona selectores conocidos (máximo 20); no enumera selectores.

El analizador observa publicación SPF, registros múltiples, `all` permisivo,
política DMARC, Null MX y registros de selectores DKIM. Une fragmentos de un TXT
sin combinar registros independientes. SERVFAIL, respuestas truncadas, timeouts y
errores HTTP quedan como `unknown`, no como registros ausentes.

Es una inspección inicial, siempre con cobertura parcial. No valida toda la
gramática SPF/DMARC, no sigue SPF includes/redirects, no descubre políticas DMARC
heredadas ni evalúa firmas DKIM. Un MX ausente tampoco prueba que el dominio no
reciba correo; puede existir fallback A/AAAA. La presencia de un TXT en un selector
no demuestra una clave DKIM válida. `p=none` se reporta como política observada,
sin asignarle una severidad ni un puntaje.

Referencias: [Google DoH JSON](https://developers.google.com/speed/public-dns/docs/doh/json),
[SPF RFC 7208](https://www.rfc-editor.org/rfc/rfc7208),
[DMARC RFC 9989](https://www.rfc-editor.org/rfc/rfc9989),
[Null MX RFC 7505](https://www.rfc-editor.org/rfc/rfc7505).

## Credenciales en brechas

Proveedor sugerido e implementado: [Have I Been Pwned](https://haveibeenpwned.com/API/v3).
Requiere `HIBP_API_KEY` solo en el worker, suscripción compatible y verificación
previa del dominio en HIBP. Warden no inicia verificaciones por correo ni modifica
DNS. Un dominio no verificado devuelve 403, tratado como fallo, no como ausencia.

Consulta `/breachedDomain/{domain}` y `/breaches`. Descarta aliases al transformar
la respuesta y emite únicamente ID de brecha, número de cuentas afectadas, presencia
reportada de la clase `Passwords` y estado de verificación. No descarga dumps,
contraseñas o hashes, ni valida credenciales contra sistemas de la empresa.
Los conteos de diferentes brechas no se suman como cuentas únicas.

404 del endpoint de dominio significa que HIBP no devolvió cuentas. No prueba
ausencia de filtraciones. Si no existe metadata del catálogo, la exposición de
contraseñas y la verificación quedan desconocidas. Una clase `Passwords` describe
la brecha, no demuestra que la contraseña de cada cuenta siga vigente.

Los datos de brechas usan CC BY 4.0: cualquier futura interfaz o reporte debe
mostrar la atribución y enlace a Have I Been Pwned presentes en los resultados.
429 conserva `Retry-After` en `SourceHttpError`; no hay reintentos automáticos que
incrementen solicitudes. El consumidor debe programarlos respetando al proveedor.

## Uso desde un consumidor del servidor

```ts
import { emailDnsProvider, hibpProvider } from '@warden/collectors';
import { runRiskAnalysis } from '@warden/risk-analysis';

const results = await runRiskAnalysis(
  { primaryDomain: 'example.com', confirmedDomains: [], dkimSelectors: ['selector1'] },
  [emailDnsProvider, hibpProvider],
  sourcePolicies,
  { signal, getSecret: (ref) => process.env[ref] },
);
```

`sourcePolicies` es configuración confiable del servidor, con `sourceKey`,
`isEnabled` e `isNoContact`. Una fuente no registrada queda bloqueada. No aceptar
esta política desde una petición del usuario. Para el pipeline productivo se debe
cargar desde `sources`, conservando el CHECK de BD y las protecciones existentes.
## Integración con el escaneo

- **`email_dns`: integrado.** `email_dns/collector.ts` lo envuelve como `Collector`: llama al
  proveedor y a `emailModule.analyze`, convierte lo negativo en hallazgos del dominio `email`
  (severidades marcadas como SUPUESTO en `mapper.ts`) y deja todas las observaciones en
  `scan_sources.notices`. Está registrado en `collectAll` y en el seed (deshabilitado por defecto).
  `runScan` no pasa selectores DKIM, así que el escaneo no revisa DKIM.
- **`hibp` / `credentials`: no integrado.** El proveedor solo se usa con `runRiskAnalysis`;
  no está en `collectAll` ni en el seed.

`credentials` es una clave de módulo, **no un séptimo dominio del catálogo de BD**. Según el
modelo de scoring aprobado el 28 de octubre ([scoring-model.md](scoring-model.md), regla 7),
contará dentro de `secrets` cuando se integre. Mientras tanto el analizador devuelve
`riskDomain: null` y no persiste `NormalizedFinding` ni llama al scoring. Para integrarlo
faltan un colector que lo envuelva, la fila en el seed (deshabilitada), la asignación a
`secrets` y una política aprobada de severidad y confianza.

## Validación

Las pruebas utilizan respuestas simuladas y no consultan dominios reales ni HIBP.
Cubren atribución, no-contact, cancelación, aislamiento de fallos, DNS incompleto,
fragmentos TXT, aliases descartados, deduplicación por cuenta y HTTP 403/404/429.
