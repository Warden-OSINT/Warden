-- Resumen ejecutivo con IA: la generación se encola en report_requests y el worker la procesa.

-- 'pending': solicitado, aún sin generar. 'draft': generado por la IA, sin revisión humana.
alter table public.reports drop constraint reports_status_check;
alter table public.reports add constraint reports_status_check
  check (status in ('pending', 'draft', 'validated', 'published', 'failed'));
alter table public.reports alter column status set default 'pending';

alter table public.reports
  -- Resumen estructurado (summary, key_risks, recommendations); summary_text guarda el párrafo.
  add column content jsonb,
  add column error_message text,
  add column requested_at timestamptz not null default now();

-- Solicita (o vuelve a solicitar) el resumen de un puntaje. La llaman la web (miembros) y el
-- worker al terminar de calificar (service role).
create function public.request_report(p_score_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_member() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'usuario sin acceso' using errcode = '42501';
  end if;
  if not exists (select 1 from public.scores where id = p_score_id) then
    raise exception 'puntaje no encontrado' using errcode = 'P0002';
  end if;

  -- Evita encolar dos veces el mismo resumen mientras el primero sigue en proceso.
  if exists (
    select 1 from public.reports
    where score_id = p_score_id and status = 'pending' and requested_at > now() - interval '5 minutes'
  ) then
    return;
  end if;

  insert into public.reports (score_id, status, requested_at)
  values (p_score_id, 'pending', now())
  on conflict (score_id) do update
    set status = 'pending', error_message = null, requested_at = now();

  perform pgmq.send('report_requests', jsonb_build_object('score_id', p_score_id));
end;
$$;

revoke execute on function public.request_report(uuid) from public, anon;
grant execute on function public.request_report(uuid) to authenticated, service_role;
