# Fuentes OSINT

Toda fuente debe cumplir dos reglas:

1. **No-contact:** no envía tráfico a la infraestructura evaluada. Consultar registros públicos (CT logs, DNS público, feeds, repositorios públicos) está permitido.
2. **Gratuita:** open source o un servicio sin costo para nuestro uso. La regla busca evitar servicios de pago; una API propietaria gratuita es aceptable si sus términos permiten nuestro uso. Excepción aprobada: HIBP (ver decisión abajo).

Para agregar una fuente:

1. Documentarla en esta tabla.
2. Crear `packages/collectors/src/<source_key>/`.
3. Registrarla en `registry.ts` y en `supabase/seed.sql`.

| source_key | Dominio | Licencia | Por qué es no-contact | Estado |
|---|---|---|---|---|
| `spiderfoot` | exposure | MIT | Solo con el caso de uso *passive* | Colector pendiente |
| `internetdb` | exposure | Shodan InternetDB: gratuito **solo para uso no comercial**, sin API key | Consulta la base de datos de Shodan (sus propios escaneos) por IP; las IPs se obtienen resolviendo activos confirmados vía DNS público (DoH). Ninguna petición llega a la empresa | **Implementado** (puertos y CVE inferidos; deshabilitado por defecto) |
| `internetdb` (enriquecimiento) | exposure | CISA KEV (dominio público, EE. UU.) y FIRST EPSS (gratuito) | Catálogos de vulnerabilidades consultados por ID de CVE; no involucran activos de la empresa | Usados por `internetdb` para la severidad de CVE; sin fila propia en `sources` |
| `crtsh` | certs | Por verificar | Consulta logs públicos de Certificate Transparency y el CAA del dominio vía DNS público (DoH) | **Implementado** (subdominios; hallazgos de comodines, vencimientos sin renovación, falta de CAA y emisoras fuera de CAA) |
| `crtsh` (respaldo) | certs | Cert Spotter de SSLMate: plan gratuito de 10 consultas de dominio completo por hora; sin llave solo para evaluación, por lo que en producción va con `CERTSPOTTER_API_KEY` (gratuita, cuenta de la empresa). SSLMate puede restringir el plan gratuito sin aviso | Lee los mismos logs públicos de Certificate Transparency que crt.sh a través de la API de SSLMate; no toca la infraestructura evaluada | **Implementado** como respaldo: solo si crt.sh falla tras sus reintentos. Devuelve solo certificados vigentes (sin hallazgos de vencidos) y a lo más 5 páginas; si hay más, la fuente falla en vez de dar datos incompletos |
| `checkdmarc` | email | Apache-2.0 | Lee registros DNS públicos (SPF, DMARC, MX) | Pendiente |
| `gitleaks` | secrets | MIT | Lista repos públicos con la API de GitHub y los clona desde `github.com` (no es infraestructura de la empresa). Solo organizaciones `code_org` confirmadas; sin forks | **Implementado** (requiere `git` y `gitleaks` en el worker; deshabilitado por defecto) |
| `abusech` | reputation | API Community de abuse.ch: gratuita bajo uso justo; el uso comercial puede requerir la API de pago (ver abajo). Requiere `ABUSECH_AUTH_KEY` (gratuita) | Consulta URLhaus y ThreatFox por dominio/IP y descarga la lista de Feodo Tracker; las IPs se obtienen vía DNS público (DoH). Ninguna petición llega a la empresa | **Implementado** (URLhaus, Spamhaus DBL/SURBL vía URLhaus, ThreatFox y Feodo → hallazgos de `reputation`; deshabilitado por defecto) |
| `typosquat` | impersonation | Implementación propia de las técnicas de dnstwist (Apache-2.0) | Genera dominios parecidos y los consulta únicamente en el DNS público por DoH (A, MX, NS). Sin HTTP, banners ni SMTP hacia los parecidos ni hacia la empresa | **Implementado** (deshabilitado por defecto) |
| `shodan` | exposure | Propietaria, de pago | Datos pasivos, pero la API completa requiere suscripción | Bloqueado: se usa `internetdb` (gratuito) en su lugar |
| `email_dns` | email | Registros DNS públicos; cliente implementado en Warden | Consulta únicamente el DNS público por DoH; no conecta a HTTP/SMTP ni DNS autoritativo de la empresa | **Implementado** (SPF/DMARC/MX → hallazgos de `email`; deshabilitado por defecto) |
| `hibp` | credentials (módulo; fuera del catálogo KRI) | Datos de brechas CC BY 4.0 con atribución; acceso por dominio requiere suscripción | Consulta únicamente HIBP para dominios previamente verificados; descarta aliases y no prueba contraseñas | Adaptador implementado; sin registro en seed/pipeline |

**DNS público (DoH).** Todas las consultas DNS de los colectores pasan por `dns/resolver.ts`:
primero `dns.google` y, si no responde o da SERVFAIL, `cloudflare-dns.com` (misma API JSON,
gratuita y sin llave). Ambos son resolvedores públicos: la consulta nunca llega a los servidores
DNS de la empresa. Un resolvedor que falla por red queda en pausa 10 minutos para no esperar su
timeout en cada consulta. Así una red que bloquea uno de los dos no deja fuera del KRI a
`internetdb`, `email_dns`, `abusech`, `typosquat` ni al CAA de `crtsh`.

Los adaptadores nuevos y sus restricciones se describen en [risk-analysis.md](risk-analysis.md).
La licencia de los datos de HIBP y la autorización requerida se documentan en su
[API oficial](https://haveibeenpwned.com/API/v3). La consulta de cuentas por dominio
no permite evaluar dominios arbitrarios: deben estar previamente verificados en HIBP.

### Decisión sobre HIBP (13 de octubre de 2026)

Warden solo evalúa a la empresa que lo contrató, así que la restricción de verificación
no es un bloqueo: la empresa verifica sus propios dominios en HIBP. Se acepta HIBP como
excepción a la regla "open source" porque sus datos tienen licencia abierta (CC BY 4.0),
aunque el acceso por API sea de pago. Condiciones:

- La suscripción y la `HIBP_API_KEY` pertenecen a la empresa; Warden solo la referencia
  con `secret_ref = 'HIBP_API_KEY'` en el worker.
- La verificación de dominios la hace el equipo de TI de la empresa desde HIBP; Warden
  no la inicia ni modifica DNS.
- Pendiente: decidir si `credentials` cuenta dentro del dominio `secrets` o como un
  séptimo dominio del KRI (requiere migración).

### abuse.ch (16 de octubre de 2026)

- **URLhaus** (`urlhaus-api.abuse.ch/v1/host/`): URLs de malware alojadas en el dominio o la IP,
  y el estado del host en Spamhaus DBL y SURBL que URLhaus devuelve en la misma respuesta.
- **ThreatFox** (`threatfox-api.abuse.ch/api/v1/`, `search_ioc`): indicadores de compromiso.
  La búsqueda es por subcadena; el mapper solo cuenta IOC cuyo host coincide exactamente.
- **Feodo Tracker** (`feodotracker.abuse.ch/downloads/ipblocklist.json`): servidores C2 de
  botnets; se descarga una vez por escaneo y se cruza localmente (no requiere llave).
- URLhaus y ThreatFox exigen `Auth-Key`. La cuenta en auth.abuse.ch debe ser **de la empresa**.
  Sin llave, o si cualquier consulta falla, la fuente queda `failed`: un resultado parcial
  no significa ausencia de listados y permitiría cerrar hallazgos sin revisarlos.
- Una IP compartida (hosting o CDN) puede estar listada por otro cliente del proveedor:
  esos hallazgos llevan confianza `medium`; los de dominio, `high`.

## Pendientes de aclarar

- **abuse.ch:** confirmar con la empresa (y, si hace falta, con abuse.ch) que su uso entra en
  el "uso justo" de la API Community y no requiere la API comercial.

- **InternetDB:** si Warden pasa a uso comercial, requiere licencia enterprise de Shodan.
- **Hackviser:** es una plataforma de entrenamiento, no una fuente de datos. Confirmar a qué se refiere.
- **osintframework.com:** es un directorio de herramientas. Cada herramienta que se tome de ahí se evalúa aquí por separado.
