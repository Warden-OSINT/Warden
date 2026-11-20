-- code_org: organización o usuario de GitHub de la empresa (github.com/<nombre>).
-- gitleaks escanea sus repositorios públicos; debe estar confirmado como cualquier activo.
alter table public.assets drop constraint assets_asset_type_check;
alter table public.assets add constraint assets_asset_type_check
  check (asset_type in ('domain', 'subdomain', 'ip', 'ip_range', 'asn', 'code_org'));
