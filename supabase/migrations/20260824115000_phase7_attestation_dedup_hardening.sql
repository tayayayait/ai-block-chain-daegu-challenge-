-- Phase 7 integrity: one durable attestation job per target, with VERIFIED
-- targets protected from stale claims and replayed check-in requests.

create or replace function public.reject_unverified_medication_alert_sent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_type = 'ALERT_SENT'
     and new.idempotency_key like 'medication-confirmation:%'
     and new.payload ->> 'reason' = 'MEDICATION_CONFIRMATION'
     and new.attestation_state = 'UNVERIFIED'
     and new.attestation_uid is null then
    return null;
  end if;
  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from public.attestation_jobs
    where care_event_id is not null
    group by care_event_id having count(*) > 1
  ) or exists (
    select 1 from public.attestation_jobs
    where shelter_report_id is not null
    group by shelter_report_id having count(*) > 1
  ) or exists (
    select 1 from public.attestation_jobs
    where shelter_checkin_id is not null
    group by shelter_checkin_id having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'duplicate attestation targets require manual review';
  end if;
end;
$$;

create unique index if not exists attestation_jobs_care_event_unique_idx
  on public.attestation_jobs (care_event_id)
  where care_event_id is not null;
create unique index if not exists attestation_jobs_shelter_report_unique_idx
  on public.attestation_jobs (shelter_report_id)
  where shelter_report_id is not null;
create unique index if not exists attestation_jobs_shelter_checkin_unique_idx
  on public.attestation_jobs (shelter_checkin_id)
  where shelter_checkin_id is not null;

create or replace function public.create_pending_shelter_checkin(
  p_subject_id uuid,
  p_shelter_id text,
  p_checked_in_at timestamptz,
  p_actor_scope public.checkin_actor_scope,
  p_actor_ref_hash text,
  p_client_request_id uuid
)
returns table (
  checkin_id uuid,
  attestation_state public.attestation_state,
  attestation_job_state public.attestation_job_state
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored public.shelter_checkins%rowtype;
begin
  if p_subject_id is null
     or p_shelter_id is null
     or p_checked_in_at is null
     or p_checked_in_at > clock_timestamp()
     or p_actor_scope is null
     or p_actor_ref_hash !~ '^[0-9a-f]{64}$'
     or p_client_request_id is null then
    raise exception using errcode = '22023', message = 'invalid pending check-in request';
  end if;

  select * into stored
  from public.shelter_checkins
  where client_request_id = p_client_request_id
  for update;

  if found then
    if stored.subject_id is distinct from p_subject_id
       or stored.shelter_id is distinct from p_shelter_id
       or stored.actor_scope is distinct from p_actor_scope
       or stored.actor_ref_hash is distinct from p_actor_ref_hash then
      raise exception using errcode = '23505', message = 'check-in idempotency key mismatch';
    end if;
  else
    insert into public.shelter_checkins (
      subject_id,
      shelter_id,
      checked_in_at,
      actor_scope,
      actor_ref_hash,
      client_request_id,
      attestation_state
    ) values (
      p_subject_id,
      p_shelter_id,
      p_checked_in_at,
      p_actor_scope,
      p_actor_ref_hash,
      p_client_request_id,
      'PENDING'
    ) returning * into stored;
  end if;

  if stored.attestation_state <> 'VERIFIED' then
    insert into public.attestation_jobs (
      shelter_checkin_id,
      state,
      idempotency_key
    ) values (
      stored.id,
      'PENDING',
      'shelter-checkin:' || stored.id::text
    ) on conflict (idempotency_key) do nothing;
  end if;

  return query
  select
    stored.id,
    stored.attestation_state,
    coalesce((
      select job.state
      from public.attestation_jobs as job
      where job.shelter_checkin_id = stored.id
      order by job.created_at desc
      limit 1
    ), case
      when stored.attestation_state = 'VERIFIED'
        then 'VERIFIED'::public.attestation_job_state
      else 'PENDING'::public.attestation_job_state
    end);
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
     or p_lease_until is null
     or p_lease_until <= p_now
     or p_lease_until > p_now + interval '5 minutes'
     or p_limit is null
     or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid attestation claim';
  end if;

  update public.attestation_jobs as job
  set
    state = 'FAILED',
    lease_until = null,
    error_code = 'TARGET_ALREADY_VERIFIED',
    updated_at = p_now
  where job.state in ('PENDING', 'PROCESSING', 'RETRY_WAIT')
    and (
      exists (
        select 1 from public.care_events as care_event
        where care_event.id = job.care_event_id
          and care_event.attestation_state = 'VERIFIED'
      )
      or exists (
        select 1 from public.shelter_reports as report
        where report.id = job.shelter_report_id
          and report.attestation_state = 'VERIFIED'
      )
      or exists (
        select 1 from public.shelter_checkins as checkin
        where checkin.id = job.shelter_checkin_id
          and checkin.attestation_state = 'VERIFIED'
      )
    );

  return query
  with claimable as materialized (
    select job.id
    from public.attestation_jobs as job
    where (
      (job.state in ('PENDING', 'RETRY_WAIT') and job.next_attempt_at <= p_now)
      or (job.state = 'PROCESSING' and job.lease_until <= p_now)
    )
      and not exists (
        select 1 from public.care_events as care_event
        where care_event.id = job.care_event_id
          and care_event.attestation_state = 'VERIFIED'
      )
      and not exists (
        select 1 from public.shelter_reports as report
        where report.id = job.shelter_report_id
          and report.attestation_state = 'VERIFIED'
      )
      and not exists (
        select 1 from public.shelter_checkins as checkin
        where checkin.id = job.shelter_checkin_id
          and checkin.attestation_state = 'VERIFIED'
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
      and report.attestation_state <> 'VERIFIED'
    returning report.id
  ), mark_checkin as (
    update public.shelter_checkins as checkin
    set attestation_state = 'PENDING'
    from claimed
    where claimed.shelter_checkin_id = checkin.id
      and checkin.attestation_state <> 'VERIFIED'
    returning checkin.id
  ), mark_care_event as (
    update public.care_events as care_event
    set attestation_state = 'PENDING'
    from claimed
    where claimed.care_event_id = care_event.id
      and care_event.attestation_state <> 'VERIFIED'
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

revoke all on function public.create_pending_shelter_checkin(
  uuid, text, timestamptz, public.checkin_actor_scope, text, uuid
) from public, anon, authenticated;
revoke all on function public.claim_attestation_jobs(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.create_pending_shelter_checkin(
  uuid, text, timestamptz, public.checkin_actor_scope, text, uuid
) to service_role;
grant execute on function public.claim_attestation_jobs(
  timestamptz, timestamptz, integer
) to service_role;

revoke all on function public.reject_unverified_medication_alert_sent()
from public, anon, authenticated;
