begin;

set local search_path = public, extensions, pg_catalog;

select plan(5);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values (
  '00000000-0000-4000-8000-00000000a901',
  'authenticated',
  'authenticated',
  'idempotent-registration@example.invalid',
  '',
  now(),
  now()
);

insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-00000000a902', '등록 멱등성 테스트 기관');

insert into public.profiles (id, organization_id, role, display_name)
values (
  '00000000-0000-4000-8000-00000000a901',
  '00000000-0000-4000-8000-00000000a902',
  'ADMIN',
  '멱등성 관리자'
);

set local role service_role;

with first_call as (
  select public.register_subject_service_role(
    jsonb_build_object(
      'registration_request_id', '00000000-0000-4000-8000-00000000a903',
      'actor_profile_id', '00000000-0000-4000-8000-00000000a901',
      'subject', jsonb_build_object(
        'name', '멱등성 대상자',
        'birth_year', 1941,
        'sex', 'FEMALE',
        'phone', null,
        'guardian_phone', null,
        'address', '대구광역시 중구 국채보상로 670',
        'longitude', 128.601,
        'latitude', 35.871,
        'kma_nx', 89,
        'kma_ny', 91,
        'lives_alone', true,
        'chronic_disease', false,
        'has_cooling', true,
        'senior_mode', false,
        'consented_at', now()
      )
    )
  ) as subject_id
), second_call as (
  select public.register_subject_service_role(
    jsonb_build_object(
      'registration_request_id', '00000000-0000-4000-8000-00000000a903',
      'actor_profile_id', '00000000-0000-4000-8000-00000000a901',
      'subject', jsonb_build_object(
        'name', '멱등성 대상자',
        'birth_year', 1941,
        'sex', 'FEMALE',
        'phone', null,
        'guardian_phone', null,
        'address', '대구광역시 중구 국채보상로 670',
        'longitude', 128.601,
        'latitude', 35.871,
        'kma_nx', 89,
        'kma_ny', 91,
        'lives_alone', true,
        'chronic_disease', false,
        'has_cooling', true,
        'senior_mode', false,
        'consented_at', now() + interval '1 second'
      )
    )
  ) as subject_id
)
select is(
  (select subject_id from first_call),
  (select subject_id from second_call),
  'the same request returns the original subject id'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.subjects
    where organization_id = '00000000-0000-4000-8000-00000000a902'
      and name = '멱등성 대상자'
  $$,
  array[1::bigint],
  'a retried request creates one real subject only'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.subject_registration_receipts
    where request_id = '00000000-0000-4000-8000-00000000a903'
  $$,
  array[1::bigint],
  'one durable registration receipt is stored'
);

select throws_ok(
  $$
    select public.register_subject_service_role(
      jsonb_build_object(
        'registration_request_id', '00000000-0000-4000-8000-00000000a903',
        'actor_profile_id', '00000000-0000-4000-8000-00000000a901',
        'subject', jsonb_build_object(
          'name', '다른 대상자',
          'birth_year', 1941,
          'sex', 'FEMALE',
          'phone', null,
          'guardian_phone', null,
          'address', '대구광역시 중구 국채보상로 670',
          'longitude', 128.601,
          'latitude', 35.871,
          'kma_nx', 89,
          'kma_ny', 91,
          'lives_alone', true,
          'chronic_disease', false,
          'has_cooling', true,
          'senior_mode', false,
          'consented_at', now()
        )
      )
    )
  $$,
  '22023',
  'registration request already used',
  'a request id cannot be reused for different personal data'
);

delete from public.subjects
where id = (
  select subject_id
  from public.subject_registration_receipts
  where request_id = '00000000-0000-4000-8000-00000000a903'
);

select throws_ok(
  $$
    select public.register_subject_service_role(
      jsonb_build_object(
        'registration_request_id', '00000000-0000-4000-8000-00000000a903',
        'actor_profile_id', '00000000-0000-4000-8000-00000000a901',
        'subject', jsonb_build_object(
          'name', '멱등성 대상자',
          'birth_year', 1941,
          'sex', 'FEMALE',
          'phone', null,
          'guardian_phone', null,
          'address', '대구광역시 중구 국채보상로 670',
          'longitude', 128.601,
          'latitude', 35.871,
          'kma_nx', 89,
          'kma_ny', 91,
          'lives_alone', true,
          'chronic_disease', false,
          'has_cooling', true,
          'senior_mode', false,
          'consented_at', now()
        )
      )
    )
  $$,
  '22023',
  'registration request no longer recoverable',
  'a deleted subject leaves a durable tombstone instead of allowing reuse'
);

select * from finish();
rollback;
