-- Último escaneo en que cada fuente observó cada hallazgo. Permite resolver
-- automáticamente los hallazgos que una fuente deja de reportar (p. ej. un puerto
-- que se cierra) sin depender de findings.scan_id, que no distingue fuentes.

alter table public.finding_sources
  add column last_seen_scan_id uuid references public.scans (id) on delete set null;

comment on column public.finding_sources.last_seen_scan_id is
  'Último escaneo en que esta fuente observó el hallazgo; null si ese escaneo se borró.';

-- Hasta ahora findings.scan_id ya guardaba el último escaneo que observó el hallazgo.
update public.finding_sources fs
set last_seen_scan_id = f.scan_id
from public.findings f
where f.id = fs.finding_id;

-- Búsqueda de candidatos a resolver: hallazgos de una fuente, por último escaneo visto.
create index finding_sources_source_last_seen_idx
  on public.finding_sources (source_key, last_seen_scan_id);
