-- Privilegios de tabla para los roles de la Data API. Supabase ya no expone
-- automáticamente las tablas nuevas de `public` a anon/authenticated/service_role
-- (config.toml: auto_expose_new_tables, que desaparece el 2026-10-30), así que sin
-- estos GRANT ni la web ni el worker pueden leer o escribir.
--
-- Los GRANT abren la tabla al rol; RLS (20261001000800) sigue decidiendo qué filas.
-- Se otorga solo lo que alguna política permite usar. anon no recibe nada.

-- Worker: la service role omite RLS y necesita acceso completo.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Lectura para miembros activos ("members read") y tablas de solo admin ("admins read").
grant select on
  public.profiles, public.audit_log, public.companies, public.assets, public.schedules,
  public.risk_domains, public.sources, public.source_credentials, public.scoring_weights,
  public.scoring_weight_items, public.scans, public.scan_sources, public.findings,
  public.finding_sources, public.scores, public.score_domains, public.reports,
  public.alert_settings, public.alerts, public.integration_outbox, public.archives
to authenticated;

-- Empresas y activos: los miembros registran y editan; solo admin borra.
grant insert, update, delete on public.companies, public.assets to authenticated;

-- Configuración ("admins manage").
grant insert, update, delete on
  public.sources, public.source_credentials, public.schedules, public.scoring_weights,
  public.scoring_weight_items, public.alert_settings
to authenticated;

-- Activación y rol de usuarios ("admins update profiles").
grant update on public.profiles to authenticated;

-- findings ya tiene update por columnas (status, status_reason, status_by) en 20261001000800.
