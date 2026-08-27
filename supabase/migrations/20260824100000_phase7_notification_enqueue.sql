-- Phase 7 connection: turn a committed L3/L4 transition into a durable Demo
-- notification outbox item. Recipient contact data is never copied into the
-- outbox: guardian_notification_preferences contains only a server-generated
-- HMAC reference.

create or replace function private.queue_guardian_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  preference public.guardian_notification_preferences%rowtype;
  selected_channel public.guardian_channel;
  snapshot_hri smallint;
  digest_payload jsonb;
begin
  select notification_preference.*
  into preference
  from public.guardian_notification_preferences as notification_preference
  where notification_preference.subject_id = new.subject_id
    and notification_preference.recipient_ref ~ '^[0-9a-f]{64}$'
    and notification_preference.consented_at is not null
    and notification_preference.consented_at <= new.occurred_at
    and notification_preference.withdrawn_at is null
    and (notification_preference.sms_enabled or notification_preference.alimtalk_enabled)
  for share;

  if not found then
    return new;
  end if;

  selected_channel := case
    when preference.alimtalk_enabled then 'ALIMTALK'::public.guardian_channel
    else 'SMS'::public.guardian_channel
  end;

  select risk_snapshot.hri
  into snapshot_hri
  from public.risk_snapshots as risk_snapshot
  where risk_snapshot.subject_id = new.subject_id
    and risk_snapshot.computed_at <= new.occurred_at
  order by risk_snapshot.computed_at desc, risk_snapshot.id desc
  limit 1;

  digest_payload := jsonb_build_object(
    'eventId', new.id,
    'riskLevel', new.to_level,
    'hri', snapshot_hri,
    'occurredAt', new.occurred_at
  );

  insert into public.guardian_alerts (
    alert_transition_id,
    subject_id,
    recipient_ref,
    provider,
    channel,
    template_key,
    risk_level,
    status,
    idempotency_key,
    payload_digest,
    deep_link_path
  ) values (
    new.id,
    new.subject_id,
    preference.recipient_ref,
    'DEMO',
    selected_channel,
    ('HEAT_' || new.to_level::text)::public.guardian_template,
    new.to_level,
    'QUEUED',
    'guardian-alert:' || new.id::text,
    pg_catalog.encode(extensions.digest(digest_payload::text, 'sha256'), 'hex'),
    '/alert/' || new.id::text
  ) on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists alert_transitions_queue_guardian_alert
on public.alert_transitions;
create trigger alert_transitions_queue_guardian_alert
after insert on public.alert_transitions
for each row execute function private.queue_guardian_alert();

revoke all on function private.queue_guardian_alert()
from public, anon, authenticated;
