-- Registra la empresa y su dominio principal (confirmado) en una sola transacción. Antes eran
-- dos inserts desde la web: si fallaba el segundo, la empresa quedaba sin su dominio y no se
-- podía reintentar ("dominio ya registrado"). Security invoker: RLS y GRANTs siguen aplicando.
create function public.register_company(p_name text, p_domain text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_company_id uuid;
begin
  insert into public.companies (name, primary_domain, created_by)
  values (p_name, p_domain, auth.uid())
  returning id into v_company_id;

  insert into public.assets (company_id, asset_type, value, discovery_source, attribution_status, confirmed_by)
  values (v_company_id, 'domain', p_domain, 'manual', 'confirmed', auth.uid());

  return v_company_id;
end;
$$;

revoke execute on function public.register_company(text, text) from public, anon;
grant execute on function public.register_company(text, text) to authenticated;
