-- Phase 8: bounded retention cleanup for short-lived grants, scan metadata,
-- route results, and terminal delivery/attestation worker records.
-- Storage objects are removed by the server worker before this migration's
-- finalize RPC is allowed to scrub the matching database path. SQL never
-- mutates Supabase Storage internals directly.

alter table public.medication_scan_sessions
  add column image_purge_state text not null default 'NOT_APPLICABLE'
    check (image_purge_state in ('NOT_APPLICABLE', 'PENDING', 'PROCESSING', 'RETRY_WAIT', 'PURGED')),
  add column image_purge_claimed_at timestamptz,
  add column image_purge_next_attempt_at timestamptz not null default now(),
  add column image_purge_attempt_count integer not null default 0
    check (image_purge_attempt_count >= 0),
  add column image_purge_error_code text
    check (
      image_purge_error_code is null
      or image_purge_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
    );

update public.medication_scan_sessions
set image_purge_state = 'PENDING'
where input_method = 'IMAGE'
  and image_path is not null;

update public.medication_scan_sessions
set image_purge_state = 'PURGED'
where input_method = 'IMAGE'
  and image_path is null
  and image_deleted_at is not null;

alter table public.medication_scan_sessions
  drop constraint if exists medication_scan_image_path_by_method;

alter table public.medication_scan_sessions
  add constraint medication_scan_image_path_by_method check (
    (
      input_method = 'IMAGE'
      and (
        (
          image_path is not null
          and image_deleted_at is null
          and image_purge_state in ('PENDING', 'PROCESSING', 'RETRY_WAIT')
        )
        or (
          image_path is null
          and image_deleted_at is not null
          and image_deleted_at >= purge_after
          and image_purge_state = 'PURGED'
        )
      )
    )
    or (
      input_method = 'MANUAL'
      and image_path is null
      and image_deleted_at is null
      and image_purge_state = 'NOT_APPLICABLE'
    )
  );

create index medication_scan_image_purge_due_idx
  on public.medication_scan_sessions (
    image_purge_next_attempt_at,
    purge_after,
    id
  )
  where input_method = 'IMAGE' and image_path is not null;

create index alert_access_tokens_retention_idx
  on public.alert_access_tokens (expires_at, id);
create index alert_access_tokens_alert_guard_idx
  on public.alert_access_tokens (alert_id);
create index alert_access_sessions_retention_idx
  on public.alert_access_sessions (expires_at, id);
create index alert_access_sessions_alert_guard_idx
  on public.alert_access_sessions (alert_id);
create index guardian_alerts_retention_idx
  on public.guardian_alerts (updated_at, id)
  where status in ('DEMO_RECORDED', 'DELIVERED', 'FAILED_PERMANENT', 'SUPPRESSED');
create index risk_recompute_queue_retention_idx
  on public.risk_recompute_queue (processed_at, shelter_checkin_id)
  where processed_at is not null;

create or replace function public.run_retention_cleanup(
  p_now timestamptz,
  p_batch_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access_tokens integer := 0;
  v_access_sessions integer := 0;
  v_route_cache integer := 0;
  v_medication_api_cache integer := 0;
  v_guardian_alerts integer := 0;
  v_attestation_jobs integer := 0;
  v_risk_recompute_queue integer := 0;
begin
  if p_now is null or p_batch_limit is null or p_batch_limit not between 1 and 500 then
    raise exception using
      errcode = '22023',
      message = 'invalid retention cleanup request';
  end if;

  with due as materialized (
    select access_token.id
    from public.alert_access_tokens as access_token
    where access_token.expires_at <= p_now
    order by access_token.expires_at, access_token.id
    limit p_batch_limit
    for update skip locked
  ), removed as (
    delete from public.alert_access_tokens as access_token
    using due
    where access_token.id = due.id
    returning 1
  )
  select count(*)::integer into v_access_tokens from removed;

  with due as materialized (
    select access_session.id
    from public.alert_access_sessions as access_session
    where access_session.expires_at <= p_now
    order by access_session.expires_at, access_session.id
    limit p_batch_limit
    for update skip locked
  ), removed as (
    delete from public.alert_access_sessions as access_session
    using due
    where access_session.id = due.id
    returning 1
  )
  select count(*)::integer into v_access_sessions from removed;

  with due as materialized (
    select cache.cache_key
    from public.route_cache as cache
    where cache.expires_at <= p_now
    order by cache.expires_at, cache.cache_key
    limit p_batch_limit
    for update skip locked
  ), removed as (
    delete from public.route_cache as cache
    using due
    where cache.cache_key = due.cache_key
    returning 1
  )
  select count(*)::integer into v_route_cache from removed;

  with due as materialized (
    select cache.api_kind, cache.request_hash
    from public.medication_api_cache as cache
    where cache.expires_at <= p_now
    order by cache.expires_at, cache.api_kind, cache.request_hash
    limit p_batch_limit
    for update skip locked
  ), removed as (
    delete from public.medication_api_cache as cache
    using due
    where cache.api_kind = due.api_kind
      and cache.request_hash = due.request_hash
    returning 1
  )
  select count(*)::integer into v_medication_api_cache from removed;

  with due as materialized (
    select alert.id
    from public.guardian_alerts as alert
    where alert.status in (
      'DEMO_RECORDED',
      'DELIVERED',
      'FAILED_PERMANENT',
      'SUPPRESSED'
    )
      and alert.updated_at <= p_now - interval '90 days'
      and not exists (
        select 1 from public.alert_access_tokens as token
        where token.alert_id = alert.id
      )
      and not exists (
        select 1 from public.alert_access_sessions as session
        where session.alert_id = alert.id
      )
    order by alert.updated_at, alert.id
    limit p_batch_limit
    for update skip locked
  ), removed as (
    delete from public.guardian_alerts as alert
    using due
    where alert.id = due.id
    returning 1
  )
  select count(*)::integer into v_guardian_alerts from removed;

  -- VERIFIED and FAILED attestation jobs are durable idempotency receipts.
  -- In particular, CONFIRMATION_UNCERTAIN must never become replayable after
  -- an arbitrary retention window. This counter therefore remains zero.

  with due as materialized (
    select queue.shelter_checkin_id
    from public.risk_recompute_queue as queue
    where queue.processed_at <= p_now - interval '30 days'
    order by queue.processed_at, queue.shelter_checkin_id
    limit p_batch_limit
    for update skip locked
  ), removed as (
    delete from public.risk_recompute_queue as queue
    using due
    where queue.shelter_checkin_id = due.shelter_checkin_id
    returning 1
  )
  select count(*)::integer into v_risk_recompute_queue from removed;

  return jsonb_build_object(
    'access_tokens', v_access_tokens,
    'access_sessions', v_access_sessions,
    'route_cache', v_route_cache,
    'medication_api_cache', v_medication_api_cache,
    'guardian_alerts', v_guardian_alerts,
    'attestation_jobs', v_attestation_jobs,
    'risk_recompute_queue', v_risk_recompute_queue
  );
end;
$$;

create or replace function public.claim_medication_image_purges(
  p_now timestamptz,
  p_batch_limit integer
)
returns table (
  session_id uuid,
  image_path text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_now is null or p_batch_limit is null or p_batch_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'invalid image purge claim';
  end if;

  return query
  with due as materialized (
    select scan.id
    from public.medication_scan_sessions as scan
    where scan.input_method = 'IMAGE'
      and scan.image_path is not null
      and scan.purge_after <= p_now
      and scan.image_purge_next_attempt_at <= p_now
      and (
        scan.image_purge_state in ('PENDING', 'RETRY_WAIT')
        or (
          scan.image_purge_state = 'PROCESSING'
          and scan.image_purge_claimed_at <= p_now - interval '5 minutes'
        )
      )
    order by scan.image_purge_next_attempt_at, scan.purge_after, scan.id
    limit p_batch_limit
    for update skip locked
  ), claimed as (
    update public.medication_scan_sessions as scan
    set
      image_purge_state = 'PROCESSING',
      image_purge_claimed_at = p_now,
      image_purge_attempt_count = scan.image_purge_attempt_count + 1,
      image_purge_error_code = null,
      updated_at = p_now
    from due
    where scan.id = due.id
    returning scan.id, scan.image_path, scan.image_purge_attempt_count
  )
  select claimed.id, claimed.image_path, claimed.image_purge_attempt_count
  from claimed;
end;
$$;

create or replace function public.finalize_medication_image_purge(
  p_session_id uuid,
  p_expected_image_path text,
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
  v_scan public.medication_scan_sessions%rowtype;
  v_retry_seconds integer;
begin
  if p_session_id is null
     or p_expected_image_path is null
     or length(p_expected_image_path) not between 1 and 512
     or p_deleted is null
     or p_now is null
     or (p_deleted and p_error_code is not null)
     or (
       not p_deleted
       and (p_error_code is null or p_error_code !~ '^[A-Z][A-Z0-9_]{0,63}$')
     ) then
    raise exception using errcode = '22023', message = 'invalid image purge outcome';
  end if;

  select scan.*
  into v_scan
  from public.medication_scan_sessions as scan
  where scan.id = p_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'image purge session not found';
  end if;
  if v_scan.image_path is null
     and v_scan.image_purge_state = 'PURGED'
     and p_deleted then
    return 'IDEMPOTENT';
  end if;
  if v_scan.image_purge_state <> 'PROCESSING'
     or v_scan.image_path is distinct from p_expected_image_path then
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
    where scan.id = p_session_id;
  else
    v_retry_seconds := least(21600, 60 * (2 ^ least(v_scan.image_purge_attempt_count, 8))::integer);
    update public.medication_scan_sessions as scan
    set
      image_purge_state = 'RETRY_WAIT',
      image_purge_claimed_at = null,
      image_purge_next_attempt_at = p_now + make_interval(secs => v_retry_seconds),
      image_purge_error_code = p_error_code,
      updated_at = p_now
    where scan.id = p_session_id;
  end if;
  return 'APPLIED';
end;
$$;

revoke all on function public.run_retention_cleanup(timestamptz, integer)
from public, anon, authenticated;
revoke all on function public.claim_medication_image_purges(timestamptz, integer)
from public, anon, authenticated;
revoke all on function public.finalize_medication_image_purge(uuid, text, boolean, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.run_retention_cleanup(timestamptz, integer)
to service_role;
grant execute on function public.claim_medication_image_purges(timestamptz, integer)
to service_role;
grant execute on function public.finalize_medication_image_purge(uuid, text, boolean, text, timestamptz)
to service_role;
