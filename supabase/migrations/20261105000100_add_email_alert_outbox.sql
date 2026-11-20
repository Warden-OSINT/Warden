-- Envío de alertas por correo con el patrón outbox: el worker registra la alerta y, si hay
-- destinatarios, un envío 'pending' en integration_outbox. Otro ciclo del worker los reclama
-- (claim_outbox), envía por SMTP y marca 'sent' o reintenta con espera creciente hasta 'failed'.

alter table public.integration_outbox drop constraint integration_outbox_destination_check;
alter table public.integration_outbox add constraint integration_outbox_destination_check
  check (destination in ('siem', 'soar', 'email'));

alter table public.integration_outbox
  -- Alerta que originó el envío; al borrarse (p. ej. un reintento del escaneo) sobra el envío.
  add column alert_id uuid references public.alerts (id) on delete cascade,
  -- Último error del proveedor, para mostrarlo en Configuración → Alertas.
  add column last_error text,
  -- Próximo intento; también sirve de "lease" mientras un worker lo está enviando.
  add column next_attempt_at timestamptz not null default now();

create index integration_outbox_alert_idx on public.integration_outbox (alert_id);
create index integration_outbox_due_idx on public.integration_outbox (destination, next_attempt_at)
  where status = 'pending';

-- Reclama hasta p_limit envíos vencidos de un destino y los aparta p_lease_seconds para que
-- otro worker no los envíe en paralelo. Si el worker muere, el envío vuelve al vencer el lease.
create function public.claim_outbox(p_destination text, p_limit integer, p_lease_seconds integer)
returns setof public.integration_outbox
language sql
security definer
set search_path = ''
as $$
  update public.integration_outbox o
  set next_attempt_at = now() + make_interval(secs => p_lease_seconds)
  where o.id in (
    select id from public.integration_outbox
    where destination = p_destination and status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  returning o.*
$$;

revoke execute on function public.claim_outbox(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_outbox(text, integer, integer) to service_role;
