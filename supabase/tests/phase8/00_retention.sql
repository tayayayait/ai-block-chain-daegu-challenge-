begin;

set local search_path = public, extensions, pg_catalog;

select plan(10);

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
) values (
  'RETENTION-TEST',
  '보존정책 테스트 쉼터',
  '중구',
  '금융기관',
  false,
  '대구광역시 중구 보존정책 테스트로 1',
  extensions.st_setsrid(extensions.st_makepoint(128.6, 35.87), 4326)::extensions.geography,
  89,
  90,
  'RETENTION-TEST',
  'SUCC'
);

insert into public.route_cache (
  cache_key,
  destination_shelter_id,
  spatial_version,
  solar_bucket,
  route_result,
  expires_at,
  created_at
)
select
  repeat(number::text, 64),
  'RETENTION-TEST',
  'phase8-test',
  '2000-01-01 00:00:00+00'::timestamptz,
  '{}'::jsonb,
  ('2000-01-02 00:00:00+00'::timestamptz + number * interval '1 minute'),
  '2000-01-01 00:00:00+00'::timestamptz
from generate_series(1, 3) as values_to_expire(number);

insert into public.care_events (
  id,
  subject_id,
  event_type,
  risk_level,
  hri,
  payload,
  subject_hash,
  payload_hash,
  idempotency_key,
  occurred_at,
  attestation_state,
  created_at
) values (
  '73000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  'VISIT',
  'L3',
  75,
  '{}'::jsonb,
  repeat('a', 64),
  repeat('b', 64),
  'phase8-retention-uncertain-event',
  '2000-01-01 00:00:00+00'::timestamptz,
  'FAILED',
  '2000-01-01 00:00:00+00'::timestamptz
);

insert into public.attestation_jobs (
  id,
  care_event_id,
  state,
  next_attempt_at,
  error_code,
  idempotency_key,
  created_at,
  updated_at
) values (
  '74000000-0000-4000-8000-000000000001'::uuid,
  '73000000-0000-4000-8000-000000000001'::uuid,
  'FAILED',
  '2000-01-01 00:00:00+00'::timestamptz,
  'CONFIRMATION_UNCERTAIN',
  'phase8-retention-uncertain-job',
  '2000-01-01 00:00:00+00'::timestamptz,
  '2000-01-01 00:00:00+00'::timestamptz
);

set local role authenticated;

select throws_ok(
  $$select public.run_retention_cleanup('2001-01-01 00:00:00+00', 2)$$,
  '42501',
  null,
  'authenticated sessions cannot execute retention cleanup'
);

reset role;
set local request.jwt.claim.role = 'service_role';
set local role service_role;

select lives_ok(
  $$select public.run_retention_cleanup('2001-01-01 00:00:00+00', 2)$$,
  'service_role can execute retention cleanup'
);

select results_eq(
  $$
    select (public.run_retention_cleanup(
      '2001-01-01 00:00:00+00'::timestamptz,
      1
    ) ->> 'route_cache')::integer
  $$,
  $$values (1)$$,
  'each table cleanup is bounded by the requested batch limit'
);

select results_eq(
  $$
    select count(*)::integer
    from public.route_cache
    where destination_shelter_id = 'RETENTION-TEST'
  $$,
  $$values (0)$$,
  'a later bounded call drains the remaining expired route entry'
);

select throws_ok(
  $$select public.run_retention_cleanup(statement_timestamp(), 501)$$,
  '22023',
  'invalid retention cleanup request',
  'batch limits above 500 fail closed'
);

select throws_ok(
  $$select public.run_retention_cleanup(statement_timestamp(), null)$$,
  '22023',
  'invalid retention cleanup request',
  'a null batch limit fails closed instead of becoming unbounded'
);

select throws_ok(
  $$select public.run_retention_cleanup(statement_timestamp(), 0)$$,
  '22023',
  'invalid retention cleanup request',
  'a zero batch limit fails closed'
);

select lives_ok(
  $$select public.run_retention_cleanup(statement_timestamp(), 500)$$,
  'the maximum documented batch limit is accepted'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.run_retention_cleanup(timestamptz,integer)',
    'EXECUTE'
  ),
  'authenticated has no direct cleanup privilege'
);

select results_eq(
  $$
    select count(*)::integer
    from public.attestation_jobs
    where id = '74000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (1)$$,
  'confirmation-uncertain attestation receipts are never made replayable by retention'
);

select * from finish();
rollback;
