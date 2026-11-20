-- Dominios con peso pero sin datos en el escaneo (fuente fallida, omitida o deshabilitada).
-- Se excluyen del promedio global (docs/scoring-model.md); el dashboard los muestra como
-- cobertura parcial.
alter table public.scores
  add column excluded_domains text[] not null default '{}'
    check (excluded_domains <@ array['exposure', 'email', 'certs', 'secrets', 'reputation', 'impersonation']::text[]);

comment on column public.scores.excluded_domains is
  'Dominios excluidos del puntaje global por no tener datos en el escaneo.';
