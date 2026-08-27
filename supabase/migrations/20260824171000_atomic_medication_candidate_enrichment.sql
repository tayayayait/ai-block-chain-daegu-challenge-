-- Replace exactly one unchanged medication review candidate. The row lock and
-- expected-candidate comparison preserve enrichments made concurrently from
-- another browser tab while rejecting stale writes to the same candidate.
create or replace function public.replace_medication_review_candidate(p_command jsonb)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_subject_id uuid;
  v_scan_session_id uuid;
  v_profile_id uuid;
  v_candidate_id uuid;
  v_expected_candidate jsonb;
  v_replacement_candidate jsonb;
  v_candidate_payload jsonb;
  v_current_candidate jsonb;
  v_next_payload jsonb;
  v_match_count integer;
  v_profile_role public.profile_role;
  v_organization_id uuid;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'medication candidate enrichment is service-role only';
  end if;

  if jsonb_typeof(p_command) is distinct from 'object'
    or jsonb_typeof(p_command -> 'expected_candidate') is distinct from 'object'
    or jsonb_typeof(p_command -> 'replacement_candidate') is distinct from 'object'
  then
    raise exception using errcode = '22023', message = 'invalid medication candidate command';
  end if;

  begin
    v_subject_id := (p_command ->> 'subject_id')::uuid;
    v_scan_session_id := (p_command ->> 'scan_session_id')::uuid;
    v_profile_id := (p_command ->> 'profile_id')::uuid;
    v_candidate_id := (p_command ->> 'candidate_id')::uuid;
    v_expected_candidate := p_command -> 'expected_candidate';
    v_replacement_candidate := p_command -> 'replacement_candidate';
  exception
    when others then
      raise exception using errcode = '22023', message = 'invalid medication candidate command';
  end;

  if v_expected_candidate ->> 'candidateId' is distinct from v_candidate_id::text
    or v_replacement_candidate ->> 'candidateId' is distinct from v_candidate_id::text
  then
    raise exception using errcode = '22023', message = 'candidate identity mismatch';
  end if;

  if not (
      v_replacement_candidate ?& array[
        'candidateId',
        'productName',
        'itemSeq',
        'manufacturerName',
        'ingredientName',
        'heatClass',
        'riskTier',
        'confidence',
        'source',
        'evidenceSource',
        'selected'
      ]::text[]
    )
    or v_replacement_candidate - array[
      'candidateId',
      'productName',
      'itemSeq',
      'manufacturerName',
      'ingredientName',
      'heatClass',
      'riskTier',
      'confidence',
      'source',
      'evidenceSource',
      'selected',
      'mfds'
    ]::text[] <> '{}'::jsonb
    or jsonb_typeof(v_replacement_candidate -> 'productName') <> 'string'
    or length(btrim(v_replacement_candidate ->> 'productName')) not between 1 and 200
    or jsonb_typeof(v_replacement_candidate -> 'itemSeq') not in ('string', 'null')
    or jsonb_typeof(v_replacement_candidate -> 'manufacturerName') not in ('string', 'null')
    or jsonb_typeof(v_replacement_candidate -> 'ingredientName') not in ('string', 'null')
    or jsonb_typeof(v_replacement_candidate -> 'heatClass') not in ('string', 'null')
    or jsonb_typeof(v_replacement_candidate -> 'riskTier') <> 'string'
    or v_replacement_candidate ->> 'riskTier' not in ('HIGH', 'MID', 'NONE')
    or jsonb_typeof(v_replacement_candidate -> 'confidence') not in ('number', 'null')
    or (
      jsonb_typeof(v_replacement_candidate -> 'confidence') = 'number'
      and not ((v_replacement_candidate ->> 'confidence')::numeric between 0 and 1)
    )
    or jsonb_typeof(v_replacement_candidate -> 'source') <> 'string'
    or v_replacement_candidate ->> 'source' not in ('AI_AUTO', 'AI_CONFIRMED', 'MANUAL')
    or jsonb_typeof(v_replacement_candidate -> 'evidenceSource') <> 'string'
    or v_replacement_candidate ->> 'evidenceSource'
      not in ('GEMINI_MFDS', 'GEMINI_ONLY', 'MANUAL')
    or jsonb_typeof(v_replacement_candidate -> 'selected') <> 'boolean'
    or (
      v_replacement_candidate ? 'mfds'
      and (
        jsonb_typeof(v_replacement_candidate -> 'mfds') <> 'object'
        or not (
          (v_replacement_candidate -> 'mfds') ?& array[
            'matchMethod',
            'productImageUrl',
            'sourceStatus',
            'easyDrug',
            'dur'
          ]::text[]
        )
        or (v_replacement_candidate -> 'mfds') - array[
          'matchMethod',
          'productImageUrl',
          'sourceStatus',
          'easyDrug',
          'dur'
        ]::text[] <> '{}'::jsonb
        or jsonb_typeof(v_replacement_candidate -> 'mfds' -> 'matchMethod')
          not in ('string', 'null')
        or (
          jsonb_typeof(v_replacement_candidate -> 'mfds' -> 'matchMethod') = 'string'
          and v_replacement_candidate -> 'mfds' ->> 'matchMethod' not in (
            'PRODUCT_NAME_EXACT',
            'PRODUCT_NAME_NORMALIZED',
            'ITEM_SEQ',
            'PHYSICAL'
          )
        )
        or jsonb_typeof(v_replacement_candidate -> 'mfds' -> 'productImageUrl')
          not in ('string', 'null')
        or jsonb_typeof(v_replacement_candidate -> 'mfds' -> 'sourceStatus') <> 'object'
        or not (
          (v_replacement_candidate -> 'mfds' -> 'sourceStatus') ?& array[
            'pillIdentification',
            'easyDrug',
            'dur'
          ]::text[]
        )
        or (v_replacement_candidate -> 'mfds' -> 'sourceStatus') - array[
          'pillIdentification',
          'easyDrug',
          'dur'
        ]::text[] <> '{}'::jsonb
        or jsonb_typeof(
          v_replacement_candidate -> 'mfds' -> 'sourceStatus' -> 'pillIdentification'
        ) <> 'string'
        or v_replacement_candidate -> 'mfds' -> 'sourceStatus' ->> 'pillIdentification'
          not in ('AVAILABLE', 'PARTIAL', 'UNAVAILABLE')
        or jsonb_typeof(
          v_replacement_candidate -> 'mfds' -> 'sourceStatus' -> 'easyDrug'
        ) <> 'string'
        or v_replacement_candidate -> 'mfds' -> 'sourceStatus' ->> 'easyDrug'
          not in ('AVAILABLE', 'PARTIAL', 'UNAVAILABLE')
        or jsonb_typeof(
          v_replacement_candidate -> 'mfds' -> 'sourceStatus' -> 'dur'
        ) <> 'string'
        or v_replacement_candidate -> 'mfds' -> 'sourceStatus' ->> 'dur'
          not in ('AVAILABLE', 'PARTIAL', 'UNAVAILABLE')
        or jsonb_typeof(v_replacement_candidate -> 'mfds' -> 'easyDrug')
          not in ('object', 'null')
        or jsonb_typeof(v_replacement_candidate -> 'mfds' -> 'dur')
          not in ('object', 'null')
      )
    )
    or (
      v_replacement_candidate ->> 'riskTier' = 'NONE'
      and jsonb_typeof(v_replacement_candidate -> 'heatClass') <> 'null'
    )
    or (
      v_replacement_candidate ->> 'riskTier' = 'HIGH'
      and coalesce(v_replacement_candidate ->> 'heatClass', '') not in (
        '이뇨제',
        '항콜린제',
        '항정신병제',
        '항우울제',
        '1세대 항히스타민제'
      )
    )
    or (
      v_replacement_candidate ->> 'riskTier' = 'MID'
      and coalesce(v_replacement_candidate ->> 'heatClass', '') not in (
        '혈압강하제',
        '칼슘채널길항제',
        '질산염·혈관확장제',
        '리튬',
        '항간질제',
        '항치매제',
        '항불안제·근이완제',
        '교감신경흥분제'
      )
    )
  then
    raise exception using errcode = '22023', message = 'invalid replacement candidate';
  end if;

  select scan.candidate_payload, profile.role, profile.organization_id
  into v_candidate_payload, v_profile_role, v_organization_id
  from public.medication_scan_sessions as scan
  join public.subjects as subject
    on subject.id = scan.subject_id
  join public.profiles as profile
    on profile.id = scan.created_by
   and profile.organization_id = subject.organization_id
  where scan.id = v_scan_session_id
    and scan.subject_id = v_subject_id
    and scan.created_by = v_profile_id
    and scan.status = 'NEEDS_CONFIRMATION'
  for update of scan, subject, profile;

  if not found then
    raise exception using errcode = '42501', message = 'medication review is not available';
  end if;

  if v_profile_role = 'CARE_WORKER' then
    perform 1
    from public.subject_assignments as assignment
    where assignment.organization_id = v_organization_id
      and assignment.subject_id = v_subject_id
      and assignment.profile_id = v_profile_id
    for update;
    if not found then
      raise exception using errcode = '42501', message = 'medication review is not available';
    end if;
  end if;

  if jsonb_typeof(v_candidate_payload) is distinct from 'array'
    or jsonb_array_length(v_candidate_payload) > 30
  then
    raise exception using errcode = '22023', message = 'invalid medication review payload';
  end if;

  select count(*)::integer
  into v_match_count
  from jsonb_array_elements(v_candidate_payload) as candidate(value)
  where candidate.value ->> 'candidateId' = v_candidate_id::text;

  if v_match_count <> 1 then
    raise exception using errcode = '22023', message = 'medication candidate is not unique';
  end if;

  select candidate.value
  into v_current_candidate
  from jsonb_array_elements(v_candidate_payload) as candidate(value)
  where candidate.value ->> 'candidateId' = v_candidate_id::text;

  if v_current_candidate is distinct from v_expected_candidate then
    raise exception using errcode = '40001', message = 'medication review candidate changed';
  end if;

  select jsonb_agg(
    case
      when candidate.value ->> 'candidateId' = v_candidate_id::text
        then v_replacement_candidate
      else candidate.value
    end
    order by candidate.ordinality
  )
  into v_next_payload
  from jsonb_array_elements(v_candidate_payload) with ordinality
    as candidate(value, ordinality);

  update public.medication_scan_sessions as scan
  set candidate_payload = v_next_payload
  where scan.id = v_scan_session_id;

  return 'APPLIED';
end;
$$;

revoke all on function public.replace_medication_review_candidate(jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.replace_medication_review_candidate(jsonb)
to service_role;

comment on function public.replace_medication_review_candidate(jsonb) is
  'Service-role-only atomic compare-and-swap for one real MFDS review candidate.';
