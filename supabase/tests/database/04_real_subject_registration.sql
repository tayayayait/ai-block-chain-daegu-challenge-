begin;

set local search_path = public, extensions, pg_catalog;

select plan(8);

select has_function(
  'public',
  'register_subject_service_role',
  array['jsonb'],
  'real subject registration RPC exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.register_subject_service_role(jsonb)',
    'EXECUTE'
  ),
  'anon cannot execute subject registration'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.register_subject_service_role(jsonb)',
    'EXECUTE'
  ),
  'authenticated cannot execute subject registration directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.register_subject_service_role(jsonb)',
    'EXECUTE'
  ),
  'service_role can execute subject registration'
);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  (
    '00000000-0000-4000-8000-00000000d001',
    'authenticated',
    'authenticated',
    'registration-admin@example.invalid',
    '',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000d002',
    'authenticated',
    'authenticated',
    'registration-care@example.invalid',
    '',
    now(),
    now()
  );

insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-00000000e001', '실데이터 등록 테스트 기관');

insert into public.profiles (id, organization_id, role, display_name)
values
  (
    '00000000-0000-4000-8000-00000000d001',
    '00000000-0000-4000-8000-00000000e001',
    'ADMIN',
    '등록 관리자'
  ),
  (
    '00000000-0000-4000-8000-00000000d002',
    '00000000-0000-4000-8000-00000000e001',
    'CARE_WORKER',
    '돌봄 담당자'
  );

set local role service_role;

select lives_ok(
  $$
    select public.register_subject_service_role(
      jsonb_build_object(
        'registration_request_id', '00000000-0000-4000-8000-00000000e101',
        'actor_profile_id', '00000000-0000-4000-8000-00000000d001',
        'subject', jsonb_build_object(
          'name', '실제 대상자',
          'birth_year', 1941,
          'sex', 'FEMALE',
          'phone', '01012345678',
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
  'ADMIN registers one Naver-confirmed subject'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.subjects as subject
    join public.subject_assignments as assignment
      on assignment.subject_id = subject.id
    where subject.organization_id = '00000000-0000-4000-8000-00000000e001'
      and assignment.profile_id = '00000000-0000-4000-8000-00000000d001'
      and subject.address = '대구광역시 중구 국채보상로 670'
  $$,
  array[1::bigint],
  'subject and creating ADMIN assignment commit together'
);

select throws_ok(
  $$
    select public.register_subject_service_role(
      jsonb_build_object(
        'registration_request_id', '00000000-0000-4000-8000-00000000e102',
        'actor_profile_id', '00000000-0000-4000-8000-00000000d002',
        'subject', jsonb_build_object(
          'name', '거부 대상자',
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
  '42501',
  'verified administrator required',
  'CARE_WORKER cannot be selected as the creating assignment'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.subjects
    where name = '거부 대상자'
  $$,
  array[0::bigint],
  'a rejected registration leaves no partial subject row'
);

select * from finish();
rollback;
