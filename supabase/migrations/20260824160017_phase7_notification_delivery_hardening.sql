-- Phase 7 notification delivery hardening.
-- The product remains provider-disabled. These database contracts make a later
-- approved provider rollout fail closed on stale leases, changed consent, and
-- duplicated one-time access grants.

alter table public.guardian_notification_preferences
  add column revision bigint not null default 1,
  add column consent_text_version text,
  add column consent_source text,
  add column consent_evidence_id uuid,
  add constraint guardian_notification_preferences_revision_check
    check (revision > 0);

alter table public.guardian_alerts
  add column claim_token uuid,
  add column consent_revision bigint not null default 0,
  add constraint guardian_alerts_consent_revision_check
    check (consent_revision >= 0);

create index guardian_alerts_delivery_claim_idx
  on public.guardian_alerts (status, next_attempt_at, lease_until, created_at);

-- Existing queued rows predate auditable consent metadata. They are never
-- eligible for delivery; the claim RPC marks them suppressed on first pass.
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
    and notification_preference.revision > 0
    and notification_preference.consented_at is not null
    and notification_preference.consent_text_version is not null
    and notification_preference.consent_source is not null
    and notification_preference.consent_evidence_id is not null
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
    'occurredAt', new.occurred_at,
    'consentRevision', preference.revision
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
    deep_link_path,
    consent_revision
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
    '/alert/' || new.id::text,
    preference.revision
  ) on conflict (idempotency_key) do nothing;

  return new;
end;
$$;

revoke all on function private.queue_guardian_alert()
from public, anon, authenticated;

-- Replace the old return shape with claim ownership and consent revision.
revoke all on function public.claim_guardian_alert_outbox(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
drop function public.claim_guardian_alert_outbox(timestamptz, timestamptz, integer);

create or replace function public.claim_guardian_alert_outbox(
  p_now timestamptz,
  p_lease_until timestamptz,
  p_limit integer
)
returns table (
  alert_id uuid,
  event_id uuid,
  recipient_ref text,
  channel public.guardian_channel,
  template_key public.guardian_template,
  risk_level public.risk_level,
  idempotency_key text,
  attempt_count integer,
  lease_until timestamptz,
  claim_token uuid,
  consent_revision bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null
     or p_lease_until <= p_now
     or p_lease_until > p_now + interval '5 minutes'
     or p_limit is null
     or p_limit < 1
     or p_limit > 100 then
    raise exception using errcode = '22023', message = 'invalid notification claim';
  end if;

  update public.guardian_alerts as stale
  set
    status = 'SUPPRESSED',
    error_code = 'CONSENT_RECONSENT_REQUIRED',
    lease_until = null,
    claim_token = null,
    updated_at = p_now
  where stale.status in ('QUEUED', 'RETRY_WAIT', 'PROCESSING')
    and stale.consent_revision = 0;

  return query
  with claimable as materialized (
    select guardian_alert.id
    from public.guardian_alerts as guardian_alert
    where guardian_alert.consent_revision > 0
      and (
        guardian_alert.status = 'QUEUED'
        or (
          guardian_alert.status = 'RETRY_WAIT'
          and guardian_alert.next_attempt_at is not null
          and guardian_alert.next_attempt_at <= p_now
        )
        or (
          guardian_alert.status = 'PROCESSING'
          and guardian_alert.lease_until is not null
          and guardian_alert.lease_until <= p_now
        )
      )
    order by coalesce(guardian_alert.next_attempt_at, guardian_alert.created_at), guardian_alert.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.guardian_alerts as guardian_alert
    set
      status = 'PROCESSING',
      attempt_count = guardian_alert.attempt_count + 1,
      lease_until = p_lease_until,
      claim_token = gen_random_uuid(),
      next_attempt_at = null,
      error_code = null,
      updated_at = p_now
    from claimable
    where guardian_alert.id = claimable.id
    returning guardian_alert.*
  )
  select
    claimed.id,
    claimed.alert_transition_id,
    claimed.recipient_ref,
    claimed.channel,
    claimed.template_key,
    claimed.risk_level,
    claimed.idempotency_key,
    claimed.attempt_count::integer,
    claimed.lease_until,
    claimed.claim_token,
    claimed.consent_revision
  from claimed;
end;
$$;

create or replace function public.recheck_guardian_alert_eligibility(
  p_alert_id uuid,
  p_claim_token uuid,
  p_expected_lease_until timestamptz,
  p_expected_consent_revision bigint,
  p_checked_at timestamptz
)
returns table (disposition text, reason_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.guardian_alerts%rowtype;
  v_preferences public.guardian_notification_preferences%rowtype;
begin
  if p_alert_id is null
     or p_claim_token is null
     or p_expected_lease_until is null
     or p_expected_consent_revision is null
     or p_checked_at is null then
    raise exception using errcode = '22023', message = 'invalid notification eligibility request';
  end if;

  select guardian_alert.*
  into v_alert
  from public.guardian_alerts as guardian_alert
  where guardian_alert.id = p_alert_id
  for update;

  if not found
     or not (
       v_alert.status = 'PROCESSING'
       and v_alert.claim_token is not distinct from p_claim_token
       and v_alert.lease_until is not distinct from p_expected_lease_until
       and v_alert.lease_until > p_checked_at
     ) then
    return query select 'LEASE_LOST'::text, null::text;
    return;
  end if;

  select preference.*
  into v_preferences
  from public.guardian_notification_preferences as preference
  where preference.subject_id = v_alert.subject_id;

  if not found or v_preferences.consented_at is null then
    return query select 'SUPPRESSED'::text, 'NO_CONSENT'::text;
  elsif v_preferences.revision is distinct from p_expected_consent_revision
     or v_preferences.revision is distinct from v_alert.consent_revision then
    return query select 'SUPPRESSED'::text, 'CONSENT_CHANGED'::text;
  elsif v_preferences.withdrawn_at is not null then
    return query select 'SUPPRESSED'::text, 'CONSENT_WITHDRAWN'::text;
  elsif v_preferences.consent_text_version is null
     or v_preferences.consent_source is null
     or v_preferences.consent_evidence_id is null then
    return query select 'SUPPRESSED'::text, 'CONSENT_CHANGED'::text;
  elsif (v_alert.channel = 'SMS' and not v_preferences.sms_enabled)
     or (v_alert.channel = 'ALIMTALK' and not v_preferences.alimtalk_enabled) then
    return query select 'SUPPRESSED'::text, 'CHANNEL_BLOCKED'::text;
  elsif v_preferences.recipient_ref is null
     or v_preferences.recipient_ref <> v_alert.recipient_ref then
    return query select 'SUPPRESSED'::text, 'RECIPIENT_UNAVAILABLE'::text;
  else
    return query select 'ELIGIBLE'::text, null::text;
  end if;
end;
$$;

revoke all on function public.recheck_guardian_alert_eligibility(
  uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.recheck_guardian_alert_eligibility(
  uuid, uuid, timestamptz, bigint, timestamptz
) from public, anon, authenticated;
drop function if exists public.recheck_guardian_alert_eligibility(uuid, timestamptz);

-- Replace the old finalize signature with a claim-token CAS.
revoke all on function public.finalize_guardian_alert_outbox(
  uuid, timestamptz, jsonb
) from public, anon, authenticated;
drop function public.finalize_guardian_alert_outbox(uuid, timestamptz, jsonb);

create or replace function public.finalize_guardian_alert_outbox(
  p_alert_id uuid,
  p_claim_token uuid,
  p_expected_lease_until timestamptz,
  p_outcome jsonb
)
returns table (disposition text, status public.guardian_alert_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.guardian_alerts%rowtype;
  v_kind text;
  v_allowed_keys text[];
  v_received_keys text[];
  v_target_status public.guardian_alert_status;
begin
  if jsonb_typeof(p_outcome) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid notification outcome';
  end if;

  v_kind := p_outcome ->> 'kind';
  case v_kind
    when 'DEMO_RECORDED' then
      v_allowed_keys := array['kind', 'provider_message_id', 'recorded_at'];
      v_target_status := 'DEMO_RECORDED';
      if (p_outcome ->> 'provider_message_id') !~ '^demo_[0-9a-f]{64}$'
         or (p_outcome ->> 'recorded_at') is null then
        raise exception using errcode = '22023', message = 'invalid notification outcome';
      end if;
      perform (p_outcome ->> 'recorded_at')::timestamptz;
    when 'SUPPRESSED' then
      v_allowed_keys := array['kind', 'reason_code'];
      v_target_status := 'SUPPRESSED';
      if p_outcome ->> 'reason_code' not in (
        'NO_CONSENT', 'CONSENT_WITHDRAWN', 'CHANNEL_BLOCKED',
        'RECIPIENT_UNAVAILABLE', 'CONSENT_CHANGED'
      ) then
        raise exception using errcode = '22023', message = 'invalid notification outcome';
      end if;
    when 'RETRY_WAIT' then
      v_allowed_keys := array['kind', 'error_code', 'next_attempt_at'];
      v_target_status := 'RETRY_WAIT';
      if (p_outcome ->> 'error_code') !~ '^[A-Z][A-Z0-9_]{0,63}$'
         or (p_outcome ->> 'next_attempt_at') is null then
        raise exception using errcode = '22023', message = 'invalid notification outcome';
      end if;
      perform (p_outcome ->> 'next_attempt_at')::timestamptz;
    when 'FAILED_PERMANENT' then
      v_allowed_keys := array['kind', 'error_code'];
      v_target_status := 'FAILED_PERMANENT';
      if (p_outcome ->> 'error_code') !~ '^[A-Z][A-Z0-9_]{0,63}$' then
        raise exception using errcode = '22023', message = 'invalid notification outcome';
      end if;
    else
      raise exception using errcode = '22023', message = 'invalid notification outcome';
  end case;

  select array_agg(outcome_key order by outcome_key)
  into v_received_keys
  from jsonb_object_keys(p_outcome) as outcome_key;
  select array_agg(allowed_key order by allowed_key)
  into v_allowed_keys
  from unnest(v_allowed_keys) as allowed_key;
  if v_received_keys is distinct from v_allowed_keys then
    raise exception using errcode = '22023', message = 'invalid notification outcome';
  end if;

  select guardian_alert.*
  into v_alert
  from public.guardian_alerts as guardian_alert
  where guardian_alert.id = p_alert_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'notification not found';
  end if;

  if v_alert.status = v_target_status
     and v_alert.claim_token is null
     and (
       (v_kind = 'DEMO_RECORDED'
         and v_alert.provider_message_id = p_outcome ->> 'provider_message_id'
         and v_alert.recorded_at = (p_outcome ->> 'recorded_at')::timestamptz)
       or (v_kind = 'SUPPRESSED' and v_alert.error_code = p_outcome ->> 'reason_code')
       or (v_kind = 'RETRY_WAIT'
         and v_alert.error_code = p_outcome ->> 'error_code'
         and v_alert.next_attempt_at = (p_outcome ->> 'next_attempt_at')::timestamptz)
       or (v_kind = 'FAILED_PERMANENT' and v_alert.error_code = p_outcome ->> 'error_code')
     ) then
    return query select 'IDEMPOTENT'::text, v_alert.status;
    return;
  end if;

  if v_alert.status <> 'PROCESSING'
     or v_alert.claim_token is distinct from p_claim_token
     or v_alert.lease_until is distinct from p_expected_lease_until
     or v_alert.lease_until <= clock_timestamp() then
    return query select 'LEASE_LOST'::text, v_alert.status;
    return;
  end if;

  update public.guardian_alerts as guardian_alert
  set
    status = v_target_status,
    provider_message_id = case
      when v_kind = 'DEMO_RECORDED' then p_outcome ->> 'provider_message_id'
      else guardian_alert.provider_message_id
    end,
    recorded_at = case
      when v_kind = 'DEMO_RECORDED' then (p_outcome ->> 'recorded_at')::timestamptz
      else guardian_alert.recorded_at
    end,
    error_code = case
      when v_kind = 'SUPPRESSED' then p_outcome ->> 'reason_code'
      when v_kind in ('RETRY_WAIT', 'FAILED_PERMANENT') then p_outcome ->> 'error_code'
      else null
    end,
    next_attempt_at = case
      when v_kind = 'RETRY_WAIT' then (p_outcome ->> 'next_attempt_at')::timestamptz
      else null
    end,
    lease_until = null,
    claim_token = null,
    sent_at = null,
    accepted_at = null,
    delivered_at = null,
    updated_at = clock_timestamp()
  where guardian_alert.id = p_alert_id;

  return query select 'APPLIED'::text, v_target_status;
end;
$$;

-- Replacing a grant revokes all sibling grants that have not been exchanged.
-- It also verifies that the alert still belongs to an active, unchanged
-- consent revision, so a failed eligibility check cannot mint a live link.
create or replace function public.replace_alert_access_grant(
  p_alert_id uuid,
  p_event_id uuid,
  p_claim_token uuid,
  p_expected_lease_until timestamptz,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.guardian_alerts%rowtype;
  v_preference public.guardian_notification_preferences%rowtype;
begin
  if p_alert_id is null
     or p_event_id is null
     or p_claim_token is null
     or p_expected_lease_until is null
     or p_token_hash is null
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at is null
     or p_expires_at <= clock_timestamp()
     or p_expires_at > clock_timestamp() + interval '24 hours' then
    return false;
  end if;

  select guardian_alert.*
  into v_alert
  from public.guardian_alerts as guardian_alert
  where guardian_alert.id = p_alert_id
    and guardian_alert.alert_transition_id = p_event_id
  for update;
  if not found
     or not (
       v_alert.status = 'PROCESSING'
       and v_alert.claim_token is not distinct from p_claim_token
       and v_alert.lease_until is not distinct from p_expected_lease_until
       and v_alert.lease_until > clock_timestamp()
     ) then
    return false;
  end if;

  select preference.*
  into v_preference
  from public.guardian_notification_preferences as preference
  where preference.subject_id = v_alert.subject_id
    and preference.revision = v_alert.consent_revision
    and preference.consented_at is not null
    and preference.withdrawn_at is null
    and preference.consent_text_version is not null
    and preference.consent_source is not null
    and preference.consent_evidence_id is not null
    and preference.recipient_ref = v_alert.recipient_ref
    and ((v_alert.channel = 'SMS' and preference.sms_enabled)
      or (v_alert.channel = 'ALIMTALK' and preference.alimtalk_enabled));
  if not found then return false; end if;

  update public.alert_access_tokens as access_token
  set revoked_at = clock_timestamp()
  where access_token.alert_id = p_alert_id
    and access_token.event_id = p_event_id
    and access_token.exchanged_at is null
    and access_token.revoked_at is null;

  insert into public.alert_access_tokens (
    alert_id, event_id, token_hash, expires_at
  ) values (
    p_alert_id, p_event_id, lower(p_token_hash), p_expires_at
  );
  return true;
exception
  when unique_violation then return false;
end;
$$;

-- A token can be exchanged only while its alert is still live and the same
-- consent revision is active. This blocks a link minted before withdrawal or
-- suppression from becoming a usable subject session.
create or replace function public.consume_alert_access_token(
  p_token_hash text,
  p_event_id uuid,
  p_now timestamptz,
  p_session_hash text,
  p_session_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.alert_access_tokens%rowtype;
  v_alert public.guardian_alerts%rowtype;
  v_preference public.guardian_notification_preferences%rowtype;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
     or p_session_hash !~ '^[0-9a-f]{64}$'
     or p_event_id is null
     or p_now is null
     or p_session_expires_at <= p_now
     or p_session_expires_at > p_now + interval '24 hours' then
    return false;
  end if;

  select access_token.*
  into v_grant
  from public.alert_access_tokens as access_token
  where access_token.token_hash = lower(p_token_hash)
    and access_token.event_id = p_event_id
    and access_token.exchanged_at is null
    and access_token.revoked_at is null
    and access_token.expires_at > p_now
  for update;
  if not found then return false; end if;

  select guardian_alert.*
  into v_alert
  from public.guardian_alerts as guardian_alert
  where guardian_alert.id = v_grant.alert_id
    and guardian_alert.alert_transition_id = p_event_id
    and guardian_alert.status = 'DEMO_RECORDED'
  for share;
  if not found then return false; end if;

  select preference.*
  into v_preference
  from public.guardian_notification_preferences as preference
  where preference.subject_id = v_alert.subject_id
    and preference.revision = v_alert.consent_revision
    and preference.consented_at is not null
    and preference.withdrawn_at is null
    and preference.consent_text_version is not null
    and preference.consent_source is not null
    and preference.consent_evidence_id is not null;
  if not found then return false; end if;

  update public.alert_access_tokens as access_token
  set exchanged_at = p_now
  where access_token.id = v_grant.id;

  insert into public.alert_access_sessions (
    alert_id, event_id, session_hash, expires_at
  ) values (
    v_grant.alert_id, v_grant.event_id, p_session_hash, p_session_expires_at
  );
  return true;
exception
  when unique_violation then return false;
end;
$$;

revoke all on function public.replace_alert_access_grant(uuid, uuid, uuid, timestamptz, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.consume_alert_access_token(text, uuid, timestamptz, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.claim_guardian_alert_outbox(timestamptz, timestamptz, integer)
from public, anon, authenticated;
revoke all on function public.recheck_guardian_alert_eligibility(uuid, uuid, timestamptz, bigint, timestamptz)
from public, anon, authenticated;
revoke all on function public.finalize_guardian_alert_outbox(uuid, uuid, timestamptz, jsonb)
from public, anon, authenticated;

grant execute on function public.replace_alert_access_grant(uuid, uuid, uuid, timestamptz, text, timestamptz)
to service_role;
grant execute on function public.consume_alert_access_token(text, uuid, timestamptz, text, timestamptz)
to service_role;
grant execute on function public.claim_guardian_alert_outbox(timestamptz, timestamptz, integer)
to service_role;
grant execute on function public.recheck_guardian_alert_eligibility(uuid, uuid, timestamptz, bigint, timestamptz)
to service_role;
grant execute on function public.finalize_guardian_alert_outbox(uuid, uuid, timestamptz, jsonb)
to service_role;
