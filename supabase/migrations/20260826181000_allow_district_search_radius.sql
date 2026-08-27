-- Allow 30000m radius for district-wide shelter search when querying by district from Daegu center
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
