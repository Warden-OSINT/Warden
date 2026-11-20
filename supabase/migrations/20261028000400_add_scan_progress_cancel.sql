-- Progreso visible y cancelación de escaneos.

-- 'cancelled': un miembro detuvo el escaneo; no se persisten sus resultados ni se califica.
alter table public.scans drop constraint scans_status_check;
alter table public.scans add constraint scans_status_check
  check (status in ('queued', 'running', 'completed', 'failed', 'cancelled'));

alter table public.scans
  -- Fuente que el worker está consultando ahora; null fuera de la recolección.
  add column current_source text references public.sources (source_key),
  -- Colectores que el worker va a ejecutar; con scan_sources da el avance (n de total).
  add column sources_total smallint,
  add column cancelled_by uuid references public.profiles (id) on delete set null;

-- Cancela un escaneo en cola o en curso. El worker revisa el estado mientras recolecta y
-- aborta las consultas en vuelo; uno en cola se descarta al leerlo de la cola.
create function public.cancel_scan(p_scan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if not public.is_member() then
    raise exception 'usuario sin acceso' using errcode = '42501';
  end if;

  update public.scans
  set status = 'cancelled', finished_at = now(), current_source = null, cancelled_by = auth.uid()
  where id = p_scan_id and status in ('queued', 'running');
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke execute on function public.cancel_scan(uuid) from public, anon;
grant execute on function public.cancel_scan(uuid) to authenticated;
