-- Phase 7 P0: lease ownership and durable EAS transaction submission.
-- A chain broadcast is never retried unless the database can prove that no
-- broadcast was started. Once a transaction hash exists, workers only recheck
-- that exact transaction.

alter table public.attestation_jobs
  add column claim_token uuid,
  add column submission_started_at timestamptz,
  add column submitted_at timestamptz;

update public.attestation_jobs as job
set
  submission_started_at = coalesce(job.last_attempt_at, job.verified_at, job.updated_at),
  submitted_at = coalesce(job.verified_at, job.last_attempt_at, job.updated_at)
where job.transaction_hash is not null;

do $$
begin
  if exists (
    select 1
    from public.attestation_jobs as job
    where job.schema_uid is not null
      and job.schema_uid not in (
        '0xb77211e6202932084cf648733012fa2c50e6657abb8fd2229ee3cbf9496fc376',
        '0x3850e3807da40c75eccd7b6d6d4414d865540acbefa6a7cc08308670bc029561'
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'non-canonical attestation schema requires manual review';
  end if;
end;
$$;

alter table public.attestation_jobs
  add constraint attestation_jobs_fixed_schema_uid_check check (
    schema_uid is null
    or schema_uid in (
      '0xb77211e6202932084cf648733012fa2c50e6657abb8fd2229ee3cbf9496fc376',
      '0x3850e3807da40c75eccd7b6d6d4414d865540acbefa6a7cc08308670bc029561'
    )
  ),
  add constraint attestation_jobs_submission_metadata_check check (
    num_nonnulls(transaction_hash, chain_id, schema_uid, issuer, submitted_at) in (0, 5)
  ),
  add constraint attestation_jobs_submission_timeline_check check (
    submitted_at is null
    or (
      submission_started_at is not null
      and submitted_at >= submission_started_at
    )
  );

revoke all on function public.claim_attestation_jobs(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.finalize_attestation_job(
  uuid, timestamptz, jsonb
) from public, anon, authenticated;

drop function public.claim_attestation_jobs(timestamptz, timestamptz, integer);
drop function public.finalize_attestation_job(uuid, timestamptz, jsonb);

create function public.claim_attestation_jobs(
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
  lease_until timestamptz,
  claim_token uuid,
  submission_started_at timestamptz,
  transaction_hash text,
  chain_id integer,
  schema_uid text,
  issuer text
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
      and (
        (job.submission_started_at is null and job.transaction_hash is null)
        or (
          job.submission_started_at is not null
          and job.transaction_hash is not null
          and job.chain_id = 84532
          and job.schema_uid is not null
          and job.issuer is not null
          and job.submitted_at is not null
        )
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
      claim_token = gen_random_uuid(),
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
    claimed.lease_until,
    claimed.claim_token,
    claimed.submission_started_at,
    claimed.transaction_hash,
    claimed.chain_id,
    claimed.schema_uid,
    claimed.issuer
  from claimed;
end;
$$;

create function public.begin_attestation_submission(
  p_job_id uuid,
  p_claim_token uuid,
  p_expected_lease_until timestamptz,
  p_started_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.attestation_jobs%rowtype;
begin
  if p_job_id is null
     or p_claim_token is null
     or p_expected_lease_until is null
     or p_started_at is null then
    raise exception using errcode = '22023', message = 'invalid attestation submission start';
  end if;

  select job.* into v_job
  from public.attestation_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'attestation job not found';
  end if;

  if v_job.state = 'PROCESSING'
     and v_job.claim_token is not distinct from p_claim_token
     and v_job.lease_until is not distinct from p_expected_lease_until
     and v_job.submission_started_at is not distinct from p_started_at
     and v_job.transaction_hash is null then
    return 'IDEMPOTENT';
  end if;

  if v_job.state <> 'PROCESSING'
     or v_job.claim_token is distinct from p_claim_token
     or v_job.lease_until is distinct from p_expected_lease_until
     or v_job.lease_until <= p_started_at
     or v_job.submission_started_at is not null
     or v_job.transaction_hash is not null then
    return 'LEASE_LOST';
  end if;

  update public.attestation_jobs as job
  set
    submission_started_at = p_started_at,
    updated_at = clock_timestamp()
  where job.id = v_job.id;

  return 'APPLIED';
end;
$$;

create function public.record_attestation_submission(
  p_job_id uuid,
  p_claim_token uuid,
  p_transaction_hash text,
  p_chain_id integer,
  p_schema_uid text,
  p_issuer text,
  p_submitted_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.attestation_jobs%rowtype;
begin
  if p_job_id is null
     or p_claim_token is null
     or lower(p_transaction_hash) !~ '^0x[0-9a-f]{64}$'
     or p_chain_id <> 84532
     or lower(p_schema_uid) not in (
       '0xb77211e6202932084cf648733012fa2c50e6657abb8fd2229ee3cbf9496fc376',
       '0x3850e3807da40c75eccd7b6d6d4414d865540acbefa6a7cc08308670bc029561'
     )
     or lower(p_issuer) !~ '^0x[0-9a-f]{40}$'
     or p_submitted_at is null then
    raise exception using errcode = '22023', message = 'invalid attestation submission';
  end if;

  select job.* into v_job
  from public.attestation_jobs as job
  where job.id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'attestation job not found';
  end if;

  if v_job.transaction_hash = lower(p_transaction_hash)
     and v_job.chain_id = p_chain_id
     and v_job.schema_uid = lower(p_schema_uid)
     and v_job.issuer = lower(p_issuer)
     and v_job.submitted_at = p_submitted_at then
    return 'IDEMPOTENT';
  end if;

  if v_job.state <> 'PROCESSING'
     or v_job.claim_token is distinct from p_claim_token
     or v_job.submission_started_at is null
     or p_submitted_at < v_job.submission_started_at
     or v_job.transaction_hash is not null then
    return 'LEASE_LOST';
  end if;

  update public.attestation_jobs as job
  set
    transaction_hash = lower(p_transaction_hash),
    chain_id = p_chain_id,
    schema_uid = lower(p_schema_uid),
    issuer = lower(p_issuer),
    submitted_at = p_submitted_at,
    updated_at = clock_timestamp()
  where job.id = v_job.id;

  return 'APPLIED';
end;
$$;

create function public.finalize_attestation_job(
  p_job_id uuid,
  p_claim_token uuid,
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
           'kind', 'attestation_uid', 'transaction_hash', 'chain_id',
           'schema_uid', 'issuer', 'verified_at'
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
         or v_chain_id <> 84532
         or v_schema_uid not in (
           '0xb77211e6202932084cf648733012fa2c50e6657abb8fd2229ee3cbf9496fc376',
           '0x3850e3807da40c75eccd7b6d6d4414d865540acbefa6a7cc08308670bc029561'
         )
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

  select job.* into v_job
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
     or v_job.claim_token is distinct from p_claim_token
     or v_job.lease_until is distinct from p_expected_lease_until then
    return query select 'LEASE_LOST'::text, v_job.state;
    return;
  end if;

  if v_kind = 'VERIFIED'
     and (
       v_job.transaction_hash is distinct from v_transaction_hash
       or v_job.chain_id is distinct from v_chain_id
       or v_job.schema_uid is distinct from v_schema_uid
       or v_job.issuer is distinct from v_issuer
       or v_job.submitted_at is null
     ) then
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
    submission_started_at = case
      when v_kind = 'RETRY_WAIT'
        and job.transaction_hash is null
        and p_outcome ->> 'error_code' = 'SUBMISSION_TEMPORARY'
      then null
      else job.submission_started_at
    end,
    attestation_uid = case when v_kind = 'VERIFIED' then v_uid else job.attestation_uid end,
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
        shelter_checkin_id, subject_id, requested_at
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

revoke all on function public.claim_attestation_jobs(
  timestamptz, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.begin_attestation_submission(
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.record_attestation_submission(
  uuid, uuid, text, integer, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.finalize_attestation_job(
  uuid, uuid, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.claim_attestation_jobs(
  timestamptz, timestamptz, integer
) to service_role;
grant execute on function public.begin_attestation_submission(
  uuid, uuid, timestamptz, timestamptz
) to service_role;
grant execute on function public.record_attestation_submission(
  uuid, uuid, text, integer, text, text, timestamptz
) to service_role;
grant execute on function public.finalize_attestation_job(
  uuid, uuid, timestamptz, jsonb
) to service_role;
