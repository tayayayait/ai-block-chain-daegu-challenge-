-- Phase 7: durable Demo notification outbox, one-time alert access, and
-- Base Sepolia EAS job leases. Session roles cannot access worker state.

alter table public.guardian_alerts
  add constraint guardian_alerts_id_event_unique unique (id, alert_transition_id);

alter table public.alert_access_tokens
  add column event_id uuid references public.alert_transitions (id) on delete cascade;

update public.alert_access_tokens as access_token
set event_id = guardian_alert.alert_transition_id
from public.guardian_alerts as guardian_alert
where guardian_alert.id = access_token.alert_id
  and access_token.event_id is null;

alter table public.alert_access_tokens
  alter column event_id set not null,
  add constraint alert_access_tokens_alert_event_fk
    foreign key (alert_id, event_id)
    references public.guardian_alerts (id, alert_transition_id)
    on delete cascade;

create index alert_access_tokens_event_idx
  on public.alert_access_tokens (event_id, expires_at);

create table public.alert_access_sessions (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null,
  event_id uuid not null,
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (alert_id, event_id)
    references public.guardian_alerts (id, alert_transition_id)
    on delete cascade,
  check (expires_at > created_at),
  check (revoked_at is null or revoked_at >= created_at)
);

create index alert_access_sessions_lookup_idx
  on public.alert_access_sessions (session_hash, event_id, expires_at)
  where revoked_at is null;

-- Only HMAC references are stored here; phone numbers remain in subjects and
-- are never returned by notification worker RPCs.
create table public.guardian_notification_preferences (
  subject_id uuid primary key references public.subjects (id) on delete cascade,
  recipient_ref text check (recipient_ref is null or recipient_ref ~ '^[0-9a-f]{64}$'),
  consented_at timestamptz,
  withdrawn_at timestamptz,
  sms_enabled boolean not null default false,
  alimtalk_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (withdrawn_at is null or consented_at is null or withdrawn_at >= consented_at)
);

create table public.risk_recompute_queue (
  shelter_checkin_id uuid primary key references public.shelter_checkins (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  check (processed_at is null or processed_at >= requested_at)
);

create index risk_recompute_queue_pending_idx
  on public.risk_recompute_queue (requested_at)
  where processed_at is null;

alter table public.attestation_jobs
  add column chain_id integer,
  add column schema_uid text,
  add column issuer text,
  add column verified_at timestamptz,
  add column last_attempt_at timestamptz,
  add constraint attestation_jobs_chain_check check (
    chain_id is null or chain_id = 84532
  ),
  add constraint attestation_jobs_schema_uid_check check (
    schema_uid is null or schema_uid ~ '^0x[0-9a-f]{64}$'
  ),
  add constraint attestation_jobs_issuer_check check (
    issuer is null or issuer ~ '^0x[0-9a-f]{40}$'
  ),
  add constraint attestation_jobs_transaction_hash_check check (
    transaction_hash is null or transaction_hash ~ '^0x[0-9a-f]{64}$'
  ),
  add constraint attestation_jobs_attestation_uid_check check (
    attestation_uid is null or attestation_uid ~ '^0x[0-9a-f]{64}$'
  ),
  add constraint attestation_jobs_verified_metadata_check check (
    state <> 'VERIFIED'
    or num_nonnulls(
      attestation_uid,
      transaction_hash,
      chain_id,
      schema_uid,
      issuer,
      verified_at
    ) = 6
  );

alter table public.alert_access_sessions enable row level security;
alter table public.alert_access_sessions force row level security;
alter table public.guardian_notification_preferences enable row level security;
alter table public.guardian_notification_preferences force row level security;
alter table public.risk_recompute_queue enable row level security;
alter table public.risk_recompute_queue force row level security;

revoke all on table public.alert_access_sessions from public, anon, authenticated;
revoke all on table public.guardian_notification_preferences from public, anon, authenticated;
revoke all on table public.risk_recompute_queue from public, anon, authenticated;

grant all on table
  public.alert_access_sessions,
  public.guardian_notification_preferences,
  public.risk_recompute_queue
to service_role;

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
  where access_token.token_hash = p_token_hash
    and access_token.event_id = p_event_id
    and access_token.exchanged_at is null
    and access_token.revoked_at is null
    and access_token.expires_at > p_now
  for update;

  if not found then
    return false;
  end if;

  update public.alert_access_tokens as access_token
  set exchanged_at = p_now
  where access_token.id = v_grant.id;

  insert into public.alert_access_sessions (
    alert_id,
    event_id,
    session_hash,
    expires_at
  ) values (
    v_grant.alert_id,
    v_grant.event_id,
    p_session_hash,
    p_session_expires_at
  );

  return true;
exception
  when unique_violation then
    return false;
end;
$$;

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
  lease_until timestamptz
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

  return query
  with claimable as (
    select guardian_alert.id
    from public.guardian_alerts as guardian_alert
    where (
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
  )
  update public.guardian_alerts as guardian_alert
  set
    status = 'PROCESSING',
    attempt_count = guardian_alert.attempt_count + 1,
    lease_until = p_lease_until,
    next_attempt_at = null,
    error_code = null,
    updated_at = p_now
  from claimable
  where guardian_alert.id = claimable.id
  returning
    guardian_alert.id,
    guardian_alert.alert_transition_id,
    guardian_alert.recipient_ref,
    guardian_alert.channel,
    guardian_alert.template_key,
    guardian_alert.risk_level,
    guardian_alert.idempotency_key,
    guardian_alert.attempt_count::integer,
    guardian_alert.lease_until;
end;
$$;

create or replace function public.recheck_guardian_alert_eligibility(
  p_alert_id uuid,
  p_expected_lease_until timestamptz
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
  select guardian_alert.*
  into v_alert
  from public.guardian_alerts as guardian_alert
  where guardian_alert.id = p_alert_id
    and guardian_alert.status = 'PROCESSING'
    and guardian_alert.lease_until = p_expected_lease_until;

  if not found then
    raise exception using errcode = 'P0001', message = 'notification lease lost';
  end if;

  select preference.*
  into v_preferences
  from public.guardian_notification_preferences as preference
  where preference.subject_id = v_alert.subject_id;

  if not found or v_preferences.consented_at is null then
    return query select 'SUPPRESSED'::text, 'NO_CONSENT'::text;
  elsif v_preferences.withdrawn_at is not null then
    return query select 'SUPPRESSED'::text, 'CONSENT_WITHDRAWN'::text;
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

create or replace function public.finalize_guardian_alert_outbox(
  p_alert_id uuid,
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
        'NO_CONSENT', 'CONSENT_WITHDRAWN', 'CHANNEL_BLOCKED', 'RECIPIENT_UNAVAILABLE'
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
      -- ACCEPTED, DELIVERED, and ALERT_SENT are deliberately impossible in Demo mode.
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
     or v_alert.lease_until is distinct from p_expected_lease_until then
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
    sent_at = null,
    accepted_at = null,
    delivered_at = null,
    updated_at = clock_timestamp()
  where guardian_alert.id = p_alert_id;

  return query select 'APPLIED'::text, v_target_status;
end;
$$;

create or replace function public.claim_attestation_jobs(
  p_now timestamptz,
  p_lease_until timestamptz,
  p_limit integer
)
returns table (
  job_id uuid,
  target_kind text,
  target_id uuid,
  idempotency_key text,
  attempt_count integer,
  lease_until timestamptz
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
    raise exception using errcode = '22023', message = 'invalid attestation claim';
  end if;

  return query
  with claimable as (
    select job.id
    from public.attestation_jobs as job
    where (
      (job.state in ('PENDING', 'RETRY_WAIT') and job.next_attempt_at <= p_now)
      or (job.state = 'PROCESSING' and job.lease_until <= p_now)
    )
    order by job.next_attempt_at, job.created_at, job.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.attestation_jobs as job
    set
      state = 'PROCESSING',
      attempt_count = job.attempt_count + 1,
      lease_until = p_lease_until,
      last_attempt_at = p_now,
      error_code = null,
      updated_at = p_now
    from claimable
    where job.id = claimable.id
    returning job.*
  ), mark_report as (
    update public.shelter_reports as report
    set attestation_state = 'PENDING'
    from claimed
    where claimed.shelter_report_id = report.id
    returning report.id
  ), mark_checkin as (
    update public.shelter_checkins as checkin
    set attestation_state = 'PENDING'
    from claimed
    where claimed.shelter_checkin_id = checkin.id
    returning checkin.id
  ), mark_care_event as (
    update public.care_events as care_event
    set attestation_state = 'PENDING'
    from claimed
    where claimed.care_event_id = care_event.id
    returning care_event.id
  )
  select
    claimed.id,
    case
      when claimed.care_event_id is not null then 'CARE_EVENT'
      when claimed.shelter_report_id is not null then 'SHELTER_REPORT'
      else 'SHELTER_CHECKIN'
    end,
    coalesce(claimed.care_event_id, claimed.shelter_report_id, claimed.shelter_checkin_id),
    claimed.idempotency_key,
    claimed.attempt_count::integer,
    claimed.lease_until
  from claimed;
end;
$$;

create or replace function public.finalize_attestation_job(
  p_job_id uuid,
  p_expected_lease_until timestamptz,
  p_outcome jsonb
)
returns table (disposition text, state public.attestation_job_state)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.attestation_jobs%rowtype;
  v_kind text;
  v_target_state public.attestation_job_state;
  v_uid text;
  v_transaction_hash text;
  v_chain_id integer;
  v_schema_uid text;
  v_issuer text;
  v_verified_at timestamptz;
begin
  if jsonb_typeof(p_outcome) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid attestation outcome';
  end if;

  v_kind := p_outcome ->> 'kind';
  case v_kind
    when 'VERIFIED' then
      if (select count(*) from jsonb_object_keys(p_outcome)) <> 7
         or not (p_outcome ?& array[
           'kind',
           'attestation_uid',
           'transaction_hash',
           'chain_id',
           'schema_uid',
           'issuer',
           'verified_at'
         ]) then
        raise exception using errcode = '22023', message = 'invalid attestation outcome';
      end if;
      v_uid := lower(p_outcome ->> 'attestation_uid');
      v_transaction_hash := lower(p_outcome ->> 'transaction_hash');
      v_chain_id := (p_outcome ->> 'chain_id')::integer;
      v_schema_uid := lower(p_outcome ->> 'schema_uid');
      v_issuer := lower(p_outcome ->> 'issuer');
      v_verified_at := (p_outcome ->> 'verified_at')::timestamptz;
      if v_uid is null or v_uid !~ '^0x[0-9a-f]{64}$'
         or v_transaction_hash is null or v_transaction_hash !~ '^0x[0-9a-f]{64}$'
         or v_chain_id is null or v_chain_id <> 84532
         or v_schema_uid is null or v_schema_uid !~ '^0x[0-9a-f]{64}$'
         or v_issuer is null or v_issuer !~ '^0x[0-9a-f]{40}$'
         or v_verified_at is null then
        raise exception using errcode = '22023', message = 'invalid attestation outcome';
      end if;
      v_target_state := 'VERIFIED';
    when 'RETRY_WAIT' then
      if (select count(*) from jsonb_object_keys(p_outcome)) <> 3
         or not (p_outcome ?& array['kind', 'error_code', 'next_attempt_at'])
         or (p_outcome ->> 'error_code') !~ '^[A-Z][A-Z0-9_]{0,63}$'
         or (p_outcome ->> 'next_attempt_at') is null then
        raise exception using errcode = '22023', message = 'invalid attestation outcome';
      end if;
      perform (p_outcome ->> 'next_attempt_at')::timestamptz;
      v_target_state := 'RETRY_WAIT';
    when 'FAILED' then
      if (select count(*) from jsonb_object_keys(p_outcome)) <> 2
         or not (p_outcome ?& array['kind', 'error_code'])
         or (p_outcome ->> 'error_code') !~ '^[A-Z][A-Z0-9_]{0,63}$' then
        raise exception using errcode = '22023', message = 'invalid attestation outcome';
      end if;
      v_target_state := 'FAILED';
    else
      raise exception using errcode = '22023', message = 'invalid attestation outcome';
  end case;

  select job.*
  into v_job
  from public.attestation_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'attestation job not found';
  end if;

  if v_job.state = 'VERIFIED' and v_kind = 'VERIFIED'
     and v_job.attestation_uid = v_uid
     and v_job.transaction_hash = v_transaction_hash
     and v_job.chain_id = v_chain_id
     and v_job.schema_uid = v_schema_uid
     and v_job.issuer = v_issuer then
    return query select 'IDEMPOTENT'::text, v_job.state;
    return;
  end if;

  if v_job.state <> 'PROCESSING'
     or v_job.lease_until is distinct from p_expected_lease_until then
    return query select 'LEASE_LOST'::text, v_job.state;
    return;
  end if;

  update public.attestation_jobs as job
  set
    state = v_target_state,
    next_attempt_at = case
      when v_kind = 'RETRY_WAIT' then (p_outcome ->> 'next_attempt_at')::timestamptz
      else job.next_attempt_at
    end,
    lease_until = null,
    error_code = case when v_kind = 'VERIFIED' then null else p_outcome ->> 'error_code' end,
    attestation_uid = case when v_kind = 'VERIFIED' then v_uid else job.attestation_uid end,
    transaction_hash = case when v_kind = 'VERIFIED' then v_transaction_hash else job.transaction_hash end,
    chain_id = case when v_kind = 'VERIFIED' then v_chain_id else job.chain_id end,
    schema_uid = case when v_kind = 'VERIFIED' then v_schema_uid else job.schema_uid end,
    issuer = case when v_kind = 'VERIFIED' then v_issuer else job.issuer end,
    verified_at = case when v_kind = 'VERIFIED' then v_verified_at else job.verified_at end,
    updated_at = clock_timestamp()
  where job.id = v_job.id;

  if v_kind = 'VERIFIED' then
    if v_job.care_event_id is not null then
      update public.care_events as care_event
      set
        attestation_state = 'VERIFIED',
        attestation_uid = v_uid,
        issuer = v_issuer
      where care_event.id = v_job.care_event_id;
    elsif v_job.shelter_report_id is not null then
      update public.shelter_reports as report
      set
        attestation_state = 'VERIFIED',
        attestation_uid = v_uid
      where report.id = v_job.shelter_report_id;
    else
      update public.shelter_checkins as checkin
      set
        attestation_state = 'VERIFIED',
        attestation_uid = v_uid,
        attestation_verified_at = v_verified_at
      where checkin.id = v_job.shelter_checkin_id;

      insert into public.risk_recompute_queue (
        shelter_checkin_id,
        subject_id,
        requested_at
      )
      select checkin.id, checkin.subject_id, v_verified_at
      from public.shelter_checkins as checkin
      where checkin.id = v_job.shelter_checkin_id
      on conflict (shelter_checkin_id) do nothing;
    end if;
  elsif v_kind = 'FAILED' then
    update public.care_events as care_event
    set attestation_state = 'FAILED'
    where care_event.id = v_job.care_event_id;
    update public.shelter_reports as report
    set attestation_state = 'FAILED'
    where report.id = v_job.shelter_report_id;
    update public.shelter_checkins as checkin
    set attestation_state = 'FAILED'
    where checkin.id = v_job.shelter_checkin_id;
  end if;

  return query select 'APPLIED'::text, v_target_state;
end;
$$;

revoke all on function public.consume_alert_access_token(
  text, uuid, timestamptz, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.claim_guardian_alert_outbox(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.recheck_guardian_alert_eligibility(
  uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.finalize_guardian_alert_outbox(
  uuid, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.claim_attestation_jobs(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.finalize_attestation_job(
  uuid, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.consume_alert_access_token(
  text, uuid, timestamptz, text, timestamptz
) to service_role;
grant execute on function public.claim_guardian_alert_outbox(
  timestamptz, timestamptz, integer
) to service_role;
grant execute on function public.recheck_guardian_alert_eligibility(
  uuid, timestamptz
) to service_role;
grant execute on function public.finalize_guardian_alert_outbox(
  uuid, timestamptz, jsonb
) to service_role;
grant execute on function public.claim_attestation_jobs(
  timestamptz, timestamptz, integer
) to service_role;
grant execute on function public.finalize_attestation_job(
  uuid, timestamptz, jsonb
) to service_role;
