-- Durable cleanup intents close the gap between private Storage uploads and
-- medication_scan_sessions writes. Every object has a server-only cleanup job
-- before upload starts; attaching only moves its deadline to the 24-hour purge.

alter table public.medication_scan_sessions
  alter column image_purge_state set default 'NOT_APPLICABLE';

-- Older deployments accepted any non-blank object path. Do not silently skip
-- or delete an object whose path is outside the server-owned UUID namespace.
-- Operators must move or remove those legacy objects before retrying so every
-- retained image receives a durable cleanup receipt.
do $$
declare
  v_invalid_path_count bigint;
begin
  select count(*)
  into v_invalid_path_count
  from public.medication_scan_sessions as scan
  where scan.input_method = 'IMAGE'
    and scan.image_path is not null
    and not (
      length(scan.image_path) between 1 and 512
      and scan.image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-attempt-[1-9][0-9]*\.(jpg|png|webp)$'
    );

  if v_invalid_path_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'medication cleanup migration found %s legacy image path(s) outside the managed UUID namespace',
        v_invalid_path_count
      ),
      hint = 'Move or remove the reported legacy medication image objects and their scan rows, then retry the migration.';
  end if;
end
$$;

create table public.medication_image_cleanup_jobs (
  id uuid primary key,
  session_id uuid not null,
  image_path text not null unique check (
    length(image_path) between 1 and 512
    and image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-attempt-[1-9][0-9]*\.(jpg|png|webp)$'
  ),
  state text not null default 'PREPARED' check (
    state in ('PREPARED', 'DELETE_PENDING', 'PROCESSING', 'RETRY_WAIT')
  ),
  cleanup_after timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  lease_token uuid,
  lease_until timestamptz,
  error_code text check (
    error_code is null or error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (
    (
      state = 'PROCESSING'
      and lease_token is not null
      and lease_until is not null
      and error_code is null
    )
    or (
      state <> 'PROCESSING'
      and lease_token is null
      and lease_until is null
    )
  ),
  check (state <> 'RETRY_WAIT' or error_code is not null)
);

alter table public.medication_image_cleanup_jobs enable row level security;
alter table public.medication_image_cleanup_jobs force row level security;

revoke all on table public.medication_image_cleanup_jobs
from public, anon, authenticated;
grant all on table public.medication_image_cleanup_jobs to service_role;

create index medication_image_cleanup_due_idx
  on public.medication_image_cleanup_jobs (cleanup_after, id)
  where state in ('PREPARED', 'DELETE_PENDING', 'PROCESSING', 'RETRY_WAIT');

create index medication_image_cleanup_stale_lease_idx
  on public.medication_image_cleanup_jobs (lease_until, id)
  where state = 'PROCESSING';

-- Existing current images become scheduled jobs at their original 24-hour
-- purge deadline. A previous worker lease is safely normalized during DDL.
insert into public.medication_image_cleanup_jobs (
  id,
  session_id,
  image_path,
  state,
  cleanup_after,
  attempt_count,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  scan.id,
  scan.image_path,
  'DELETE_PENDING',
  case
    when scan.image_purge_state = 'RETRY_WAIT'
      then greatest(scan.purge_after, scan.image_purge_next_attempt_at)
    when scan.image_purge_state = 'PROCESSING'
      then least(scan.purge_after, statement_timestamp())
    else scan.purge_after
  end,
  scan.image_purge_attempt_count,
  scan.created_at,
  statement_timestamp()
from public.medication_scan_sessions as scan
where scan.input_method = 'IMAGE'
  and scan.image_path is not null
on conflict (image_path) do nothing;

update public.medication_scan_sessions as scan
set
  image_purge_state = 'PENDING',
  image_purge_claimed_at = null,
  image_purge_next_attempt_at = greatest(scan.purge_after, statement_timestamp()),
  image_purge_error_code = null,
  updated_at = statement_timestamp()
where scan.input_method = 'IMAGE'
  and scan.image_path is not null;

create or replace function public.prepare_medication_image_cleanup(
  p_cleanup_job_id uuid,
  p_session_id uuid,
  p_image_path text,
  p_prepared_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.medication_image_cleanup_jobs%rowtype;
begin
  if p_cleanup_job_id is null
     or p_session_id is null
     or p_prepared_at is null
     or p_image_path is null
     or length(p_image_path) not between 1 and 512
     or p_image_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-attempt-[1-9][0-9]*\.(jpg|png|webp)$'
     or split_part(p_image_path, '/', 2) not like p_session_id::text || '-attempt-%' then
    raise exception using errcode = '22023', message = 'invalid image cleanup request';
  end if;

  begin
    insert into public.medication_image_cleanup_jobs (
      id,
      session_id,
      image_path,
      state,
      cleanup_after,
      created_at,
      updated_at
    ) values (
      p_cleanup_job_id,
      p_session_id,
      p_image_path,
      'PREPARED',
      p_prepared_at + interval '30 minutes',
      p_prepared_at,
      p_prepared_at
    );
    return 'PREPARED';
  exception when unique_violation then
    select job.*
    into v_job
    from public.medication_image_cleanup_jobs as job
    where job.id = p_cleanup_job_id
    for update;

    if found
       and v_job.session_id = p_session_id
       and v_job.image_path = p_image_path
       and v_job.state in ('PREPARED', 'DELETE_PENDING') then
      return 'IDEMPOTENT';
    end if;
    raise exception using errcode = 'P0001', message = 'image cleanup unavailable';
  end;
end;
$$;

create or replace function public.attach_medication_image_session(
  p_cleanup_job_id uuid,
  p_session_id uuid,
  p_subject_id uuid,
  p_profile_id uuid,
  p_image_path text,
  p_attached_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.medication_image_cleanup_jobs%rowtype;
  v_existing public.medication_scan_sessions%rowtype;
begin
  if p_cleanup_job_id is null
     or p_session_id is null
     or p_subject_id is null
     or p_profile_id is null
     or p_attached_at is null
     or p_image_path is null
     or p_image_path !~ (
       '^' || p_subject_id::text || '/' || p_session_id::text ||
       '-attempt-1\.(jpg|png|webp)$'
     ) then
    raise exception using errcode = '22023', message = 'invalid image attach request';
  end if;

  select job.*
  into v_job
  from public.medication_image_cleanup_jobs as job
  where job.id = p_cleanup_job_id
  for update;

  if not found
     or v_job.session_id <> p_session_id
     or v_job.image_path <> p_image_path then
    raise exception using errcode = 'P0001', message = 'image attach unavailable';
  end if;

  if v_job.state = 'DELETE_PENDING' then
    select scan.*
    into v_existing
    from public.medication_scan_sessions as scan
    where scan.id = p_session_id;
    if found
       and v_existing.subject_id = p_subject_id
       and v_existing.created_by = p_profile_id
       and v_existing.image_path = p_image_path then
      return 'IDEMPOTENT';
    end if;
    raise exception using errcode = 'P0001', message = 'image attach unavailable';
  end if;

  if v_job.state <> 'PREPARED' then
    raise exception using errcode = 'P0001', message = 'image attach unavailable';
  end if;

  begin
    insert into public.medication_scan_sessions (
      id,
      subject_id,
      image_path,
      input_method,
      created_by,
      status,
      attempt_count,
      candidate_payload,
      purge_after,
      image_purge_state,
      image_purge_next_attempt_at,
      image_purge_attempt_count,
      created_at,
      updated_at
    ) values (
      p_session_id,
      p_subject_id,
      p_image_path,
      'IMAGE',
      p_profile_id,
      'UPLOADED',
      0,
      '[]'::jsonb,
      p_attached_at + interval '24 hours',
      'PENDING',
      p_attached_at + interval '24 hours',
      0,
      p_attached_at,
      p_attached_at
    );
  exception when unique_violation or foreign_key_violation or check_violation then
    raise exception using errcode = 'P0001', message = 'image attach unavailable';
  end;

  update public.medication_image_cleanup_jobs as job
  set
    state = 'DELETE_PENDING',
    cleanup_after = p_attached_at + interval '24 hours',
    attempt_count = 0,
    lease_token = null,
    lease_until = null,
    error_code = null,
    updated_at = p_attached_at
  where job.id = p_cleanup_job_id;

  return 'APPLIED';
end;
$$;

create or replace function public.replace_medication_image_session(
  p_cleanup_job_id uuid,
  p_session_id uuid,
  p_subject_id uuid,
  p_profile_id uuid,
  p_expected_attempt_count integer,
  p_new_image_path text,
  p_replaced_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan_snapshot public.medication_scan_sessions%rowtype;
  v_scan public.medication_scan_sessions%rowtype;
  v_new_job public.medication_image_cleanup_jobs%rowtype;
  v_old_job public.medication_image_cleanup_jobs%rowtype;
begin
  if p_cleanup_job_id is null
     or p_session_id is null
     or p_subject_id is null
     or p_profile_id is null
     or p_expected_attempt_count is null
     or p_expected_attempt_count not between 1 and 2
     or p_replaced_at is null
     or p_new_image_path is null
     or p_new_image_path !~ (
       '^' || p_subject_id::text || '/' || p_session_id::text || '-attempt-' ||
       (p_expected_attempt_count + 1)::text || '\.(jpg|png|webp)$'
     ) then
    raise exception using errcode = '22023', message = 'invalid image replacement request';
  end if;

  select scan.*
  into v_scan_snapshot
  from public.medication_scan_sessions as scan
  where scan.id = p_session_id
    and scan.subject_id = p_subject_id
    and scan.created_by = p_profile_id;

  if not found
     or v_scan_snapshot.attempt_count <> p_expected_attempt_count
     or v_scan_snapshot.image_path is null then
    raise exception using errcode = 'P0001', message = 'image replacement unavailable';
  end if;

  select job.*
  into v_new_job
  from public.medication_image_cleanup_jobs as job
  where job.id = p_cleanup_job_id
  for update;

  if not found
     or v_new_job.session_id <> p_session_id
     or v_new_job.image_path <> p_new_image_path
     or v_new_job.state not in ('PREPARED', 'DELETE_PENDING') then
    raise exception using errcode = 'P0001', message = 'image replacement unavailable';
  end if;

  -- A committed replacement whose response was lost is safe to replay with
  -- the same deterministic cleanup receipt and immutable object path.
  if v_scan_snapshot.status = 'UPLOADED'
     and v_scan_snapshot.image_path = p_new_image_path
     and v_new_job.state = 'DELETE_PENDING' then
    select scan.*
    into v_scan
    from public.medication_scan_sessions as scan
    where scan.id = p_session_id
      and scan.subject_id = p_subject_id
      and scan.created_by = p_profile_id
    for update;

    if found
       and v_scan.status = 'UPLOADED'
       and v_scan.attempt_count = p_expected_attempt_count
       and v_scan.image_path = p_new_image_path then
      return p_expected_attempt_count;
    end if;
    raise exception using errcode = 'P0001', message = 'image replacement unavailable';
  end if;

  if v_scan_snapshot.status <> 'NEEDS_RETAKE' then
    raise exception using errcode = 'P0001', message = 'image replacement unavailable';
  end if;

  -- Cleanup jobs are locked before the scan row, matching finalize's order
  -- and preventing replace/finalize deadlocks.
  select job.*
  into v_old_job
  from public.medication_image_cleanup_jobs as job
  where job.session_id = p_session_id
    and job.image_path = v_scan_snapshot.image_path
    and job.state in ('DELETE_PENDING', 'RETRY_WAIT')
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'image replacement unavailable';
  end if;

  select scan.*
  into v_scan
  from public.medication_scan_sessions as scan
  where scan.id = p_session_id
    and scan.subject_id = p_subject_id
    and scan.created_by = p_profile_id
  for update;

  if not found
     or v_scan.status <> 'NEEDS_RETAKE'
     or v_scan.attempt_count <> p_expected_attempt_count
     or v_scan.image_path <> v_scan_snapshot.image_path then
    raise exception using errcode = 'P0001', message = 'image replacement unavailable';
  end if;

  update public.medication_image_cleanup_jobs as job
  set
    state = 'DELETE_PENDING',
    cleanup_after = p_replaced_at,
    lease_token = null,
    lease_until = null,
    error_code = null,
    updated_at = p_replaced_at
  where job.id = v_old_job.id;

  update public.medication_scan_sessions as scan
  set
    image_path = p_new_image_path,
    image_quality = null,
    model_id = null,
    status = 'UPLOADED',
    candidate_payload = '[]'::jsonb,
    purge_after = p_replaced_at + interval '24 hours',
    image_deleted_at = null,
    image_purge_state = 'PENDING',
    image_purge_claimed_at = null,
    image_purge_next_attempt_at = p_replaced_at + interval '24 hours',
    image_purge_attempt_count = 0,
    image_purge_error_code = null,
    updated_at = p_replaced_at
  where scan.id = p_session_id;

  update public.medication_image_cleanup_jobs as job
  set
    state = 'DELETE_PENDING',
    cleanup_after = p_replaced_at + interval '24 hours',
    attempt_count = 0,
    lease_token = null,
    lease_until = null,
    error_code = null,
    updated_at = p_replaced_at
  where job.id = p_cleanup_job_id;

  return p_expected_attempt_count;
end;
$$;

create or replace function public.claim_medication_image_cleanups(
  p_now timestamptz,
  p_batch_limit integer
)
returns table (
  cleanup_job_id uuid,
  image_path text,
  lease_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null or p_batch_limit is null or p_batch_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid image cleanup claim';
  end if;

  return query
  with due as materialized (
    select job.id
    from public.medication_image_cleanup_jobs as job
    where (
      job.state in ('PREPARED', 'DELETE_PENDING', 'RETRY_WAIT')
      and job.cleanup_after <= p_now
    ) or (
      job.state = 'PROCESSING'
      and job.lease_until <= p_now
    )
    order by job.cleanup_after, job.id
    limit p_batch_limit
    for update skip locked
  ), claimed as (
    update public.medication_image_cleanup_jobs as job
    set
      state = 'PROCESSING',
      attempt_count = job.attempt_count + 1,
      lease_token = gen_random_uuid(),
      lease_until = p_now + interval '5 minutes',
      error_code = null,
      updated_at = p_now
    from due
    where job.id = due.id
    returning job.id, job.session_id, job.image_path, job.lease_token, job.attempt_count
  ), mark_session as (
    update public.medication_scan_sessions as scan
    set
      image_purge_state = 'PROCESSING',
      image_purge_claimed_at = p_now,
      image_purge_next_attempt_at = p_now,
      image_purge_attempt_count = claimed.attempt_count,
      image_purge_error_code = null,
      updated_at = p_now
    from claimed
    where scan.id = claimed.session_id
      and scan.image_path = claimed.image_path
      and scan.purge_after <= p_now
    returning scan.id
  )
  select claimed.id, claimed.image_path, claimed.lease_token, claimed.attempt_count
  from claimed;
end;
$$;

create or replace function public.finalize_medication_image_cleanup(
  p_cleanup_job_id uuid,
  p_lease_token uuid,
  p_deleted boolean,
  p_error_code text,
  p_now timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.medication_image_cleanup_jobs%rowtype;
  v_retry_seconds integer;
begin
  if p_cleanup_job_id is null
     or p_lease_token is null
     or p_deleted is null
     or p_now is null
     or (p_deleted and p_error_code is not null)
     or (
       not p_deleted
       and (p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$')
     ) then
    raise exception using errcode = '22023', message = 'invalid image cleanup outcome';
  end if;

  select job.*
  into v_job
  from public.medication_image_cleanup_jobs as job
  where job.id = p_cleanup_job_id
  for update;

  if not found
     or v_job.state <> 'PROCESSING'
     or v_job.lease_token <> p_lease_token
     or v_job.lease_until <= p_now then
    return 'LEASE_LOST';
  end if;

  if p_deleted then
    update public.medication_scan_sessions as scan
    set
      image_path = null,
      image_quality = null,
      model_id = null,
      candidate_payload = '[]'::jsonb,
      image_deleted_at = p_now,
      image_purge_state = 'PURGED',
      image_purge_claimed_at = null,
      image_purge_error_code = null,
      status = case
        when scan.status in ('COMPLETED', 'FAILED') then scan.status
        else 'FAILED'::public.medication_scan_status
      end,
      updated_at = p_now
    where scan.id = v_job.session_id
      and scan.image_path = v_job.image_path
      and scan.purge_after <= p_now;

    delete from public.medication_image_cleanup_jobs as job
    where job.id = p_cleanup_job_id
      and job.lease_token = p_lease_token;
    return 'APPLIED';
  end if;

  v_retry_seconds := least(21600, 60 * (2 ^ least(v_job.attempt_count, 8))::integer);
  update public.medication_image_cleanup_jobs as job
  set
    state = 'RETRY_WAIT',
    cleanup_after = p_now + make_interval(secs => v_retry_seconds),
    lease_token = null,
    lease_until = null,
    error_code = p_error_code,
    updated_at = p_now
  where job.id = p_cleanup_job_id;

  update public.medication_scan_sessions as scan
  set
    image_purge_state = 'RETRY_WAIT',
    image_purge_claimed_at = null,
    image_purge_next_attempt_at = p_now + make_interval(secs => v_retry_seconds),
    image_purge_attempt_count = v_job.attempt_count,
    image_purge_error_code = p_error_code,
    updated_at = p_now
  where scan.id = v_job.session_id
    and scan.image_path = v_job.image_path
    and scan.purge_after <= p_now;
  return 'APPLIED';
end;
$$;

revoke all on function public.prepare_medication_image_cleanup(uuid, uuid, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.attach_medication_image_session(uuid, uuid, uuid, uuid, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.replace_medication_image_session(uuid, uuid, uuid, uuid, integer, text, timestamptz)
from public, anon, authenticated;
revoke all on function public.claim_medication_image_cleanups(timestamptz, integer)
from public, anon, authenticated;
revoke all on function public.finalize_medication_image_cleanup(uuid, uuid, boolean, text, timestamptz)
from public, anon, authenticated;

grant execute on function public.prepare_medication_image_cleanup(uuid, uuid, text, timestamptz)
to service_role;
grant execute on function public.attach_medication_image_session(uuid, uuid, uuid, uuid, text, timestamptz)
to service_role;
grant execute on function public.replace_medication_image_session(uuid, uuid, uuid, uuid, integer, text, timestamptz)
to service_role;
grant execute on function public.claim_medication_image_cleanups(timestamptz, integer)
to service_role;
grant execute on function public.finalize_medication_image_cleanup(uuid, uuid, boolean, text, timestamptz)
to service_role;

-- Remove the superseded session-only purge API, which had no lease token and
-- could accept a stale finalize after another worker reclaimed the row.
revoke all on function public.claim_medication_image_purges(timestamptz, integer)
from public, anon, authenticated, service_role;
revoke all on function public.finalize_medication_image_purge(uuid, text, boolean, text, timestamptz)
from public, anon, authenticated, service_role;
drop function public.claim_medication_image_purges(timestamptz, integer);
drop function public.finalize_medication_image_purge(uuid, text, boolean, text, timestamptz);
