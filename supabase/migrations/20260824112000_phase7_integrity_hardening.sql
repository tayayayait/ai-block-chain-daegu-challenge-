-- Phase 7 integrity hardening for already-migrated environments.
-- Fresh installs also receive the corrected source migrations; these guards
-- prevent older function bodies from producing false public state.

create or replace function public.reject_unverified_medication_alert_sent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type = 'ALERT_SENT'
     and new.idempotency_key like 'medication-confirmation:%'
     and new.payload ->> 'reason' = 'MEDICATION_CONFIRMATION' then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists reject_unverified_medication_alert_sent
on public.care_events;
create trigger reject_unverified_medication_alert_sent
before insert on public.care_events
for each row execute function public.reject_unverified_medication_alert_sent();

-- Remove only legacy rows created by the superseded medication-confirmation
-- path. Verified or otherwise-attested records are never deleted implicitly.
delete from public.care_events as care_event
where care_event.event_type = 'ALERT_SENT'
  and care_event.idempotency_key like 'medication-confirmation:%'
  and care_event.payload ->> 'reason' = 'MEDICATION_CONFIRMATION'
  and care_event.attestation_state = 'UNVERIFIED'
  and care_event.attestation_uid is null
  and not exists (
    select 1
    from public.attestation_jobs as job
    where job.care_event_id = care_event.id
  );

create or replace function public.keep_retrying_attestation_target_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.care_event_id is not null then
    update public.care_events as care_event
    set attestation_state = 'PENDING'
    where care_event.id = new.care_event_id
      and care_event.attestation_state <> 'VERIFIED';
  elsif new.shelter_report_id is not null then
    update public.shelter_reports as report
    set attestation_state = 'PENDING'
    where report.id = new.shelter_report_id
      and report.attestation_state <> 'VERIFIED';
  else
    update public.shelter_checkins as checkin
    set attestation_state = 'PENDING'
    where checkin.id = new.shelter_checkin_id
      and checkin.attestation_state <> 'VERIFIED';
  end if;
  return null;
end;
$$;

drop trigger if exists attestation_retry_target_pending
on public.attestation_jobs;
create constraint trigger attestation_retry_target_pending
after update of state on public.attestation_jobs
deferrable initially deferred
for each row
when (new.state = 'RETRY_WAIT')
execute function public.keep_retrying_attestation_target_pending();

create or replace function public.exclude_unknown_crowd_from_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.shelter_report_id is not null
     and exists (
       select 1
       from public.shelter_reports as report
       where report.id = new.shelter_report_id
         and report.crowd_level is null
     ) then
    new.state := 'FAILED';
    new.error_code := 'CROWD_NOT_PROVIDED';
    new.lease_until := null;
  end if;
  return new;
end;
$$;

drop trigger if exists exclude_unknown_crowd_from_attestation
on public.attestation_jobs;
create trigger exclude_unknown_crowd_from_attestation
before insert on public.attestation_jobs
for each row execute function public.exclude_unknown_crowd_from_attestation();

update public.attestation_jobs as job
set
  state = 'FAILED',
  error_code = 'CROWD_NOT_PROVIDED',
  lease_until = null,
  updated_at = clock_timestamp()
from public.shelter_reports as report
where report.id = job.shelter_report_id
  and report.crowd_level is null
  and report.attestation_uid is null
  and job.state in ('PENDING', 'PROCESSING', 'RETRY_WAIT');

alter table public.risk_recompute_queue
  add column if not exists lease_until timestamptz,
  add column if not exists attempt_count integer not null default 0
    check (attempt_count >= 0),
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists error_code text
    check (error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$');

drop index if exists public.risk_recompute_queue_pending_idx;
create index risk_recompute_queue_pending_idx
  on public.risk_recompute_queue (next_attempt_at, requested_at, shelter_checkin_id)
  where processed_at is null;

create or replace function public.claim_risk_recompute_queue(
  p_now timestamptz,
  p_lease_until timestamptz,
  p_limit integer
)
returns table (
  shelter_checkin_id uuid,
  subject_id uuid,
  lease_until timestamptz,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null
     or p_lease_until is null
     or p_lease_until <= p_now
     or p_lease_until > p_now + interval '10 minutes'
     or p_limit is null
     or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid risk queue claim';
  end if;

  return query
  with due as materialized (
    select queue.shelter_checkin_id
    from public.risk_recompute_queue as queue
    where queue.processed_at is null
      and queue.next_attempt_at <= p_now
      and (queue.lease_until is null or queue.lease_until <= p_now)
    order by queue.next_attempt_at, queue.requested_at, queue.shelter_checkin_id
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.risk_recompute_queue as queue
    set
      lease_until = p_lease_until,
      attempt_count = queue.attempt_count + 1,
      error_code = null
    from due
    where queue.shelter_checkin_id = due.shelter_checkin_id
    returning queue.shelter_checkin_id, queue.subject_id, queue.lease_until, queue.attempt_count
  )
  select claimed.shelter_checkin_id, claimed.subject_id, claimed.lease_until, claimed.attempt_count
  from claimed;
end;
$$;

create or replace function public.finalize_risk_recompute_queue(
  p_shelter_checkin_id uuid,
  p_expected_lease_until timestamptz,
  p_completed_at timestamptz,
  p_succeeded boolean,
  p_error_code text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue public.risk_recompute_queue%rowtype;
  v_retry_seconds integer;
begin
  if p_shelter_checkin_id is null
     or p_expected_lease_until is null
     or p_completed_at is null
     or p_succeeded is null
     or (
       not p_succeeded
       and (
         p_error_code is null
         or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
       )
     )
     or (p_succeeded and p_error_code is not null) then
    raise exception using errcode = '22023', message = 'invalid risk queue outcome';
  end if;

  select queue.*
  into v_queue
  from public.risk_recompute_queue as queue
  where queue.shelter_checkin_id = p_shelter_checkin_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'risk queue item not found';
  end if;
  if v_queue.processed_at is not null and p_succeeded then
    return 'IDEMPOTENT';
  end if;
  if v_queue.processed_at is not null
     or v_queue.lease_until is distinct from p_expected_lease_until then
    return 'LEASE_LOST';
  end if;

  if p_succeeded then
    update public.risk_recompute_queue as queue
    set
      processed_at = p_completed_at,
      lease_until = null,
      error_code = null
    where queue.shelter_checkin_id = p_shelter_checkin_id;
  else
    v_retry_seconds := least(3600, 30 * (2 ^ least(v_queue.attempt_count, 7))::integer);
    update public.risk_recompute_queue as queue
    set
      lease_until = null,
      next_attempt_at = p_completed_at + make_interval(secs => v_retry_seconds),
      error_code = p_error_code
    where queue.shelter_checkin_id = p_shelter_checkin_id;
  end if;
  return 'APPLIED';
end;
$$;

revoke all on function public.claim_risk_recompute_queue(timestamptz, timestamptz, integer)
from public, anon, authenticated;
revoke all on function public.finalize_risk_recompute_queue(
  uuid, timestamptz, timestamptz, boolean, text
) from public, anon, authenticated;
grant execute on function public.claim_risk_recompute_queue(timestamptz, timestamptz, integer)
to service_role;
grant execute on function public.finalize_risk_recompute_queue(
  uuid, timestamptz, timestamptz, boolean, text
) to service_role;

revoke all on function public.reject_unverified_medication_alert_sent() from public, anon, authenticated;
revoke all on function public.keep_retrying_attestation_target_pending() from public, anon, authenticated;
revoke all on function public.exclude_unknown_crowd_from_attestation() from public, anon, authenticated;
