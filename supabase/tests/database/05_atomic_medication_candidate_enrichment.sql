begin;

set local search_path = public, extensions, pg_catalog;

select plan(13);

create function pg_temp.med_candidate(p_candidate_id text, p_product_name text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'candidateId', p_candidate_id,
    'productName', p_product_name,
    'itemSeq', null,
    'manufacturerName', null,
    'ingredientName', null,
    'heatClass', null,
    'riskTier', 'NONE',
    'confidence', null,
    'source', 'MANUAL',
    'evidenceSource', 'MANUAL',
    'selected', true
  )
$$;

select has_function(
  'public',
  'replace_medication_review_candidate',
  array['jsonb'],
  'single-candidate medication enrichment RPC exists'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.replace_medication_review_candidate(jsonb)',
    'EXECUTE'
  ),
  'anon cannot mutate medication evidence'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.replace_medication_review_candidate(jsonb)',
    'EXECUTE'
  ),
  'authenticated clients cannot mutate medication evidence directly'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.replace_medication_review_candidate(jsonb)',
    'EXECUTE'
  ),
  'service_role can invoke the trusted mutation boundary'
);

insert into auth.users (id, aud, role, email, encrypted_password, created_at, updated_at)
values
  (
    '00000000-0000-4000-8000-00000000f001',
    'authenticated',
    'authenticated',
    'enrichment-owner@example.invalid',
    '',
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000f002',
    'authenticated',
    'authenticated',
    'enrichment-other@example.invalid',
    '',
    now(),
    now()
  );

insert into public.organizations (id, name)
values ('00000000-0000-4000-8000-00000000f010', '의약품 동시성 테스트 기관');

insert into public.profiles (id, organization_id, role, display_name)
values
  (
    '00000000-0000-4000-8000-00000000f001',
    '00000000-0000-4000-8000-00000000f010',
    'ADMIN',
    '보강 소유자'
  ),
  (
    '00000000-0000-4000-8000-00000000f002',
    '00000000-0000-4000-8000-00000000f010',
    'ADMIN',
    '다른 관리자'
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
values (
  '00000000-0000-4000-8000-00000000f020',
  '00000000-0000-4000-8000-00000000f010',
  '의약품 동시성 대상자',
  1940,
  'FEMALE',
  '대구광역시 중구 국채보상로 670',
  extensions.st_setsrid(extensions.st_makepoint(128.601, 35.871), 4326)::extensions.geography,
  89,
  91,
  now()
);

insert into public.medication_scan_sessions (
  id,
  subject_id,
  image_path,
  input_method,
  created_by,
  status,
  attempt_count,
  candidate_payload
)
values
  (
    '00000000-0000-4000-8000-00000000f030',
    '00000000-0000-4000-8000-00000000f020',
    null,
    'MANUAL',
    '00000000-0000-4000-8000-00000000f001',
    'NEEDS_CONFIRMATION',
    0,
    jsonb_build_array(
      pg_temp.med_candidate('00000000-0000-4000-8000-00000000f041', 'A0'),
      pg_temp.med_candidate('00000000-0000-4000-8000-00000000f042', 'B0')
    )
  ),
  (
    '00000000-0000-4000-8000-00000000f031',
    '00000000-0000-4000-8000-00000000f020',
    null,
    'MANUAL',
    '00000000-0000-4000-8000-00000000f001',
    'NEEDS_CONFIRMATION',
    0,
    jsonb_build_array(
      pg_temp.med_candidate(
        '00000000-0000-4000-8000-00000000f041',
        'duplicate one'
      ),
      pg_temp.med_candidate(
        '00000000-0000-4000-8000-00000000f041',
        'duplicate two'
      )
    )
  );

set local role service_role;

select is(
  public.replace_medication_review_candidate(
    jsonb_build_object(
      'subject_id', '00000000-0000-4000-8000-00000000f020',
      'scan_session_id', '00000000-0000-4000-8000-00000000f030',
      'profile_id', '00000000-0000-4000-8000-00000000f001',
      'candidate_id', '00000000-0000-4000-8000-00000000f041',
      'expected_candidate', pg_temp.med_candidate(
        '00000000-0000-4000-8000-00000000f041',
        'A0'
      ),
      'replacement_candidate', pg_temp.med_candidate(
        '00000000-0000-4000-8000-00000000f041',
        'A1'
      )
    )
  ),
  'APPLIED',
  'first candidate enrichment is applied'
);

select is(
  public.replace_medication_review_candidate(
    jsonb_build_object(
      'subject_id', '00000000-0000-4000-8000-00000000f020',
      'scan_session_id', '00000000-0000-4000-8000-00000000f030',
      'profile_id', '00000000-0000-4000-8000-00000000f001',
      'candidate_id', '00000000-0000-4000-8000-00000000f042',
      'expected_candidate', pg_temp.med_candidate(
        '00000000-0000-4000-8000-00000000f042',
        'B0'
      ),
      'replacement_candidate', pg_temp.med_candidate(
        '00000000-0000-4000-8000-00000000f042',
        'B1'
      )
    )
  ),
  'APPLIED',
  'second candidate enrichment preserves the first candidate'
);

select results_eq(
  $$
    select string_agg(candidate.value ->> 'productName', '|' order by candidate.ordinality)
    from public.medication_scan_sessions as scan,
      jsonb_array_elements(scan.candidate_payload) with ordinality
        as candidate(value, ordinality)
    where scan.id = '00000000-0000-4000-8000-00000000f030'
  $$,
  array['A1|B1'],
  'both real enrichment results and candidate order are preserved'
);

select throws_ok(
  $$
    select public.replace_medication_review_candidate(
      jsonb_build_object(
        'subject_id', '00000000-0000-4000-8000-00000000f020',
        'scan_session_id', '00000000-0000-4000-8000-00000000f030',
        'profile_id', '00000000-0000-4000-8000-00000000f001',
        'candidate_id', '00000000-0000-4000-8000-00000000f041',
        'expected_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f041',
          'A0'
        ),
        'replacement_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f041',
          'stale overwrite'
        )
      )
    )
  $$,
  '40001',
  'medication review candidate changed',
  'a stale response cannot overwrite a newer result for the same candidate'
);

select throws_ok(
  $$
    select public.replace_medication_review_candidate(
      jsonb_build_object(
        'subject_id', '00000000-0000-4000-8000-00000000f020',
        'scan_session_id', '00000000-0000-4000-8000-00000000f030',
        'profile_id', '00000000-0000-4000-8000-00000000f002',
        'candidate_id', '00000000-0000-4000-8000-00000000f042',
        'expected_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f042',
          'B1'
        ),
        'replacement_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f042',
          'wrong owner'
        )
      )
    )
  $$,
  '42501',
  'medication review is not available',
  'another profile cannot replace the creator-owned review'
);

select throws_ok(
  $$
    select public.replace_medication_review_candidate(
      jsonb_build_object(
        'subject_id', '00000000-0000-4000-8000-00000000f020',
        'scan_session_id', '00000000-0000-4000-8000-00000000f031',
        'profile_id', '00000000-0000-4000-8000-00000000f001',
        'candidate_id', '00000000-0000-4000-8000-00000000f041',
        'expected_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f041',
          'duplicate one'
        ),
        'replacement_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f041',
          'replacement'
        )
      )
    )
  $$,
  '22023',
  'medication candidate is not unique',
  'duplicate candidate identifiers are rejected'
);

select throws_ok(
  $$
    select public.replace_medication_review_candidate(
      jsonb_build_object(
        'subject_id', '00000000-0000-4000-8000-00000000f020',
        'scan_session_id', '00000000-0000-4000-8000-00000000f030',
        'profile_id', '00000000-0000-4000-8000-00000000f001',
        'candidate_id', '00000000-0000-4000-8000-00000000f042',
        'expected_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f042',
          'B1'
        ),
        'replacement_candidate', jsonb_set(
          pg_temp.med_candidate(
            '00000000-0000-4000-8000-00000000f042',
            'nullable enum'
          ),
          '{source}',
          'null'::jsonb
        )
      )
    )
  $$,
  '22023',
  'invalid replacement candidate',
  'JSON null cannot bypass a required evidence enum'
);

select throws_ok(
  $$
    select public.replace_medication_review_candidate(
      jsonb_build_object(
        'subject_id', '00000000-0000-4000-8000-00000000f020',
        'scan_session_id', '00000000-0000-4000-8000-00000000f030',
        'profile_id', '00000000-0000-4000-8000-00000000f001',
        'candidate_id', '00000000-0000-4000-8000-00000000f042',
        'expected_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f042',
          'B1'
        ),
        'replacement_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f042',
          'malformed evidence'
        ) || jsonb_build_object('mfds', '{}'::jsonb)
      )
    )
  $$,
  '22023',
  'invalid replacement candidate',
  'malformed MFDS evidence is rejected at the database boundary'
);

update public.medication_scan_sessions
set status = 'COMPLETED'
where id = '00000000-0000-4000-8000-00000000f030';

select throws_ok(
  $$
    select public.replace_medication_review_candidate(
      jsonb_build_object(
        'subject_id', '00000000-0000-4000-8000-00000000f020',
        'scan_session_id', '00000000-0000-4000-8000-00000000f030',
        'profile_id', '00000000-0000-4000-8000-00000000f001',
        'candidate_id', '00000000-0000-4000-8000-00000000f042',
        'expected_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f042',
          'B1'
        ),
        'replacement_candidate', pg_temp.med_candidate(
          '00000000-0000-4000-8000-00000000f042',
          'after completion'
        )
      )
    )
  $$,
  '42501',
  'medication review is not available',
  'completed sessions are immutable'
);

select * from finish();
rollback;
