-- Alertas que el worker registra al calificar (nota que baja o cruza el umbral de
-- alert_settings). 'in_app': visibles en la web, sin envío externo; el envío por correo o
-- webhook queda pendiente (integration_outbox).
alter table public.alerts drop constraint alerts_channel_check;
alter table public.alerts add constraint alerts_channel_check
  check (channel in ('email', 'webhook', 'in_app'));

alter table public.alerts
  add constraint alerts_alert_type_check check (alert_type in ('grade_drop', 'threshold_crossed'));

create index alerts_score_idx on public.alerts (score_id);

-- Una sola configuración: Warden evalúa a una sola empresa.
create unique index alert_settings_single_row_idx on public.alert_settings ((true));
