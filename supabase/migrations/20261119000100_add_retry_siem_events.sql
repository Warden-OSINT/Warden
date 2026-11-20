-- Reintento manual de los eventos del SIEM que quedaron 'failed' (p. ej. tras corregir el token
-- de Splunk). Solo admin: la web no escribe en integration_outbox (RLS solo le da lectura).

create function public.retry_failed_siem_events()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede reintentar envíos' using errcode = '42501';
  end if;

  update public.integration_outbox
  set status = 'pending', attempts = 0, last_error = null, next_attempt_at = now()
  where destination = 'siem' and status = 'failed';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.retry_failed_siem_events() from public, anon;
grant execute on function public.retry_failed_siem_events() to authenticated;
