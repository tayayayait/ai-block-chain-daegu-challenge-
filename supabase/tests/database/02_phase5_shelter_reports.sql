begin;

set local search_path = public, extensions, pg_catalog;

select plan(15);

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
select
  'DG-' || to_char(number, 'FM0000'),
  'Phase 5 테스트 쉼터 ' || number,
  '중구',
  '금융기관',
  number = 9999,
  '대구광역시 중구 Phase 5 테스트로 ' || number,
  extensions.st_setsrid(
    extensions.st_makepoint(128.601 + (9999 - number) * 0.00001, 35.871),
    4326
  )::extensions.geography,
  89,
  90,
  'PHASE5-' || number,
  'SUCC'
from generate_series(9993, 9999) as numbers(number);

insert into public.shelter_reports (
  shelter_id,
  is_open,
  crowd_level,
  observed_at,
  reporter_hash,
  client_request_id,
  attestation_state,
  attestation_uid
)
values
  (
    'DG-9999',
    true,
    0,
    statement_timestamp() - interval '5 minutes',
    repeat('a', 64),
    '90000000-0000-4000-8000-000000000001',
    'VERIFIED',
    '0xphase5verified'
  ),
  (
    'DG-9998',
    false,
    2,
    statement_timestamp() - interval '2 hours 1 second',
    repeat('b', 64),
    '90000000-0000-4000-8000-000000000002',
    'UNVERIFIED',
    null
  );

set local role anon;

select throws_ok(
  $$select id from public.shelters$$,
  '42501',
  null,
  'anon cannot query the raw shelter table'
);

select throws_ok(
  $$
    select * from public.search_shelters(
      35.871, 128.601, 500, null, false, 'ALL', 'priority', 50
    )
  $$,
  '42501',
  null,
  'anon cannot call the service-only shelter search RPC'
);

select throws_ok(
  $$
    select * from public.submit_shelter_report(
      'DG-9999', true, null, repeat('c', 64),
      '90000000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  null,
  'anon cannot call the service-only report mutation RPC'
);

reset role;
set local request.jwt.claim.role = 'service_role';
set local role service_role;

select ok(
  has_function_privilege(
    'service_role',
    'public.search_shelters(double precision,double precision,integer,text,boolean,text,text,integer)',
    'EXECUTE'
  ),
  'service_role can execute shelter search'
);

select results_eq(
  $$
    select shelter_id
    from public.search_shelters(
      35.871, 128.601, 500, '중구', true, 'ALL', 'priority', 50
    )
    where shelter_id = 'DG-9999'
  $$,
  $$values ('DG-9999'::text)$$,
  'ST_DWithin includes the exact-origin iM shelter'
);

select results_eq(
  $$
    select operating_state
    from public.search_shelters(
      35.871, 128.601, 500, '중구', true, 'ALL', 'priority', 50
    )
    where shelter_id = 'DG-9999'
  $$,
  $$values ('OPEN'::text)$$,
  'a recent verified open report is visible as OPEN'
);

select results_eq(
  $$
    select operating_state
    from public.search_shelters(
      35.871, 128.6011, 500, '중구', false, 'ALL', 'priority', 50
    )
    where shelter_id = 'DG-9998'
  $$,
  $$values ('UNKNOWN'::text)$$,
  'a report older than two hours is UNKNOWN'
);

select results_eq(
  $$
    select outcome
    from public.submit_shelter_report(
      'DG-9998', true, 1, repeat('c', 64),
      '90000000-0000-4000-8000-000000000003'
    )
  $$,
  $$values ('ACCEPTED'::text)$$,
  'the first server submission is accepted'
);

select results_eq(
  $$
    select attestation_state
    from public.shelter_reports
    where client_request_id = '90000000-0000-4000-8000-000000000003'
  $$,
  $$values ('UNVERIFIED'::public.attestation_state)$$,
  'a new report starts unverified'
);

select results_eq(
  $$
    select job.state
    from public.attestation_jobs as job
    join public.shelter_reports as report on report.id = job.shelter_report_id
    where report.client_request_id = '90000000-0000-4000-8000-000000000003'
  $$,
  $$values ('PENDING'::public.attestation_job_state)$$,
  'the report attestation job starts pending'
);

select results_eq(
  $$
    select outcome
    from public.submit_shelter_report(
      'DG-9998', false, 2, repeat('c', 64),
      '90000000-0000-4000-8000-000000000004'
    )
  $$,
  $$values ('DUPLICATE'::text)$$,
  'the database blocks the same reporter and shelter for ten minutes'
);

select is_empty(
  $$select id from public.shelter_checkins where shelter_id = 'DG-9998'$$,
  'a public status report never creates a subject check-in'
);

select is_empty(
  $$
    select id
    from public.care_events
    where payload ->> 'shelterId' = 'DG-9998'
  $$,
  'a public status report never creates an HRI mitigation care event'
);

insert into public.shelter_reports (
  shelter_id,
  is_open,
  observed_at,
  reporter_hash,
  client_request_id
)
select
  'DG-' || to_char(number, 'FM0000'),
  true,
  statement_timestamp(),
  repeat('c', 64),
  pg_catalog.gen_random_uuid()
from generate_series(9994, 9997) as numbers(number);

select results_eq(
  $$
    select outcome
    from public.submit_shelter_report(
      'DG-9993', true, null, repeat('c', 64),
      '90000000-0000-4000-8000-000000000005'
    )
  $$,
  $$values ('RATE_LIMITED'::text)$$,
  'the reporter-scoped rate window is enforced atomically'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.submit_shelter_report(text,boolean,smallint,text,uuid)',
    'EXECUTE'
  ),
  'authenticated browser sessions cannot bypass the report server action'
);

select * from finish();
rollback;
