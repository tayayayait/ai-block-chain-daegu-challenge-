-- Phase 6 spatial ETL: immutable inactive releases are validated inside one RPC
-- transaction and become active only after every feature passes DB-side checks.

alter table public.spatial_data_releases
  add column attribution text not null default 'UNSPECIFIED_LEGACY',
  add column coverage_geom extensions.geometry(MultiPolygon, 4326),
  add column quality_audit jsonb not null default '{}'::jsonb,
  add column quality_checked_at timestamptz,
  add column activated_at timestamptz,
  add constraint spatial_data_releases_quality_audit_check check (
    jsonb_typeof(quality_audit) = 'object'
  ),
  add constraint spatial_data_releases_coverage_geom_check check (
    coverage_geom is null
    or (
      extensions.st_srid(coverage_geom) = 4326
      and extensions.st_isvalid(coverage_geom)
      and not extensions.st_isempty(coverage_geom)
    )
  );

alter table public.building_footprints
  add column observed_at timestamptz;

alter table public.rest_spots
  add column observed_at timestamptz;

alter table public.barrier_segments
  add column observed_at timestamptz,
  add column slope_source text,
  add constraint barrier_segments_slope_source_check check (
    (barrier_type = 'STAIRS' and slope_source is null)
    or (
      barrier_type = 'STEEP_SLOPE'
      and slope_percent > 5
      and nullif(btrim(slope_source), '') is not null
    )
  );

create or replace function public.import_phase6_spatial_release(
  p_manifest jsonb,
  p_features jsonb,
  p_audit jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
  v_dataset text;
  v_version text;
  v_source_name text;
  v_source_url text;
  v_license_code text;
  v_attribution text;
  v_source_crs text;
  v_source_updated_at timestamptz;
  v_audited_at timestamptz;
  v_coverage text;
  v_confidence text;
  v_unknown_reason text;
  v_coverage_geom extensions.geometry(MultiPolygon, 4326);
  v_daegu_extent extensions.geometry(Polygon, 4326);
  v_feature jsonb;
  v_geometry extensions.geometry(Geometry, 4326);
  v_feature_count integer;
  v_distinct_feature_count integer;
  v_distinct_content_count integer;
  v_inserted_count integer;
  v_max_age_days integer;
  v_max_duplicate_rate numeric;
  v_duplicate_rate numeric;
  v_calculated_duplicate_rate numeric;
  v_height_m numeric;
  v_height_is_estimated boolean;
  v_height_estimation_version text;
  v_barrier_type text;
  v_slope_percent numeric;
  v_slope_source text;
begin
  if jsonb_typeof(p_manifest) <> 'object'
     or jsonb_typeof(p_features) <> 'array'
     or jsonb_typeof(p_audit) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid spatial import payload';
  end if;

  v_dataset := p_manifest ->> 'dataset';
  v_version := nullif(btrim(p_manifest ->> 'version'), '');
  v_source_name := nullif(btrim(p_manifest ->> 'sourceName'), '');
  v_source_url := nullif(btrim(p_manifest ->> 'sourceUrl'), '');
  v_license_code := nullif(btrim(p_manifest ->> 'licenseCode'), '');
  v_attribution := nullif(btrim(p_manifest ->> 'attribution'), '');
  v_source_crs := nullif(btrim(p_manifest ->> 'sourceCrs'), '');
  v_source_updated_at := (p_manifest ->> 'datasetUpdatedAt')::timestamptz;
  v_coverage := p_manifest ->> 'coverage';
  v_confidence := p_manifest ->> 'confidence';
  v_unknown_reason := nullif(btrim(p_manifest ->> 'unknownReason'), '');
  v_audited_at := (p_audit ->> 'auditedAt')::timestamptz;
  v_max_age_days := (p_manifest #>> '{quality,maxDatasetAgeDays}')::integer;
  v_max_duplicate_rate := (p_manifest #>> '{quality,maxDuplicateRate}')::numeric;
  v_duplicate_rate := (p_audit ->> 'duplicateRate')::numeric;

  if (p_manifest ->> 'schemaVersion')::integer is distinct from 1
     or (p_audit ->> 'schemaVersion')::integer is distinct from 1
     or v_dataset is null
     or v_dataset not in ('BUILDING', 'REST_SPOT', 'BARRIER')
     or v_version is null
     or v_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
     or v_source_name is null
     or v_source_url is null
     or v_source_url !~ '^https://'
     or v_license_code is null
     or v_attribution is null
     or v_source_crs is null
     or v_source_crs not in ('EPSG:4326', 'EPSG:5187')
     or p_manifest ->> 'targetCrs' is distinct from 'EPSG:4326'
     or p_manifest ->> 'coverageCrs' is distinct from 'EPSG:4326'
     or p_manifest #>> '{rules,kind}' is distinct from v_dataset
     or v_coverage is null
     or v_coverage not in ('DAEGU_ALL', 'PARK_ONLY', 'DISTRICT_ONLY', 'COMMUNITY_PARTIAL')
     or v_confidence is null
     or v_confidence not in ('VERIFIED_SOURCE', 'DERIVED', 'COMMUNITY', 'UNKNOWN')
     or v_source_updated_at is null
     or v_audited_at is null
     or v_source_updated_at > v_audited_at
     or v_max_age_days is null
     or v_max_age_days not between 1 and 3650
     or v_audited_at - v_source_updated_at > make_interval(days => v_max_age_days)
     or v_max_duplicate_rate is null
     or v_max_duplicate_rate < 0
     or v_max_duplicate_rate > 0.1
     or v_duplicate_rate is null
     or v_duplicate_rate < 0
     or v_duplicate_rate > v_max_duplicate_rate
     or coalesce((p_audit ->> 'ok')::boolean, false) is not true
     or jsonb_typeof(p_audit -> 'issues') is distinct from 'array'
     or jsonb_array_length(p_audit -> 'issues') <> 0
     or exists (
       select 1
       from jsonb_object_keys(p_audit) as audit_key(name)
       where audit_key.name not in (
         'schemaVersion',
         'ok',
         'auditedAt',
         'dataset',
         'version',
         'featureCount',
         'acceptedCount',
         'duplicateRate',
         'issues'
       )
     )
     or p_audit ->> 'dataset' is distinct from v_dataset
     or p_audit ->> 'version' is distinct from v_version then
    raise exception using errcode = '22023', message = 'invalid spatial import manifest or audit';
  end if;

  if (v_coverage = 'COMMUNITY_PARTIAL' or v_confidence = 'UNKNOWN')
     and v_unknown_reason is null then
    raise exception using errcode = '22023', message = 'partial spatial evidence requires an unknown reason';
  end if;

  begin
    v_coverage_geom := extensions.st_multi(
      extensions.st_setsrid(
        extensions.st_geomfromgeojson((p_manifest -> 'coverageGeometry')::text),
        4326
      )
    )::extensions.geometry(MultiPolygon, 4326);
  exception when others then
    raise exception using errcode = '22023', message = 'invalid spatial coverage geometry';
  end;

  v_daegu_extent := extensions.st_makeenvelope(
    128.33,
    35.58,
    128.78,
    36.02,
    4326
  )::extensions.geometry(Polygon, 4326);

  if not extensions.st_isvalid(v_coverage_geom)
     or extensions.st_isempty(v_coverage_geom)
     or not extensions.st_coveredby(v_coverage_geom, v_daegu_extent) then
    raise exception using errcode = '22023', message = 'coverage must be valid and inside Daegu';
  end if;

  select
    count(*)::integer,
    count(distinct feature ->> 'sourceFeatureId')::integer,
    count(
      distinct (
        feature
        - 'sourceFeatureId'
        - 'observedAt'
        - 'unknownReason'
      )::text
    )::integer
  into v_feature_count, v_distinct_feature_count, v_distinct_content_count
  from jsonb_array_elements(p_features) as imported(feature);

  v_calculated_duplicate_rate :=
    (v_feature_count - v_distinct_content_count)::numeric / nullif(v_feature_count, 0);

  if v_feature_count < 1
     or v_feature_count <> v_distinct_feature_count
     or v_calculated_duplicate_rate > v_duplicate_rate
     or v_calculated_duplicate_rate > v_max_duplicate_rate
     or (p_audit ->> 'featureCount')::integer is distinct from v_feature_count
     or (p_audit ->> 'acceptedCount')::integer is distinct from v_feature_count then
    raise exception using errcode = '22023', message = 'invalid spatial feature count or duplicate source ID';
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
    coverage_geom,
    confidence,
    unknown_reason,
    source_updated_at,
    imported_at,
    quality_audit,
    quality_checked_at,
    active
  ) values (
    v_dataset,
    v_version,
    v_source_name,
    v_source_url,
    v_license_code,
    v_attribution,
    v_source_crs,
    'EPSG:4326',
    v_coverage,
    v_coverage_geom,
    v_confidence,
    v_unknown_reason,
    v_source_updated_at,
    clock_timestamp(),
    p_audit,
    v_audited_at,
    false
  )
  returning id into v_release_id;

  for v_feature in
    select feature
    from jsonb_array_elements(p_features) as imported(feature)
  loop
    if jsonb_typeof(v_feature) <> 'object'
       or nullif(btrim(v_feature ->> 'sourceFeatureId'), '') is null
       or jsonb_typeof(v_feature -> 'geometry') <> 'object' then
      raise exception using errcode = '22023', message = 'invalid normalized spatial feature';
    end if;

    begin
      v_geometry := extensions.st_setsrid(
        extensions.st_geomfromgeojson((v_feature -> 'geometry')::text),
        4326
      );
    exception when others then
      raise exception using errcode = '22023', message = 'invalid normalized feature geometry';
    end;

    if extensions.st_srid(v_geometry) <> 4326
       or not extensions.st_isvalid(v_geometry)
       or extensions.st_isempty(v_geometry)
       or not extensions.st_coveredby(v_geometry, v_coverage_geom)
       or not extensions.st_coveredby(v_geometry, v_daegu_extent) then
      raise exception using errcode = '22023', message = 'feature geometry failed coverage checks';
    end if;

    if v_dataset = 'BUILDING' then
      v_height_m := (v_feature ->> 'heightM')::numeric;
      v_height_is_estimated := (v_feature ->> 'heightIsEstimated')::boolean;
      v_height_estimation_version := nullif(
        btrim(v_feature ->> 'heightEstimationVersion'),
        ''
      );
      if extensions.st_geometrytype(v_geometry) <> 'ST_MultiPolygon'
         or v_height_m <= 0
         or v_height_m > 1000
         or nullif(btrim(v_feature ->> 'heightSource'), '') is null
         or (
           v_height_is_estimated
           and v_height_estimation_version is null
         )
         or (
           not v_height_is_estimated
           and v_height_estimation_version is not null
         ) then
        raise exception using errcode = '22023', message = 'invalid normalized building feature';
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
        v_release_id,
        v_feature ->> 'sourceFeatureId',
        v_geometry::extensions.geometry(MultiPolygon, 4326),
        v_height_m,
        v_feature ->> 'heightSource',
        v_height_is_estimated,
        v_height_estimation_version,
        v_source_crs,
        'EPSG:4326',
        v_coverage,
        v_confidence,
        coalesce(nullif(btrim(v_feature ->> 'unknownReason'), ''), v_unknown_reason),
        (v_feature ->> 'observedAt')::timestamptz,
        v_source_updated_at
      );
    elsif v_dataset = 'REST_SPOT' then
      if extensions.st_geometrytype(v_geometry) <> 'ST_Point'
         or v_feature ->> 'restType' not in (
           'BENCH',
           'PAVILION',
           'SHADE_CANOPY',
           'PARK_FACILITY'
         ) then
        raise exception using errcode = '22023', message = 'invalid normalized rest spot feature';
      end if;

      insert into public.rest_spots (
        release_id,
        source_feature_id,
        rest_type,
        geom,
        source_crs,
        target_crs,
        coverage,
        confidence,
        unknown_reason,
        observed_at,
        source_updated_at
      ) values (
        v_release_id,
        v_feature ->> 'sourceFeatureId',
        v_feature ->> 'restType',
        v_geometry::extensions.geometry(Point, 4326),
        v_source_crs,
        'EPSG:4326',
        v_coverage,
        v_confidence,
        coalesce(nullif(btrim(v_feature ->> 'unknownReason'), ''), v_unknown_reason),
        (v_feature ->> 'observedAt')::timestamptz,
        v_source_updated_at
      );
    else
      v_barrier_type := v_feature ->> 'barrierType';
      v_slope_percent := (v_feature ->> 'slopePercent')::numeric;
      v_slope_source := nullif(btrim(v_feature ->> 'slopeSource'), '');
      if extensions.st_geometrytype(v_geometry) not in (
           'ST_LineString',
           'ST_MultiLineString',
           'ST_Polygon',
           'ST_MultiPolygon'
         )
         or (
           v_barrier_type = 'STAIRS'
           and (v_slope_percent is not null or v_slope_source is not null)
         )
         or (
           v_barrier_type = 'STEEP_SLOPE'
           and (v_slope_percent <= 5 or v_slope_source is null)
         )
         or v_barrier_type not in ('STAIRS', 'STEEP_SLOPE') then
        raise exception using errcode = '22023', message = 'invalid normalized barrier feature';
      end if;

      insert into public.barrier_segments (
        release_id,
        source_feature_id,
        barrier_type,
        slope_percent,
        slope_source,
        geom,
        source_crs,
        target_crs,
        coverage,
        confidence,
        unknown_reason,
        observed_at,
        source_updated_at
      ) values (
        v_release_id,
        v_feature ->> 'sourceFeatureId',
        v_barrier_type,
        v_slope_percent,
        v_slope_source,
        v_geometry,
        v_source_crs,
        'EPSG:4326',
        v_coverage,
        v_confidence,
        coalesce(nullif(btrim(v_feature ->> 'unknownReason'), ''), v_unknown_reason),
        (v_feature ->> 'observedAt')::timestamptz,
        v_source_updated_at
      );
    end if;
  end loop;

  if v_dataset = 'BUILDING' then
    select count(*)::integer into v_inserted_count
    from public.building_footprints
    where release_id = v_release_id;
  elsif v_dataset = 'REST_SPOT' then
    select count(*)::integer into v_inserted_count
    from public.rest_spots
    where release_id = v_release_id;
  else
    select count(*)::integer into v_inserted_count
    from public.barrier_segments
    where release_id = v_release_id;
  end if;

  if v_inserted_count <> v_feature_count then
    raise exception using errcode = '23514', message = 'spatial staging row count mismatch';
  end if;

  update public.spatial_data_releases
  set active = false,
      activated_at = null
  where dataset = v_dataset
    and active;

  update public.spatial_data_releases
  set active = true,
      activated_at = clock_timestamp()
  where id = v_release_id;

  return jsonb_build_object(
    'releaseId', v_release_id,
    'dataset', v_dataset,
    'version', v_version,
    'featureCount', v_inserted_count,
    'active', true
  );
end;
$$;

revoke all on function public.import_phase6_spatial_release(jsonb, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.import_phase6_spatial_release(jsonb, jsonb, jsonb)
  to service_role;

comment on function public.import_phase6_spatial_release(jsonb, jsonb, jsonb) is
  'Service-role-only atomic staging, quality validation, and activation for audited Phase 6 spatial releases.';
