begin;

set local search_path = public, extensions, pg_catalog;

select plan(38);

select ok(
  not has_function_privilege('anon', 'public.prepare_medication_image_cleanup(uuid,uuid,text,timestamptz)', 'EXECUTE'),
  'anon cannot prepare image cleanup jobs'
);
select ok(
  not has_function_privilege('authenticated', 'public.prepare_medication_image_cleanup(uuid,uuid,text,timestamptz)', 'EXECUTE'),
  'authenticated cannot prepare image cleanup jobs'
);
select ok(
  not has_function_privilege('anon', 'public.attach_medication_image_session(uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE'),
  'anon cannot attach image sessions'
);
select ok(
  not has_function_privilege('authenticated', 'public.attach_medication_image_session(uuid,uuid,uuid,uuid,text,timestamptz)', 'EXECUTE'),
  'authenticated cannot attach image sessions'
);
select ok(
  not has_function_privilege('anon', 'public.replace_medication_image_session(uuid,uuid,uuid,uuid,integer,text,timestamptz)', 'EXECUTE'),
  'anon cannot replace image sessions'
);
select ok(
  not has_function_privilege('authenticated', 'public.replace_medication_image_session(uuid,uuid,uuid,uuid,integer,text,timestamptz)', 'EXECUTE'),
  'authenticated cannot replace image sessions'
);
select ok(
  not has_function_privilege('anon', 'public.claim_medication_image_cleanups(timestamptz,integer)', 'EXECUTE'),
  'anon cannot claim image cleanup jobs'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_medication_image_cleanups(timestamptz,integer)', 'EXECUTE'),
  'authenticated cannot claim image cleanup jobs'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_medication_image_cleanup(uuid,uuid,boolean,text,timestamptz)', 'EXECUTE'),
  'anon cannot finalize image cleanup jobs'
);
select ok(
  not has_function_privilege('authenticated', 'public.finalize_medication_image_cleanup(uuid,uuid,boolean,text,timestamptz)', 'EXECUTE'),
  'authenticated cannot finalize image cleanup jobs'
);

select results_eq(
  $$
    select public.prepare_medication_image_cleanup(
      '71000000-0000-4000-8000-000000000001'::uuid,
      '70000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-attempt-1.jpg',
      '2030-01-01 00:00:00+00'::timestamptz
    )
  $$,
  $$values ('PREPARED'::text)$$,
  'a cleanup receipt is committed before Storage upload'
);

select results_eq(
  $$
    select state
    from public.medication_image_cleanup_jobs
    where id = '71000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('PREPARED'::text)$$,
  'the pre-upload cleanup receipt remains durable'
);

select is_empty(
  $$
    select 1
    from public.medication_scan_sessions
    where id = '70000000-0000-4000-8000-000000000001'::uuid
  $$,
  'prepare does not create a scan session before upload succeeds'
);

select results_eq(
  $$
    select public.prepare_medication_image_cleanup(
      '71000000-0000-4000-8000-000000000001'::uuid,
      '70000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-attempt-1.jpg',
      '2030-01-01 00:00:00+00'::timestamptz
    )
  $$,
  $$values ('IDEMPOTENT'::text)$$,
  'the same deterministic prepare receipt is idempotent'
);

select results_eq(
  $$
    select public.attach_medication_image_session(
      '71000000-0000-4000-8000-000000000001'::uuid,
      '70000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000102'::uuid,
      '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-attempt-1.jpg',
      '2030-01-01 00:01:00+00'::timestamptz
    )
  $$,
  $$values ('APPLIED'::text)$$,
  'attach atomically creates the image scan session'
);

select results_eq(
  $$
    select image_purge_state, status::text
    from public.medication_scan_sessions
    where id = '70000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('PENDING'::text, 'UPLOADED'::text)$$,
  'the attached image starts pending its 24-hour purge'
);

select results_eq(
  $$
    select state
    from public.medication_image_cleanup_jobs
    where id = '71000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('DELETE_PENDING'::text)$$,
  'the attached cleanup receipt owns the current object'
);

select results_eq(
  $$
    select public.attach_medication_image_session(
      '71000000-0000-4000-8000-000000000001'::uuid,
      '70000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000102'::uuid,
      '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-attempt-1.jpg',
      '2030-01-01 00:01:00+00'::timestamptz
    )
  $$,
  $$values ('IDEMPOTENT'::text)$$,
  'a lost attach response can be replayed safely'
);

update public.medication_scan_sessions
set status = 'NEEDS_RETAKE', attempt_count = 1, image_quality = 'BLURRY'
where id = '70000000-0000-4000-8000-000000000001'::uuid;

select results_eq(
  $$
    select public.prepare_medication_image_cleanup(
      '71000000-0000-4000-8000-000000000002'::uuid,
      '70000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-attempt-2.webp',
      '2030-01-01 00:09:00+00'::timestamptz
    )
  $$,
  $$values ('PREPARED'::text)$$,
  'a retake also records its cleanup receipt before upload'
);

select results_eq(
  $$
    select public.replace_medication_image_session(
      '71000000-0000-4000-8000-000000000002'::uuid,
      '70000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000102'::uuid,
      1,
      '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-attempt-2.webp',
      '2030-01-01 00:10:00+00'::timestamptz
    )
  $$,
  $$values (1)$$,
  'retake replacement applies atomically'
);

select results_eq(
  $$
    select image_path, status::text
    from public.medication_scan_sessions
    where id = '70000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (
    '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-attempt-2.webp'::text,
    'UPLOADED'::text
  )$$,
  'replacement points the session only at the new object'
);

select results_eq(
  $$
    select cleanup_after <= '2030-01-01 00:10:00+00'::timestamptz
    from public.medication_image_cleanup_jobs
    where id = '71000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values (true)$$,
  'the replaced object becomes immediately eligible for cleanup'
);

select results_eq(
  $$
    select cleanup_after = '2030-01-02 00:10:00+00'::timestamptz
    from public.medication_image_cleanup_jobs
    where id = '71000000-0000-4000-8000-000000000002'::uuid
  $$,
  $$values (true)$$,
  'the current retake keeps its own 24-hour purge deadline'
);

select results_eq(
  $$
    select public.replace_medication_image_session(
      '71000000-0000-4000-8000-000000000002'::uuid,
      '70000000-0000-4000-8000-000000000001'::uuid,
      '10000000-0000-4000-8000-000000000001'::uuid,
      '00000000-0000-4000-8000-000000000102'::uuid,
      1,
      '10000000-0000-4000-8000-000000000001/70000000-0000-4000-8000-000000000001-attempt-2.webp',
      '2030-01-01 00:10:00+00'::timestamptz
    )
  $$,
  $$values (1)$$,
  'a response-lost replacement is idempotent'
);

create temporary table phase8_old_claim on commit drop as
select *
from public.claim_medication_image_cleanups('2030-01-01 00:10:00+00'::timestamptz, 10);

select results_eq(
  $$select count(*)::integer from phase8_old_claim$$,
  $$values (1)$$,
  'only the replaced object is due immediately'
);

select results_eq(
  $$
    select public.finalize_medication_image_cleanup(
      cleanup_job_id,
      lease_token,
      true,
      null,
      '2030-01-01 00:11:00+00'::timestamptz
    )
    from phase8_old_claim
  $$,
  $$values ('APPLIED'::text)$$,
  'confirmed Storage deletion finalizes the replaced object'
);

select is_empty(
  $$
    select 1 from public.medication_image_cleanup_jobs
    where id = '71000000-0000-4000-8000-000000000001'::uuid
  $$,
  'the replaced object receipt is removed after confirmed deletion'
);

create temporary table phase8_current_claim on commit drop as
select *
from public.claim_medication_image_cleanups('2030-01-02 01:10:00+00'::timestamptz, 10);

select results_eq(
  $$select count(*)::integer from phase8_current_claim$$,
  $$values (1)$$,
  'the current object becomes claimable after 24 hours'
);

select results_eq(
  $$
    select image_purge_state
    from public.medication_scan_sessions
    where id = '70000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('PROCESSING'::text)$$,
  'claim mirrors PROCESSING onto the current scan metadata'
);

select results_eq(
  $$
    select public.finalize_medication_image_cleanup(
      cleanup_job_id,
      '72000000-0000-4000-8000-000000000001'::uuid,
      true,
      null,
      '2030-01-02 01:11:00+00'::timestamptz
    )
    from phase8_current_claim
  $$,
  $$values ('LEASE_LOST'::text)$$,
  'a stale or forged lease token cannot finalize deletion'
);

select results_eq(
  $$
    select public.finalize_medication_image_cleanup(
      cleanup_job_id,
      lease_token,
      false,
      'STORAGE_DELETE_FAILED',
      '2030-01-02 01:11:00+00'::timestamptz
    )
    from phase8_current_claim
  $$,
  $$values ('APPLIED'::text)$$,
  'a failed Storage deletion schedules a retry'
);

select results_eq(
  $$
    select state, error_code
    from public.medication_image_cleanup_jobs
    where id = '71000000-0000-4000-8000-000000000002'::uuid
  $$,
  $$values ('RETRY_WAIT'::text, 'STORAGE_DELETE_FAILED'::text)$$,
  'the cleanup receipt retains only a stable retry error code'
);

select results_eq(
  $$
    select image_purge_state, image_purge_error_code
    from public.medication_scan_sessions
    where id = '70000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('RETRY_WAIT'::text, 'STORAGE_DELETE_FAILED'::text)$$,
  'current scan metadata mirrors the retry state'
);

select throws_ok(
  $$
    select public.finalize_medication_image_cleanup(
      '71000000-0000-4000-8000-000000000002'::uuid,
      '72000000-0000-4000-8000-000000000001'::uuid,
      false,
      null,
      '2030-01-02 01:12:00+00'::timestamptz
    )
  $$,
  '22023',
  'invalid image cleanup outcome',
  'failed cleanup outcomes require a stable error code'
);

create temporary table phase8_retry_claim on commit drop as
select *
from public.claim_medication_image_cleanups('2030-01-02 01:14:00+00'::timestamptz, 10);

select results_eq(
  $$select count(*)::integer from phase8_retry_claim$$,
  $$values (1)$$,
  'the failed cleanup is reclaimed after bounded backoff'
);

select results_eq(
  $$
    select public.finalize_medication_image_cleanup(
      cleanup_job_id,
      lease_token,
      true,
      null,
      '2030-01-02 01:14:30+00'::timestamptz
    )
    from phase8_retry_claim
  $$,
  $$values ('APPLIED'::text)$$,
  'a later confirmed Storage deletion is applied'
);

select results_eq(
  $$
    select image_purge_state, image_path is null
    from public.medication_scan_sessions
    where id = '70000000-0000-4000-8000-000000000001'::uuid
  $$,
  $$values ('PURGED'::text, true)$$,
  'confirmed deletion scrubs the current image path and marks it purged'
);

select is_empty(
  $$
    select 1 from public.medication_image_cleanup_jobs
    where id = '71000000-0000-4000-8000-000000000002'::uuid
  $$,
  'the successful current cleanup receipt is removed'
);

select * from finish();
rollback;
