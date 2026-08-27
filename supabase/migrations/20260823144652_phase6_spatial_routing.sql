-- Phase 6: provenance-bound spatial evidence, route cache, and verified check-in staging.
-- Spatial evidence remains server-only because coverage is incomplete and must never be
-- presented as a guarantee of an obstacle-free route.

create table public.spatial_data_releases (
  id uuid primary key default gen_random_uuid(),
  dataset text not null check (dataset in ('BUILDING', 'REST_SPOT', 'BARRIER')),
  version text not null,
  source_name text not null,
  source_url text not null check (source_url ~ '^https://'),
  source_license text not null,
  source_crs text not null,
  target_crs text not null default 'EPSG:4326' check (target_crs = 'EPSG:4326'),
  coverage text not null check (
    coverage in ('DAEGU_ALL', 'PARK_ONLY', 'DISTRICT_ONLY', 'COMMUNITY_PARTIAL')
  ),
  confidence text not null check (
    confidence in ('VERIFIED_SOURCE', 'DERIVED', 'COMMUNITY', 'UNKNOWN')
  ),
  unknown_reason text,
  source_updated_at timestamptz,
  imported_at timestamptz not null default now(),
  active boolean not null default false,
  unique (dataset, version),
  check (
    (coverage <> 'COMMUNITY_PARTIAL' and confidence <> 'UNKNOWN')
    or nullif(btrim(unknown_reason), '') is not null
  )
);

create unique index spatial_data_releases_one_active_idx
  on public.spatial_data_releases (dataset)
  where active;

create table public.building_footprints (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.spatial_data_releases (id) on delete restrict,
  source_feature_id text not null,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  height_m numeric(8, 2) not null check (height_m > 0 and height_m <= 1000),
  height_source text not null,
  height_is_estimated boolean not null default false,
  height_estimation_version text,
  source_crs text not null,
  target_crs text not null default 'EPSG:4326' check (target_crs = 'EPSG:4326'),
  coverage text not null,
  confidence text not null,
  unknown_reason text,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (release_id, source_feature_id),
  check (extensions.st_srid(geom) = 4326),
  check (extensions.st_isvalid(geom) and not extensions.st_isempty(geom)),
  check (
    (height_is_estimated and nullif(btrim(height_estimation_version), '') is not null)
    or (not height_is_estimated and height_estimation_version is null)
  )
);

create table public.rest_spots (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.spatial_data_releases (id) on delete restrict,
  source_feature_id text not null,
  rest_type text not null check (rest_type in ('BENCH', 'PAVILION', 'SHADE_CANOPY', 'PARK_FACILITY')),
  geom extensions.geometry(Point, 4326) not null,
  source_crs text not null,
  target_crs text not null default 'EPSG:4326' check (target_crs = 'EPSG:4326'),
  coverage text not null,
  confidence text not null,
  unknown_reason text,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (release_id, source_feature_id),
  check (extensions.st_srid(geom) = 4326),
  check (extensions.st_isvalid(geom) and not extensions.st_isempty(geom))
);

create table public.barrier_segments (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references public.spatial_data_releases (id) on delete restrict,
  source_feature_id text not null,
  barrier_type text not null check (barrier_type in ('STAIRS', 'STEEP_SLOPE')),
  slope_percent numeric(7, 3),
  geom extensions.geometry(Geometry, 4326) not null,
  source_crs text not null,
  target_crs text not null default 'EPSG:4326' check (target_crs = 'EPSG:4326'),
  coverage text not null,
  confidence text not null,
  unknown_reason text,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (release_id, source_feature_id),
  check (extensions.st_srid(geom) = 4326),
  check (extensions.st_isvalid(geom) and not extensions.st_isempty(geom)),
  check (
    extensions.st_geometrytype(geom) in (
      'ST_LineString', 'ST_MultiLineString', 'ST_Polygon', 'ST_MultiPolygon'
    )
  ),
  check (
    (barrier_type = 'STAIRS' and slope_percent is null)
    or (barrier_type = 'STEEP_SLOPE' and slope_percent > 5)
  )
);

create index building_footprints_geom_gist
  on public.building_footprints using gist (geom);
create index rest_spots_geom_gist
  on public.rest_spots using gist (geom);
create index barrier_segments_geom_gist
  on public.barrier_segments using gist (geom);

create table public.route_cache (
  cache_key text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  destination_shelter_id text not null references public.shelters (id) on delete cascade,
  spatial_version text not null,
  solar_bucket timestamptz not null,
  route_result jsonb not null check (jsonb_typeof(route_result) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index route_cache_expiry_idx on public.route_cache (expires_at);

alter table public.shelter_checkins
  add column client_request_id uuid unique,
  add column attestation_verified_at timestamptz,
  add constraint shelter_checkins_verified_time_check check (
    (
      attestation_state = 'VERIFIED'
      and attestation_uid is not null
      and attestation_verified_at is not null
    )
    or (
      attestation_state <> 'VERIFIED'
      and attestation_verified_at is null
    )
  );

alter table public.spatial_data_releases enable row level security;
alter table public.spatial_data_releases force row level security;
alter table public.building_footprints enable row level security;
alter table public.building_footprints force row level security;
alter table public.rest_spots enable row level security;
alter table public.rest_spots force row level security;
alter table public.barrier_segments enable row level security;
alter table public.barrier_segments force row level security;
alter table public.route_cache enable row level security;
alter table public.route_cache force row level security;

revoke all on table public.spatial_data_releases from public, anon, authenticated;
revoke all on table public.building_footprints from public, anon, authenticated;
revoke all on table public.rest_spots from public, anon, authenticated;
revoke all on table public.barrier_segments from public, anon, authenticated;
revoke all on table public.route_cache from public, anon, authenticated;

grant select, insert, update, delete on table public.spatial_data_releases to service_role;
grant select, insert, update, delete on table public.building_footprints to service_role;
grant select, insert, update, delete on table public.rest_spots to service_role;
grant select, insert, update, delete on table public.barrier_segments to service_role;
grant select, insert, update, delete on table public.route_cache to service_role;

create or replace function public.validate_phase6_spatial_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  invalid_count bigint;
begin
  select count(*) into invalid_count
  from public.building_footprints
  where height_m <= 0
     or not extensions.st_isvalid(geom)
     or extensions.st_isempty(geom);

  if invalid_count > 0 then
    raise exception using errcode = '23514', message = 'invalid Phase 6 building rows';
  end if;

  select jsonb_build_object(
    'buildingCount', (select count(*) from public.building_footprints),
    'restSpotCount', (select count(*) from public.rest_spots),
    'barrierCount', (select count(*) from public.barrier_segments),
    'activeReleaseCount', (select count(*) from public.spatial_data_releases where active)
  ) into result;
  return result;
end;
$$;

create or replace function public.route_spatial_context(
  p_route extensions.geometry,
  p_buffer_m integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_route is null
     or extensions.st_srid(p_route) <> 4326
     or extensions.st_geometrytype(p_route) <> 'ST_LineString'
     or p_buffer_m < 1
     or p_buffer_m > 100 then
    raise exception using errcode = '22023', message = 'invalid route spatial request';
  end if;

  return jsonb_build_object(
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'heightM', b.height_m,
        'heightSource', b.height_source,
        'heightIsEstimated', b.height_is_estimated,
        'geometry', extensions.st_asgeojson(b.geom)::jsonb,
        'confidence', b.confidence,
        'coverage', b.coverage,
        'unknownReason', b.unknown_reason
      ) order by b.id)
      from public.building_footprints b
      join public.spatial_data_releases r on r.id = b.release_id and r.active
      where extensions.st_dwithin(
        b.geom::extensions.geography,
        p_route::extensions.geography,
        p_buffer_m
      )
    ), '[]'::jsonb),
    'restSpots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'type', s.rest_type,
        'geometry', extensions.st_asgeojson(s.geom)::jsonb,
        'confidence', s.confidence,
        'coverage', s.coverage,
        'unknownReason', s.unknown_reason
      ) order by s.id)
      from public.rest_spots s
      join public.spatial_data_releases r on r.id = s.release_id and r.active
      where extensions.st_dwithin(
        s.geom::extensions.geography,
        p_route::extensions.geography,
        p_buffer_m
      )
    ), '[]'::jsonb),
    'barriers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id,
        'type', x.barrier_type,
        'slopePercent', x.slope_percent,
        'geometry', extensions.st_asgeojson(x.geom)::jsonb,
        'confidence', x.confidence,
        'coverage', x.coverage,
        'unknownReason', x.unknown_reason
      ) order by x.id)
      from public.barrier_segments x
      join public.spatial_data_releases r on r.id = x.release_id and r.active
      where extensions.st_intersects(x.geom, p_route)
         or extensions.st_dwithin(
           x.geom::extensions.geography,
           p_route::extensions.geography,
           p_buffer_m
         )
    ), '[]'::jsonb),
    'spatialVersion', coalesce((
      select string_agg(dataset || ':' || version, '|' order by dataset)
      from public.spatial_data_releases
      where active
    ), 'NO_ACTIVE_RELEASE')
  );
end;
$$;

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

  insert into public.attestation_jobs (
    shelter_checkin_id,
    state,
    idempotency_key
  ) values (
    stored.id,
    'PENDING',
    'shelter-checkin:' || stored.id::text
  ) on conflict (idempotency_key) do nothing;

  return query
  select
    stored.id,
    stored.attestation_state,
    coalesce((
      select j.state
      from public.attestation_jobs j
      where j.shelter_checkin_id = stored.id
      order by j.created_at desc
      limit 1
    ), 'PENDING'::public.attestation_job_state);
end;
$$;

revoke all on function public.validate_phase6_spatial_data() from public, anon, authenticated;
revoke all on function public.route_spatial_context(extensions.geometry, integer)
  from public, anon, authenticated;
revoke all on function public.create_pending_shelter_checkin(
  uuid, text, timestamptz, public.checkin_actor_scope, text, uuid
) from public, anon, authenticated;

grant execute on function public.validate_phase6_spatial_data() to service_role;
grant execute on function public.route_spatial_context(extensions.geometry, integer)
  to service_role;
grant execute on function public.create_pending_shelter_checkin(
  uuid, text, timestamptz, public.checkin_actor_scope, text, uuid
) to service_role;
