# ADR 0001: Monorepo TypeScript con web en Vercel y worker en contenedor

**Estado:** aceptada (2026-09-30)

## Contexto

Los escaneos OSINT pueden tardar minutos u horas, más que el límite de tiempo de las funciones serverless de Vercel. El equipo prefiere un solo lenguaje.

## Decisión

- Monorepo con pnpm workspaces y Turborepo.
- `apps/web`: Next.js en Vercel, solo con la sesión del usuario.
- `apps/worker`: Node en contenedor. Consume una cola de Supabase (pgmq), y la programación usa pg_cron.
- La lógica reutilizable vive en `packages/*` como TypeScript fuente, sin paso de build.
- Las herramientas escritas en otros lenguajes (SpiderFoot) corren como contenedores aparte y se consumen por API.

## Consecuencias

- No hace falta infraestructura de colas adicional: todo vive en Supabase.
- Las herramientas Python sin API (p. ej. checkdmarc, dnstwist) necesitarán su propio contenedor o un wrapper CLI dentro de la imagen del worker.

## Nota posterior (noviembre 2026)

La decisión sigue vigente. En la práctica no hizo falta empaquetar herramientas Python: las
comprobaciones de checkdmarc y las técnicas de dnstwist se reimplementaron en TypeScript
(`email_dns` y `typosquat`), y gitleaks, que es un binario de Go, se copia a la imagen del worker.
