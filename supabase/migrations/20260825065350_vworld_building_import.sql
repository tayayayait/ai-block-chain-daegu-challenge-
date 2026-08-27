-- Resumable VWorld building import and time-aware spatial context.
-- A staged release stays inactive until every audited feature has arrived.

alter table public.spatial_data_releases
  add column expected_feature_count integer,
  add column import_completed_at timestamptz,
  add constraint spatial_data_releases_expected_feature_count_check check (
    expected_feature_count is null or expected_feature_count > 0
  );

create index building_footprints_geog_gist
  on public.building_footprints using gist ((geom::extensions.geography));

create or replace function public.begin_vworld_building_import(
  p_manifest jsonb,
  p_audit jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
  v_version text;
  v_expected_count integer;
  v_loaded_count integer;
  v_source_updated_at timestamptz;
  v_existing public.spatial_data_releases%rowtype;
begin
  if jsonb_typeof(p_manifest) <> 'object'
     or jsonb_typeof(p_audit) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid VWorld import metadata';
  end if;

  v_version := nullif(btrim(p_manifest ->> 'version'), '');
  v_expected_count := (p_manifest ->> 'expectedFeatureCount')::integer;
  v_source_updated_at := (p_manifest ->> 'datasetUpdatedAt')::timestamptz;
  if (p_manifest ->> 'schemaVersion')::integer is distinct from 1
     or p_manifest ->> 'dataset' is distinct from 'BUILDING'
     or v_version is null
     or v_version !~ '^vworld-daegu-[0-9]{8}$'
     or nullif(btrim(p_manifest ->> 'sourceName'), '') is null
     or p_manifest ->> 'sourceUrl' !~ '^https://www[.]vworld[.]kr/'
     or nullif(btrim(p_manifest ->> 'licenseCode'), '') is null
     or nullif(btrim(p_manifest ->> 'attribution'), '') is null
     or p_manifest ->> 'sourceCrs' is distinct from 'EPSG:5186'
     or p_manifest ->> 'targetCrs' is distinct from 'EPSG:4326'
     or p_manifest ->> 'coverage' is distinct from 'DAEGU_ALL'
     or p_manifest ->> 'confidence' is distinct from 'DERIVED'
     or p_manifest ->> 'featureFormat' is distinct from 'NDJSON_GZIP'
     or p_manifest #>> '{rules,directHeightField}' is distinct from 'A16'
     or p_manifest #>> '{rules,floorCountField}' is distinct from 'A26'
     or (p_manifest #>> '{rules,floorHeightM}')::numeric is distinct from 3::numeric
     or p_manifest #>> '{rules,heightEstimationVersion}' is distinct from 'vworld-a26-3m-v1'
     or v_expected_count < 1
     or v_source_updated_at is null
     or v_source_updated_at > clock_timestamp()
     or nullif(btrim(p_manifest ->> 'unknownReason'), '') is null
     or coalesce((p_audit ->> 'ok')::boolean, false) is not true
     or (p_audit ->> 'schemaVersion')::integer is distinct from 1
     or p_audit ->> 'sourceCrs' is distinct from 'EPSG:5186'
     or (p_audit ->> 'recordCount')::integer < v_expected_count
     or (p_audit ->> 'acceptedCount')::integer is distinct from v_expected_count
     or (p_audit ->> 'directHeightCount')::integer
          + (p_audit ->> 'estimatedHeightCount')::integer is distinct from v_expected_count
     or (p_audit ->> 'acceptedCount')::integer
          + (p_audit ->> 'missingHeightCount')::integer
          is distinct from (p_audit ->> 'recordCount')::integer
     or (p_audit ->> 'outsideDaeguCount')::integer <> 0
     or (p_audit ->> 'invalidGeometryCount')::integer <> 0
     or (p_audit ->> 'duplicateSourceIdCount')::integer <> 0
     or (p_audit ->> 'deletedRecordCount')::integer <> 0 then
    raise exception using errcode = '22023', message = 'VWorld manifest or audit failed validation';
  end if;

  select * into v_existing
  from public.spatial_data_releases
  where dataset = 'BUILDING'
    and version = v_version
  for update;

  if found then
    if v_existing.expected_feature_count is distinct from v_expected_count
       or v_existing.source_crs is distinct from 'EPSG:5186'
       or v_existing.source_updated_at is distinct from v_source_updated_at then
      raise exception using errcode = '23505', message = 'VWorld release version metadata mismatch';
    end if;
    select count(*)::integer into v_loaded_count
    from public.building_footprints
    where release_id = v_existing.id;
    return jsonb_build_object(
      'releaseId', v_existing.id,
      'active', v_existing.active,
      'loadedCount', v_loaded_count,
      'expectedCount', v_expected_count
    );
  end if;

  insert into public.spatial_data_releases (
    dataset,
    version,
    source_name,
    source_url,
    source_license,
    attribution,
    source_crs,
    target_crs,
    coverage,
    confidence,
    unknown_reason,
    source_updated_at,
    imported_at,
    quality_audit,
    quality_checked_at,
    expected_feature_count,
    active
  ) values (
    'BUILDING',
    v_version,
    p_manifest ->> 'sourceName',
    p_manifest ->> 'sourceUrl',
    p_manifest ->> 'licenseCode',
    p_manifest ->> 'attribution',
    'EPSG:5186',
    'EPSG:4326',
    'DAEGU_ALL',
    'DERIVED',
    p_manifest ->> 'unknownReason',
    v_source_updated_at,
    clock_timestamp(),
    p_audit,
    clock_timestamp(),
    v_expected_count,
    false
  )
  returning id into v_release_id;

  return jsonb_build_object(
    'releaseId', v_release_id,
    'active', false,
    'loadedCount', 0,
    'expectedCount', v_expected_count
  );
end;
$$;

create or replace function public.append_vworld_building_import(
  p_release_id uuid,
  p_features jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.spatial_data_releases%rowtype;
  v_feature jsonb;
  v_geometry extensions.geometry(MultiPolygon, 4326);
  v_source_feature_id text;
  v_height_m numeric;
  v_height_source text;
  v_height_is_estimated boolean;
  v_height_estimation_version text;
  v_confidence text;
  v_unknown_reason text;
  v_observed_at timestamptz;
  v_inserted_count integer := 0;
  v_row_count integer;
  v_loaded_count integer;
begin
  if p_release_id is null
     or jsonb_typeof(p_features) <> 'array'
     or jsonb_array_length(p_features) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'invalid VWorld import batch';
  end if;

  select * into v_release
  from public.spatial_data_releases
  where id = p_release_id
  for update;
  if not found
     or v_release.dataset <> 'BUILDING'
     or v_release.source_crs <> 'EPSG:5186'
     or v_release.active
     or v_release.expected_feature_count is null then
    raise exception using errcode = '22023', message = 'VWorld release is not open for import';
  end if;

  for v_feature in
    select feature
    from jsonb_array_elements(p_features) as imported(feature)
  loop
    if jsonb_typeof(v_feature) <> 'object'
       or jsonb_typeof(v_feature -> 'geometry') <> 'object'
       or jsonb_typeof(v_feature -> 'heightIsEstimated') <> 'boolean'
       or v_feature ->> 'coverage' is distinct from 'DAEGU_ALL' then
      raise exception using errcode = '22023', message = 'invalid VWorld building feature';
    end if;
    v_source_feature_id := nullif(btrim(v_feature ->> 'sourceFeatureId'), '');
    v_height_m := (v_feature ->> 'heightM')::numeric;
    v_height_source := nullif(btrim(v_feature ->> 'heightSource'), '');
    v_height_is_estimated := (v_feature ->> 'heightIsEstimated')::boolean;
    v_height_estimation_version := nullif(
      btrim(v_feature ->> 'heightEstimationVersion'),
      ''
    );
    v_confidence := v_feature ->> 'confidence';
    v_unknown_reason := nullif(btrim(v_feature ->> 'unknownReason'), '');
    v_observed_at := (v_feature ->> 'observedAt')::timestamptz;

    if v_source_feature_id is null
       or length(v_source_feature_id) > 500
       or v_height_m <= 0
       or v_height_m > 300
       or v_observed_at is null
       or v_observed_at > clock_timestamp()
       or (
         not v_height_is_estimated
         and (
           v_height_source <> 'VWORLD_GIS_BUILDING_A16'
           or v_height_m > 200
           or v_height_estimation_version is not null
           or v_confidence <> 'VERIFIED_SOURCE'
           or v_unknown_reason is not null
         )
       )
       or (
         v_height_is_estimated
         and (
           v_height_source <> 'DERIVED_A26_GROUND_FLOORS'
           or v_height_estimation_version <> 'vworld-a26-3m-v1'
           or v_confidence <> 'DERIVED'
           or v_unknown_reason is null
           or mod(v_height_m, 3) <> 0
         )
       ) then
      raise exception using errcode = '22023', message = 'invalid VWorld height provenance';
    end if;

    begin
      v_geometry := extensions.st_multi(
        extensions.st_setsrid(
          extensions.st_geomfromgeojson((v_feature -> 'geometry')::text),
          4326
        )
      )::extensions.geometry(MultiPolygon, 4326);
    exception when others then
      raise exception using errcode = '22023', message = 'invalid VWorld building geometry';
    end;
    if not extensions.st_isvalid(v_geometry) then
      begin
        v_geometry := extensions.st_multi(
          extensions.st_collectionextract(extensions.st_makevalid(v_geometry), 3)
        )::extensions.geometry(MultiPolygon, 4326);
      exception when others then
        raise exception using errcode = '22023', message = 'invalid VWorld building geometry';
      end;
    end if;
    if not extensions.st_isvalid(v_geometry)
       or extensions.st_isempty(v_geometry)
       or not extensions.st_coveredby(
         v_geometry,
         extensions.st_makeenvelope(128.30, 35.55, 128.95, 36.40, 4326)
       ) then
      raise exception using errcode = '22023', message = 'VWorld building outside Daegu extent';
    end if;

    insert into public.building_footprints (
      release_id,
      source_feature_id,
      geom,
      height_m,
      height_source,
      height_is_estimated,
      height_estimation_version,
      source_crs,
      target_crs,
      coverage,
      confidence,
      unknown_reason,
      observed_at,
      source_updated_at
    ) values (
      v_release.id,
      v_source_feature_id,
      v_geometry,
      v_height_m,
      v_height_source,
      v_height_is_estimated,
      v_height_estimation_version,
      'EPSG:5186',
      'EPSG:4326',
      'DAEGU_ALL',
      v_confidence,
      coalesce(v_unknown_reason, v_release.unknown_reason),
      v_observed_at,
      v_release.source_updated_at
    )
    on conflict (release_id, source_feature_id) do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted_count := v_inserted_count + v_row_count;
  end loop;

  select count(*)::integer into v_loaded_count
  from public.building_footprints
  where release_id = v_release.id;
  if v_loaded_count > v_release.expected_feature_count then
    raise exception using errcode = '23514', message = 'VWorld imported count exceeds audit';
  end if;
  return jsonb_build_object(
    'releaseId', v_release.id,
    'insertedCount', v_inserted_count,
    'loadedCount', v_loaded_count,
    'expectedCount', v_release.expected_feature_count
  );
end;
$$;

create or replace function public.finalize_vworld_building_import(
  p_release_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.spatial_data_releases%rowtype;
  v_loaded_count integer;
  v_expected_count integer;
  v_direct_count integer;
  v_estimated_count integer;
begin
  select * into v_release
  from public.spatial_data_releases
  where id = p_release_id
  for update;
  if not found
     or v_release.dataset <> 'BUILDING'
     or v_release.source_crs <> 'EPSG:5186'
     or v_release.expected_feature_count is null then
    raise exception using errcode = '22023', message = 'invalid VWorld release';
  end if;
  v_expected_count := v_release.expected_feature_count;
  select
    count(*)::integer,
    count(*) filter (where not height_is_estimated)::integer,
    count(*) filter (where height_is_estimated)::integer
  into v_loaded_count, v_direct_count, v_estimated_count
  from public.building_footprints
  where release_id = v_release.id;

  if v_loaded_count is distinct from v_expected_count
     or v_direct_count is distinct from (v_release.quality_audit ->> 'directHeightCount')::integer
     or v_estimated_count
          is distinct from (v_release.quality_audit ->> 'estimatedHeightCount')::integer then
    raise exception using errcode = '23514', message = 'VWorld release is incomplete';
  end if;
  if v_release.active then
    return jsonb_build_object(
      'releaseId', v_release.id,
      'active', true,
      'featureCount', v_loaded_count
    );
  end if;

  update public.spatial_data_releases
  set active = false,
      activated_at = null
  where dataset = 'BUILDING'
    and active;
  update public.spatial_data_releases
  set active = true,
      activated_at = clock_timestamp(),
      import_completed_at = clock_timestamp()
  where id = v_release.id;

  return jsonb_build_object(
    'releaseId', v_release.id,
    'active', true,
    'featureCount', v_loaded_count
  );
end;
$$;

create or replace function public.route_spatial_context_at_time(
  p_route extensions.geometry,
  p_buffer_m integer,
  p_shadow_factor double precision,
  p_max_shadow_m integer
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
     or p_buffer_m not between 1 and 100
     or p_shadow_factor < 0
     or p_shadow_factor > 100
     or p_max_shadow_m not between 30 and 500 then
    raise exception using errcode = '22023', message = 'invalid time-aware spatial request';
  end if;

  return jsonb_build_object(
    'buildings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', selected.id,
        'heightM', selected.height_m,
        'heightSource', selected.height_source,
        'heightIsEstimated', selected.height_is_estimated,
        'geometry', extensions.st_asgeojson(selected.geom)::jsonb,
        'confidence', selected.confidence,
        'coverage', selected.coverage,
        'unknownReason', selected.unknown_reason
      ) order by selected.id)
      from (
        select b.*
        from public.building_footprints b
        join public.spatial_data_releases r
          on r.id = b.release_id
         and r.active
        where extensions.st_dwithin(
                b.geom::extensions.geography,
                p_route::extensions.geography,
                p_max_shadow_m
              )
          and extensions.st_dwithin(
                b.geom::extensions.geography,
                p_route::extensions.geography,
                least(
                  p_max_shadow_m::double precision,
                  greatest(
                    p_buffer_m::double precision,
                    b.height_m::double precision * p_shadow_factor
                  )
                )
              )
        order by b.id
        limit 5000
      ) selected
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

revoke all on function public.begin_vworld_building_import(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.append_vworld_building_import(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_vworld_building_import(uuid)
  from public, anon, authenticated;
revoke all on function public.route_spatial_context_at_time(
  extensions.geometry, integer, double precision, integer
) from public, anon, authenticated;

grant execute on function public.begin_vworld_building_import(jsonb, jsonb)
  to service_role;
grant execute on function public.append_vworld_building_import(uuid, jsonb)
  to service_role;
grant execute on function public.finalize_vworld_building_import(uuid)
  to service_role;
grant execute on function public.route_spatial_context_at_time(
  extensions.geometry, integer, double precision, integer
) to service_role;
