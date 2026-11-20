-- Desglose del resultado de cada fuente por escaneo. items_returned mezclaba activos
-- descubiertos y hallazgos, y no había forma de explicar un resultado vacío (p. ej.
-- una IP omitida por pertenecer a un CDN).

alter table public.scan_sources
  add column assets_returned   integer not null default 0 check (assets_returned >= 0),
  add column findings_returned integer not null default 0 check (findings_returned >= 0),
  add column notices           jsonb   not null default '[]'::jsonb
    check (jsonb_typeof(notices) = 'array');

comment on column public.scan_sources.assets_returned is 'Activos descubiertos por la fuente en este escaneo.';
comment on column public.scan_sources.findings_returned is 'Hallazgos producidos por la fuente en este escaneo.';
comment on column public.scan_sources.notices is
  'Avisos del colector que no son hallazgos (p. ej. IPs omitidas por ser de un CDN).';

-- Filas anteriores: sin desglose, items_returned queda como único dato.
