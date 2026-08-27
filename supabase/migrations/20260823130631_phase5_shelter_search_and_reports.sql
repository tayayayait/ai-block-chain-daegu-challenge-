-- Phase 5: server-only public shelter DTO query and atomic anonymous status reports.
-- No raw cookie, IP address, or reporter identifier is stored; reporter_hash is
-- an HMAC-SHA-256 value calculated by the application server.

drop policy if exists shelters_public_read on public.shelters;
revoke all on table public.shelters from anon, authenticated;
revoke all on table public.shelter_reports from anon, authenticated;

create index if not exists shelter_reports_reporter_time_idx
  on public.shelter_reports (reporter_hash, created_at desc);

create or replace function public.search_shelters(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer,
  p_gu text,
  p_im_bank_only boolean,
  p_open_state text,
  p_sort text,
  p_limit integer
)
returns table (
  shelter_id text,
  shelter_name text,
  facility_type text,
  gu text,
  is_im_bank boolean,
  road_address text,
  latitude double precision,
  longitude double precision,
  distance_m double precision,
  walk_minutes integer,
  operating_state text,
  crowd_level smallint,
  report_observed_at timestamptz,
  attestation_state public.attestation_state,
  attestation_uid text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_origin extensions.geography(Point, 4326);
begin
  if p_lat is null or not p_lat between -90 and 90
    or p_lng is null or not p_lng between -180 and 180 then
    raise exception using errcode = '22023', message = 'invalid WGS84 coordinate';
  end if;

  if p_radius_m is null or p_radius_m not in (500, 1000, 3000, 30000) then
    raise exception using errcode = '22023', message = 'invalid shelter radius';
  end if;

  if p_limit is null or p_limit < 1 then
    raise exception using errcode = '22023', message = 'invalid shelter result limit';
  end if;

  if p_gu is not null and p_gu not in (
    '중구', '동구', '서구', '남구', '북구', '수성구', '달서구', '달성군'
  ) then
    raise exception using errcode = '22023', message = 'invalid shelter district';
  end if;

  if p_im_bank_only is null
    or p_open_state is null
    or p_open_state not in ('ALL', 'OPEN', 'CLOSED', 'UNKNOWN')
    or p_sort is null
    or p_sort not in ('priority', 'distance') then
    raise exception using errcode = '22023', message = 'invalid shelter filter';
  end if;

  v_origin := extensions.st_setsrid(
    extensions.st_makepoint(p_lng, p_lat),
    4326
  )::extensions.geography;

  return query
  with nearby as (
    select
      shelter.id,
      shelter.name,
      shelter.facility_type,
      shelter.gu,
      shelter.is_im_bank,
      shelter.road_address,
      extensions.st_y(shelter.location::extensions.geometry) as latitude,
      extensions.st_x(shelter.location::extensions.geometry) as longitude,
      extensions.st_distance(shelter.location, v_origin) as distance_m
    from public.shelters as shelter
    where extensions.st_dwithin(shelter.location, v_origin, p_radius_m)
      and (p_gu is null or shelter.gu = p_gu)
      and (not p_im_bank_only or shelter.is_im_bank)
  ),
  latest as (
    select
      nearby.*,
      report.is_open,
      report.crowd_level as latest_crowd_level,
      report.observed_at,
      report.attestation_state as latest_attestation_state,
      report.attestation_uid as latest_attestation_uid
    from nearby
    left join lateral (
      select
        shelter_report.is_open,
        shelter_report.crowd_level,
        shelter_report.observed_at,
        shelter_report.attestation_state,
        shelter_report.attestation_uid
      from public.shelter_reports as shelter_report
      where shelter_report.shelter_id = nearby.id
      order by shelter_report.observed_at desc, shelter_report.created_at desc, shelter_report.id desc
      limit 1
    ) as report on true
  ),
  effective as (
    select
      latest.*,
      case
        when latest.observed_at is null
          or latest.observed_at < statement_timestamp() - interval '2 hours'
          then 'UNKNOWN'
        when latest.is_open then 'OPEN'
        else 'CLOSED'
      end as effective_open_state,
      case
        when latest.observed_at is null
          or latest.observed_at < statement_timestamp() - interval '2 hours'
          then null::smallint
        else latest.latest_crowd_level
      end as effective_crowd_level
    from latest
  ),
  ranked as (
    select
      effective.*,
      case
        when effective.effective_open_state = 'OPEN'
          and effective.latest_attestation_state = 'VERIFIED'
          and effective.distance_m <= 500
          then 0
        else 1
      end as priority_rank
    from effective
    where p_open_state = 'ALL' or effective.effective_open_state = p_open_state
  )
  select
    ranked.id,
    ranked.name,
    ranked.facility_type,
    ranked.gu,
    ranked.is_im_bank,
    ranked.road_address,
    ranked.latitude,
    ranked.longitude,
    ranked.distance_m,
    ceil(ranked.distance_m / 0.75 / 60.0)::integer,
    ranked.effective_open_state,
    ranked.effective_crowd_level,
    ranked.observed_at,
    ranked.latest_attestation_state,
    ranked.latest_attestation_uid
  from ranked
  order by
    case when p_sort = 'priority' then ranked.priority_rank else 0 end,
    ranked.distance_m,
    ranked.id
  limit least(p_limit, 100);
end;
$$;

revoke all on function public.search_shelters(
  double precision,
  double precision,
  integer,
  text,
  boolean,
  text,
  text,
  integer
) from public, anon, authenticated;
grant execute on function public.search_shelters(
  double precision,
  double precision,
  integer,
  text,
  boolean,
  text,
  text,
  integer
) to service_role;

create or replace function public.get_shelter_by_id(p_shelter_id text)
returns table (
  shelter_id text,
  shelter_name text,
  facility_type text,
  gu text,
  is_im_bank boolean,
  road_address text,
  latitude double precision,
  longitude double precision
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    shelter.id,
    shelter.name,
    shelter.facility_type,
    shelter.gu,
    shelter.is_im_bank,
    shelter.road_address,
    extensions.st_y(shelter.location::extensions.geometry),
    extensions.st_x(shelter.location::extensions.geometry)
  from public.shelters as shelter
  where shelter.id = p_shelter_id
  limit 1
$$;

revoke all on function public.get_shelter_by_id(text)
from public, anon, authenticated;
grant execute on function public.get_shelter_by_id(text)
to service_role;

create or replace function public.submit_shelter_report(
  p_shelter_id text,
  p_is_open boolean,
  p_crowd_level smallint,
  p_reporter_hash text,
  p_client_request_id uuid
)
returns table (
  outcome text,
  report_id uuid,
  retry_after timestamptz,
  attestation_state public.attestation_state,
  attestation_job_state public.attestation_job_state
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_report_id uuid;
  v_retry_after timestamptz;
  v_recent_count integer;
  v_existing public.shelter_reports%rowtype;
  v_existing_job_state public.attestation_job_state;
begin
  if p_reporter_hash is null or p_reporter_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid reporter reference';
  end if;

  if p_shelter_id is null or p_shelter_id !~ '^DG-[0-9]{4}$'
    or p_is_open is null
    or p_client_request_id is null
    or (p_crowd_level is not null and p_crowd_level not between 0 and 2) then
    raise exception using errcode = '22023', message = 'invalid shelter report';
  end if;

  -- One reporter's duplicate/rate checks and insert share a transaction-scoped lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_reporter_hash, 0)
  );

  select shelter_report.*
  into v_existing
  from public.shelter_reports as shelter_report
  where shelter_report.client_request_id = p_client_request_id;

  if found then
    if v_existing.reporter_hash <> p_reporter_hash
      or v_existing.shelter_id <> p_shelter_id
      or v_existing.is_open <> p_is_open
      or v_existing.crowd_level is distinct from p_crowd_level then
      raise exception using errcode = '23505', message = 'client request id already used';
    end if;

    select job.state
    into v_existing_job_state
    from public.attestation_jobs as job
    where job.shelter_report_id = v_existing.id
    order by job.created_at desc
    limit 1;

    return query select
      'IDEMPOTENT'::text,
      v_existing.id,
      null::timestamptz,
      v_existing.attestation_state,
      coalesce(v_existing_job_state, 'PENDING'::public.attestation_job_state);
    return;
  end if;

  if not exists (select 1 from public.shelters where id = p_shelter_id) then
    raise exception using errcode = '23503', message = 'shelter not found';
  end if;

  select max(shelter_report.created_at) + interval '10 minutes'
  into v_retry_after
  from public.shelter_reports as shelter_report
  where shelter_report.reporter_hash = p_reporter_hash
    and shelter_report.shelter_id = p_shelter_id
    and shelter_report.created_at > v_now - interval '10 minutes';

  if v_retry_after is not null then
    return query select
      'DUPLICATE'::text,
      null::uuid,
      v_retry_after,
      'UNVERIFIED'::public.attestation_state,
      'PENDING'::public.attestation_job_state;
    return;
  end if;

  select
    count(*)::integer,
    min(shelter_report.created_at) + interval '10 minutes'
  into v_recent_count, v_retry_after
  from public.shelter_reports as shelter_report
  where shelter_report.reporter_hash = p_reporter_hash
    and shelter_report.created_at > v_now - interval '10 minutes';

  if v_recent_count >= 5 then
    return query select
      'RATE_LIMITED'::text,
      null::uuid,
      v_retry_after,
      'UNVERIFIED'::public.attestation_state,
      'PENDING'::public.attestation_job_state;
    return;
  end if;

  insert into public.shelter_reports (
    shelter_id,
    is_open,
    crowd_level,
    observed_at,
    reporter_hash,
    client_request_id,
    attestation_state
  )
  values (
    p_shelter_id,
    p_is_open,
    p_crowd_level,
    v_now,
    p_reporter_hash,
    p_client_request_id,
    'UNVERIFIED'
  )
  returning id into v_report_id;

  insert into public.attestation_jobs (
    shelter_report_id,
    state,
    error_code,
    idempotency_key
  )
  values (
    v_report_id,
    case when p_crowd_level is null then 'FAILED' else 'PENDING' end,
    case when p_crowd_level is null then 'CROWD_NOT_PROVIDED' else null end,
    'shelter-report:' || v_report_id::text
  );

  return query select
    'ACCEPTED'::text,
    v_report_id,
    null::timestamptz,
    'UNVERIFIED'::public.attestation_state,
    case
      when p_crowd_level is null then 'FAILED'::public.attestation_job_state
      else 'PENDING'::public.attestation_job_state
    end;
end;
$$;

revoke all on function public.submit_shelter_report(
  text,
  boolean,
  smallint,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.submit_shelter_report(
  text,
  boolean,
  smallint,
  text,
  uuid
) to service_role;
