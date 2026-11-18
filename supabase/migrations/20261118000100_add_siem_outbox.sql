-- Envío de eventos a Splunk (destination = 'siem', ya permitido por el CHECK) con el mismo
-- patrón outbox que el correo. El worker guarda el evento ya armado en payload y lo envía por
-- HTTP Event Collector (pipeline/siem.ts).

alter table public.integration_outbox
  -- Puntaje que originó el evento. Un reintento del escaneo borra su puntaje anterior; con él
  -- se borran sus eventos aún no enviados (igual que alert_id para el correo).
  add column score_id uuid references public.scores (id) on delete cascade;

create index integration_outbox_score_idx on public.integration_outbox (score_id);
