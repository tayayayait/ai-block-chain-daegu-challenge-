begin;

set local search_path = public, extensions, pg_catalog;

select plan(44);

-- Stable identifiers make failures readable and avoid relying on generated data.
insert into public.organizations (id, name)
values
  ('10000000-0000-4000-8000-000000000001', '테스트 기관 A'),
  ('20000000-0000-4000-8000-000000000001', '테스트 기관 B');

insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-00000000a001', 'admin-a@example.test'),
  ('00000000-0000-4000-8000-00000000a002', 'worker-a@example.test'),
  ('00000000-0000-4000-8000-00000000a003', 'worker-a-unassigned@example.test'),
  ('00000000-0000-4000-8000-00000000b001', 'worker-b@example.test');

insert into public.profiles (
  id,
  organization_id,
  role,
  display_name
)
values
  (
    '00000000-0000-4000-8000-00000000a001',
    '10000000-0000-4000-8000-000000000001',
    'ADMIN',
    '기관 A 관리자'
  ),
  (
    '00000000-0000-4000-8000-00000000a002',
    '10000000-0000-4000-8000-000000000001',
    'CARE_WORKER',
    '기관 A 생활지원사'
  ),
  (
    '00000000-0000-4000-8000-00000000a003',
    '10000000-0000-4000-8000-000000000001',
    'CARE_WORKER',
    '기관 A 미배정 생활지원사'
  ),
  (
    '00000000-0000-4000-8000-00000000b001',
    '20000000-0000-4000-8000-000000000001',
    'CARE_WORKER',
    '기관 B 생활지원사'
  );

insert into public.subjects (
  id,
  organization_id,
  name,
  birth_year,
  sex,
  address,
  location,
  kma_nx,
  kma_ny,
  consented_at
)
values
  (
    '10000000-0000-4000-8000-000000000101',
    '10000000-0000-4000-8000-000000000001',
    '기관 A 배정 대상자',
    1940,
    'FEMALE',
    '대구광역시 중구 테스트로 1',
    extensions.st_setsrid(extensions.st_makepoint(128.601, 35.871), 4326)::extensions.geography,
    89,
    90,
    now() - interval '1 day'
  ),
  (
    '10000000-0000-4000-8000-000000000102',
    '10000000-0000-4000-8000-000000000001',
    '기관 A 미배정 대상자',
    1942,
    'MALE',
    '대구광역시 중구 테스트로 2',
    extensions.st_setsrid(extensions.st_makepoint(128.602, 35.872), 4326)::extensions.geography,
    89,
    90,
    now() - interval '1 day'
  ),
  (
    '20000000-0000-4000-8000-000000000101',
    '20000000-0000-4000-8000-000000000001',
    '기관 B 배정 대상자',
    1939,
    'UNDISCLOSED',
    '대구광역시 동구 테스트로 1',
    extensions.st_setsrid(extensions.st_makepoint(128.701, 35.881), 4326)::extensions.geography,
    91,
    90,
    now() - interval '1 day'
  );

insert into public.subject_assignments (
  organization_id,
  subject_id,
  profile_id
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-00000000a002'
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-00000000b001'
  );

insert into public.shelters (
  id,
  name,
  gu,
  facility_type,
  is_im_bank,
  road_address,
  location,
  kma_nx,
  kma_ny,
  source_geo_idn,
  geocode_result
)
values (
  'test-shelter-1',
  '테스트 무더위쉼터',
  '중구',
  '금융기관',
  true,
  '대구광역시 중구 테스트로 10',
  extensions.st_setsrid(extensions.st_makepoint(128.603, 35.873), 4326)::extensions.geography,
  89,
  90,
  'TEST-GEO-1',
  'SUCC'
);

-- Phase 5 public browsing goes through a server DTO. Browser roles have no
-- direct shelter table or internal provenance access.
set local role anon;

select throws_ok(
  $$select id from public.shelters$$,
  '42501',
  null,
  'anon cannot bypass the public shelter DTO boundary'
);

select throws_ok(
  $$select location from public.shelters$$,
  '42501',
  null,
  'anon cannot read raw shelter coordinates directly'
);

select throws_ok(
  $$select source_geo_idn from public.shelters$$,
  '42501',
  null,
  'anon cannot read shelter ingestion provenance'
);

select throws_ok(
  $$select id from public.subjects$$,
  '42501',
  null,
  'anon cannot read subjects'
);

select throws_ok(
  $$select api_kind from public.medication_api_cache$$,
  '42501',
  null,
  'anon cannot read medication API cache entries'
);

select throws_ok(
  $$select id from public.shelter_reports$$,
  '42501',
  null,
  'anon cannot read shelter reports'
);

select throws_ok(
  $$select id from public.alert_access_tokens$$,
  '42501',
  null,
  'anon cannot read alert access tokens'
);

select throws_ok(
  $$select id from public.attestation_jobs$$,
  '42501',
  null,
  'anon cannot read attestation jobs'
);

reset role;

-- Organization A worker: only their own profile and assigned subject are visible.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a002';
set local request.jwt.claim.role = 'authenticated';
set local role authenticated;

select results_eq(
  $$select id from public.subjects order by id$$,
  $$values ('10000000-0000-4000-8000-000000000101'::uuid)$$,
  'a care worker reads only their assigned subjects'
);

select results_eq(
  $$select subject_id from public.subject_assignments order by subject_id$$,
  $$values ('10000000-0000-4000-8000-000000000101'::uuid)$$,
  'a care worker reads only their own assignments'
);

select results_eq(
  $$select id from public.organizations order by id$$,
  $$values ('10000000-0000-4000-8000-000000000001'::uuid)$$,
  'a care worker reads only their organization'
);

select results_eq(
  $$select id from public.profiles order by id$$,
  $$values ('00000000-0000-4000-8000-00000000a002'::uuid)$$,
  'a care worker reads only their own profile'
);

select results_eq(
  $$
    update public.subjects
    set senior_mode = true
    where id = '10000000-0000-4000-8000-000000000101'
    returning senior_mode
  $$,
  array[true],
  'a care worker can update an allowed field for an assigned subject'
);

select is_empty(
  $$
    update public.subjects
    set senior_mode = true
    where id = '20000000-0000-4000-8000-000000000101'
    returning id
  $$,
  'a care worker cannot update a subject in another organization'
);

select is_empty(
  $$
    update public.subjects
    set senior_mode = true
    where id = '10000000-0000-4000-8000-000000000102'
    returning id
  $$,
  'a care worker cannot update an unassigned subject in their organization'
);

select throws_ok(
  $$select name from public.subjects$$,
  '42501',
  null,
  'a browser session cannot select subject PII columns'
);

select throws_ok(
  $$select id from public.weather_snapshots$$,
  '42501',
  null,
  'authenticated users cannot read weather ingestion rows directly'
);

select throws_ok(
  $$select api_kind from public.medication_api_cache$$,
  '42501',
  null,
  'authenticated users cannot read medication API cache entries'
);

select throws_ok(
  $$select id from public.shelter_reports$$,
  '42501',
  null,
  'authenticated users cannot read raw shelter reports'
);

select throws_ok(
  $$select id from public.alert_access_tokens$$,
  '42501',
  null,
  'authenticated users cannot read alert access tokens'
);

select throws_ok(
  $$select id from public.attestation_jobs$$,
  '42501',
  null,
  'authenticated users cannot read attestation jobs'
);

select throws_ok(
  $$
    insert into public.subject_assignments (
      organization_id,
      subject_id,
      profile_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-00000000a002'
    )
  $$,
  '42501',
  null,
  'a non-admin care worker cannot create assignments'
);

reset role;

-- Organization A admin: organization-wide access, with cross-organization
-- references still rejected by composite foreign keys.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a001';
set local request.jwt.claim.role = 'authenticated';
set local role authenticated;

select results_eq(
  $$select id from public.subjects order by id$$,
  $$
    values
      ('10000000-0000-4000-8000-000000000101'::uuid),
      ('10000000-0000-4000-8000-000000000102'::uuid)
  $$,
  'an organization admin reads all subjects in their organization'
);

select results_eq(
  $$select id from public.profiles order by id$$,
  $$
    values
      ('00000000-0000-4000-8000-00000000a001'::uuid),
      ('00000000-0000-4000-8000-00000000a002'::uuid),
      ('00000000-0000-4000-8000-00000000a003'::uuid)
  $$,
  'an organization admin reads all profiles in their organization'
);

select lives_ok(
  $$
    insert into public.subject_assignments (
      organization_id,
      subject_id,
      profile_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-00000000a003'
    )
  $$,
  'an organization admin can assign an in-organization subject'
);

select results_eq(
  $$select count(*)::bigint from public.subject_assignments$$,
  array[2::bigint],
  'an organization admin sees every assignment in their organization'
);

select throws_ok(
  $$
    insert into public.subject_assignments (
      organization_id,
      subject_id,
      profile_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-00000000b001'
    )
  $$,
  '23503',
  null,
  'an organization admin cannot create a cross-organization assignment'
);

reset role;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000a003';
set local request.jwt.claim.role = 'authenticated';
set local role authenticated;

select results_eq(
  $$select id from public.subjects order by id$$,
  $$values ('10000000-0000-4000-8000-000000000102'::uuid)$$,
  'a newly assigned worker reads the assigned subject and no others'
);

select results_eq(
  $$select subject_id from public.subject_assignments order by subject_id$$,
  $$values ('10000000-0000-4000-8000-000000000102'::uuid)$$,
  'a newly assigned worker reads only their own assignment'
);

reset role;

set local request.jwt.claim.sub = '00000000-0000-4000-8000-00000000b001';
set local request.jwt.claim.role = 'authenticated';
set local role authenticated;

select results_eq(
  $$select id from public.subjects order by id$$,
  $$values ('20000000-0000-4000-8000-000000000101'::uuid)$$,
  'an organization B worker reads only the organization B assignment'
);

select results_eq(
  $$select id from public.organizations order by id$$,
  $$values ('20000000-0000-4000-8000-000000000001'::uuid)$$,
  'an organization B worker reads only organization B'
);

select is_empty(
  $$
    select id
    from public.subjects
    where id = '10000000-0000-4000-8000-000000000101'
  $$,
  'an organization B worker cannot read an organization A subject'
);

reset role;

-- Worker-only ingestion and durable job tables are writable by service_role.
set local request.jwt.claim.sub = '';
set local request.jwt.claim.role = 'service_role';
set local role service_role;

select lives_ok(
  $$
    insert into public.medication_api_cache (
      api_kind,
      request_hash,
      response,
      expires_at
    )
    values (
      'DUR',
      repeat('a', 64),
      '{"items": []}'::jsonb,
      now() + interval '1 hour'
    )
  $$,
  'service_role can insert a medication API cache row'
);

select results_eq(
  $$select count(*)::bigint from public.medication_api_cache$$,
  array[1::bigint],
  'service_role can read medication API cache rows'
);

select lives_ok(
  $$
    insert into public.weather_snapshots (
      id,
      location_key,
      source,
      location,
      kma_nx,
      kma_ny,
      temperature_c,
      humidity_pct,
      feels_like_c,
      observed_at,
      expires_at
    )
    values (
      9001,
      'apihub:test:89:90',
      'KMA_APIHUB_500M',
      extensions.st_setsrid(extensions.st_makepoint(128.604, 35.874), 4326)::extensions.geography,
      89,
      90,
      34.5,
      62,
      37.1,
      now() - interval '15 minutes',
      now() + interval '15 minutes'
    )
  $$,
  'service_role can insert a weather snapshot'
);

select results_eq(
  $$select count(*)::bigint from public.weather_snapshots$$,
  array[1::bigint],
  'service_role can read weather snapshots'
);

select lives_ok(
  $$
    insert into public.shelter_reports (
      id,
      shelter_id,
      is_open,
      crowd_level,
      observed_at,
      reporter_hash,
      client_request_id
    )
    values (
      '30000000-0000-4000-8000-000000000001',
      'test-shelter-1',
      true,
      1,
      now() - interval '5 minutes',
      repeat('b', 64),
      '30000000-0000-4000-8000-000000000002'
    )
  $$,
  'service_role can insert a valid shelter report'
);

select throws_ok(
  $$
    insert into public.medications (
      subject_id,
      product_name,
      heat_class,
      risk_tier,
      source
    )
    values (
      '10000000-0000-4000-8000-000000000101',
      '잘못된 위험도 테스트 약',
      '이뇨제',
      'NONE',
      'MANUAL'
    )
  $$,
  '23514',
  null,
  'medication NONE tier rejects a non-null heat class'
);

select throws_ok(
  $$
    insert into public.shelter_reports (
      shelter_id,
      is_open,
      crowd_level,
      observed_at,
      reporter_hash,
      client_request_id
    )
    values (
      'test-shelter-1',
      true,
      3,
      now() - interval '5 minutes',
      repeat('c', 64),
      '30000000-0000-4000-8000-000000000003'
    )
  $$,
  '23514',
  null,
  'shelter report crowd level is bounded to 0 through 2'
);

select throws_ok(
  $$
    insert into public.attestation_jobs (idempotency_key)
    values ('test-job-without-target')
  $$,
  '23514',
  null,
  'an attestation job must reference exactly one target'
);

select throws_ok(
  $$
    insert into public.risk_snapshots (
      subject_id,
      weather_snapshot_id,
      hri,
      level,
      breakdown,
      reasons,
      input_hash,
      bucket_start
    )
    values (
      '10000000-0000-4000-8000-000000000101',
      9001,
      38,
      'L2',
      '{"E": 20, "M": 10, "P": 5, "C": 2}'::jsonb,
      array['테스트 위험 요인'],
      repeat('d', 64),
      date_trunc('hour', now())
    )
  $$,
  '23514',
  null,
  'risk HRI must equal the bounded breakdown sum'
);

select lives_ok(
  $$
    insert into public.risk_snapshots (
      id,
      subject_id,
      weather_snapshot_id,
      hri,
      level,
      breakdown,
      reasons,
      input_hash,
      bucket_start
    )
    values (
      9001,
      '10000000-0000-4000-8000-000000000101',
      9001,
      37,
      'L2',
      '{"E": 20, "M": 10, "P": 5, "C": 2}'::jsonb,
      array['테스트 위험 요인'],
      repeat('e', 64),
      date_trunc('hour', now())
    )
  $$,
  'service_role can persist a valid risk snapshot'
);

select lives_ok(
  $$
    insert into public.care_events (
      subject_id,
      event_type,
      risk_level,
      hri,
      payload,
      subject_hash,
      payload_hash,
      idempotency_key,
      occurred_at
    )
    values (
      '10000000-0000-4000-8000-000000000101',
      'VISIT',
      'L2',
      37,
      '{"note": "test"}'::jsonb,
      repeat('f', 64),
      repeat('0', 64),
      'test-care-event-1',
      now() - interval '1 minute'
    )
  $$,
  'service_role can persist a care event'
);

select results_eq(
  $$select hri from public.risk_snapshots where id = 9001$$,
  array[37::smallint],
  'service_role can read the durable risk snapshot'
);

select * from finish();
rollback;
