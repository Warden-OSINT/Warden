-- Corrige la programación de escaneos y permite al worker extender la visibilidad de un mensaje.

-- Una programación atrasada (cron o worker detenidos) avanzaba un solo intervalo y seguía
-- vencida: cada tick de pg_cron encolaba otro escaneo hasta ponerse al día. Ahora se encola
-- uno solo y next_run_at salta al siguiente vencimiento futuro, conservando la hora del día.
create or replace function public.enqueue_due_scans()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_schedule record;
  v_scan_id uuid;
  v_step interval;
  v_next timestamptz;
  v_count integer := 0;
begin
  for v_schedule in
    select s.* from public.schedules s
    join public.companies c on c.id = s.company_id
    where s.is_active and s.next_run_at <= now() and c.status = 'active'
    for update of s skip locked
  loop
    insert into public.scans (company_id, weight_version_id, trigger_type)
    values (
      v_schedule.company_id,
      (select id from public.scoring_weights where is_active),
      'scheduled'
    )
    returning id into v_scan_id;

    perform pgmq.send('scan_requests', jsonb_build_object('scan_id', v_scan_id));

    v_step := case v_schedule.frequency when 'weekly' then interval '7 days' else interval '1 month' end;
    v_next := v_schedule.next_run_at + v_step;
    while v_next <= now() loop
      v_next := v_next + v_step;
    end loop;

    update public.schedules set next_run_at = v_next where id = v_schedule.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Latido del worker: mientras un escaneo sigue en curso, renueva la invisibilidad del mensaje
-- para que no reaparezca en la cola y otro worker lo procese en paralelo.
create function public.queue_set_vt(p_queue text, p_msg_id bigint, p_visibility_timeout integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (select 1 from pgmq.set_vt(p_queue, p_msg_id, p_visibility_timeout))
$$;

revoke execute on function public.queue_set_vt(text, bigint, integer) from public, anon, authenticated;
grant execute on function public.queue_set_vt(text, bigint, integer) to service_role;
