-- Phase 4 medication review state and one atomic confirmation boundary.
-- Review payloads contain normalized medication candidates only. Model raw text,
-- image bytes, credentials, and subject PII are never persisted here.
alter table public.medication_scan_sessions
  alter column image_path drop not null;

alter table public.medication_scan_sessions
  add column input_method text not null default 'IMAGE'
    check (input_method in ('IMAGE', 'MANUAL')),
  add column created_by uuid references public.profiles (id) on delete set null,
  add column candidate_payload jsonb not null default '[]'::jsonb
    check (jsonb_typeof(candidate_payload) = 'array'),
  add constraint medication_scan_image_path_by_method check (
    (input_method = 'IMAGE' and image_path is not null)
    or (input_method = 'MANUAL' and image_path is null)
  );

alter table public.medications
  add constraint medications_heat_class_tier_match check (
    (heat_class in (
      '이뇨제',
      '항콜린제',
      '항정신병제',
      '항우울제',
      '1세대 항히스타민제'
    ) and risk_tier = 'HIGH')
    or (heat_class in (
      '혈압강하제',
      '칼슘채널길항제',
      '질산염·혈관확장제',
      '리튬',
      '항간질제',
      '항치매제',
      '항불안제·근이완제',
      '교감신경흥분제'
    ) and risk_tier = 'MID')
    or (heat_class is null and risk_tier = 'NONE')
  );

create table public.medication_confirmation_receipts (
  request_id uuid primary key,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  scan_session_id uuid references public.medication_scan_sessions (id) on delete set null,
  confirmed_by uuid not null references public.profiles (id) on delete restrict,
  policy text not null check (policy in ('ADD', 'REPLACE')),
  medication_ids uuid[] not null check (cardinality(medication_ids) between 1 and 30),
  before_hri smallint check (before_hri is null or before_hri between 0 and 100),
  before_level public.risk_level,
  after_hri smallint not null check (after_hri between 0 and 100),
  after_level public.risk_level not null,
  risk_snapshot_id bigint not null references public.risk_snapshots (id) on delete restrict,
  transition_id uuid references public.alert_transitions (id) on delete set null,
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((before_hri is null) = (before_level is null))
);

create index medication_confirmation_subject_time_idx
  on public.medication_confirmation_receipts (subject_id, confirmed_at desc);

create trigger medication_confirmation_not_future
before insert or update of confirmed_at on public.medication_confirmation_receipts
for each row execute function private.reject_future_timestamp('confirmed_at');

alter table public.medication_confirmation_receipts enable row level security;
alter table public.medication_confirmation_receipts force row level security;

revoke all on table public.medication_confirmation_receipts from public, anon, authenticated;
grant all on table public.medication_confirmation_receipts to service_role;

create or replace function public.confirm_medication_scan(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_subject_id uuid;
  v_scan_session_id uuid;
  v_profile_id uuid;
  v_policy text;
  v_confirmed_at timestamptz;
  v_medications jsonb;
  v_medication jsonb;
  v_medication_id uuid;
  v_medication_ids uuid[] := '{}';
  v_birth_year smallint;
  v_lives_alone boolean;
  v_chronic_disease boolean;
  v_has_cooling boolean;
  v_kma_nx smallint;
  v_kma_ny smallint;
  v_before_hri smallint;
  v_before_level public.risk_level;
  v_weather_snapshot_id bigint;
  v_feels_like real;
  v_advisory public.heat_advisory;
  v_tropical_night_streak smallint;
  v_med_high integer;
  v_med_mid integer;
  v_e smallint;
  v_m smallint;
  v_p smallint;
  v_c smallint;
  v_after_hri smallint;
  v_after_level public.risk_level;
  v_breakdown jsonb;
  v_input_hash text;
  v_bucket_start timestamptz;
  v_risk_snapshot_id bigint;
  v_active_episode_id uuid;
  v_episode_started_at timestamptz;
  v_transition_id uuid;
  v_transition_type public.alert_transition_type;
  v_from_level public.risk_level;
  v_transition_key text;
  v_result jsonb;
begin
  if jsonb_typeof(p_command) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid medication confirmation command';
  end if;

  v_request_id := (p_command ->> 'request_id')::uuid;
  v_subject_id := (p_command ->> 'subject_id')::uuid;
  v_scan_session_id := nullif(p_command ->> 'scan_session_id', '')::uuid;
  v_profile_id := (p_command ->> 'profile_id')::uuid;
  v_policy := p_command ->> 'policy';
  v_confirmed_at := (p_command ->> 'confirmed_at')::timestamptz;
  v_medications := p_command -> 'medications';

  if v_policy not in ('ADD', 'REPLACE')
    or jsonb_typeof(v_medications) <> 'array'
    or jsonb_array_length(v_medications) not between 1 and 30
    or v_confirmed_at > clock_timestamp()
  then
    raise exception using errcode = '22023', message = 'invalid medication confirmation command';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_subject_id::text, 0)
  );

  select jsonb_build_object(
    'request_id', receipt.request_id,
    'before', case
      when receipt.before_hri is null then null
      else jsonb_build_object('hri', receipt.before_hri, 'level', receipt.before_level)
    end,
    'after', jsonb_build_object('hri', receipt.after_hri, 'level', receipt.after_level),
    'medication_ids', to_jsonb(receipt.medication_ids),
    'transition_created', receipt.transition_id is not null
  )
  into v_result
  from public.medication_confirmation_receipts as receipt
  where receipt.request_id = v_request_id;
  if found then
    return v_result;
  end if;

  select
    subject.birth_year,
    subject.lives_alone,
    subject.chronic_disease,
    subject.has_cooling,
    subject.kma_nx,
    subject.kma_ny
  into
    v_birth_year,
    v_lives_alone,
    v_chronic_disease,
    v_has_cooling,
    v_kma_nx,
    v_kma_ny
  from public.subjects as subject
  join public.profiles as profile
    on profile.id = v_profile_id
   and profile.organization_id = subject.organization_id
  where subject.id = v_subject_id;
  if not found then
    raise exception using errcode = '22023', message = 'medication confirmation scope mismatch';
  end if;

  if v_scan_session_id is not null and not exists (
    select 1
    from public.medication_scan_sessions as scan
    where scan.id = v_scan_session_id
      and scan.subject_id = v_subject_id
      and scan.status in ('NEEDS_CONFIRMATION', 'MANUAL_REQUIRED')
  ) then
    raise exception using errcode = '22023', message = 'medication scan session mismatch';
  end if;

  select snapshot.hri, snapshot.level
  into v_before_hri, v_before_level
  from public.risk_snapshots as snapshot
  where snapshot.subject_id = v_subject_id
    and snapshot.computed_at <= v_confirmed_at
  order by snapshot.computed_at desc, snapshot.id desc
  limit 1;

  case v_policy
    when 'REPLACE' then
      delete from public.medications as medication
      where medication.subject_id = v_subject_id;
    when 'ADD' then
      null;
    else
      raise exception using errcode = '22023', message = 'invalid medication policy';
  end case;

  for v_medication in select value from jsonb_array_elements(v_medications)
  loop
    if jsonb_typeof(v_medication) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid medication item';
    end if;
    insert into public.medications (
      subject_id,
      product_name,
      item_seq,
      ingredient_name,
      heat_class,
      risk_tier,
      source,
      confidence,
      scan_session_id,
      confirmed_by,
      created_at,
      updated_at
    )
    values (
      v_subject_id,
      v_medication ->> 'product_name',
      nullif(v_medication ->> 'item_seq', ''),
      nullif(v_medication ->> 'ingredient_name', ''),
      nullif(v_medication ->> 'heat_class', ''),
      (v_medication ->> 'risk_tier')::public.medication_risk_tier,
      (v_medication ->> 'source')::public.medication_source,
      nullif(v_medication ->> 'confidence', '')::real,
      v_scan_session_id,
      v_profile_id,
      v_confirmed_at,
      v_confirmed_at
    )
    returning id into v_medication_id;
    v_medication_ids := array_append(v_medication_ids, v_medication_id);
  end loop;

  update public.subjects as subject
  set medication_profile_registered_at = coalesce(
    subject.medication_profile_registered_at,
    v_confirmed_at
  )
  where subject.id = v_subject_id;

  if v_scan_session_id is not null then
    update public.medication_scan_sessions as scan
    set status = 'COMPLETED'
    where scan.id = v_scan_session_id
      and scan.subject_id = v_subject_id;
  end if;

  select
    weather.id,
    weather.feels_like_c,
    weather.advisory,
    weather.tropical_night_streak
  into
    v_weather_snapshot_id,
    v_feels_like,
    v_advisory,
    v_tropical_night_streak
  from public.weather_snapshots as weather
  where weather.kma_nx = v_kma_nx
    and weather.kma_ny = v_kma_ny
    and weather.observed_at <= v_confirmed_at
  order by weather.observed_at desc, weather.id desc
  limit 1;
  if not found then
    raise exception using errcode = 'P0001', message = 'weather snapshot unavailable';
  end if;

  select
    count(distinct medication.heat_class) filter (where medication.risk_tier = 'HIGH'),
    count(distinct medication.heat_class) filter (where medication.risk_tier = 'MID')
  into v_med_high, v_med_mid
  from public.medications as medication
  where medication.subject_id = v_subject_id
    and medication.heat_class is not null;

  v_e := least(
    50,
    case
      when v_feels_like >= 40 then 50
      when v_feels_like >= 38 then 42
      when v_feels_like >= 35 then 32
      when v_feels_like >= 33 then 20
      when v_feels_like >= 31 then 10
      else 0
    end
      + case v_advisory when 'WARNING' then 5 when 'WATCH' then 3 else 0 end
      + case when v_tropical_night_streak >= 3 then 5 else 0 end
  );
  v_m := least(25, v_med_high * 6 + v_med_mid * 3);
  v_p := least(
    20,
    case
      when extract(year from timezone('Asia/Seoul', v_confirmed_at))::integer - v_birth_year >= 85
        then 8
      when extract(year from timezone('Asia/Seoul', v_confirmed_at))::integer - v_birth_year >= 75
        then 5
      when extract(year from timezone('Asia/Seoul', v_confirmed_at))::integer - v_birth_year >= 65
        then 3
      else 0
    end
      + case when v_lives_alone then 5 else 0 end
      + case when v_chronic_disease then 4 else 0 end
      + case when not v_has_cooling then 3 else 0 end
  );
  v_c := case when exists (
    select 1
    from public.shelter_checkins as checkin
    where checkin.subject_id = v_subject_id
      and checkin.attestation_state = 'VERIFIED'
      and checkin.checked_in_at between v_confirmed_at - interval '24 hours' and v_confirmed_at
  ) then 6 else 0 end;
  v_after_hri := greatest(0, least(100, v_e + v_m + v_p - v_c));
  v_after_level := case
    when v_after_hri >= 80 then 'L4'
    when v_after_hri >= 60 then 'L3'
    when v_after_hri >= 40 then 'L2'
    when v_after_hri >= 20 then 'L1'
    else 'L0'
  end;
  v_breakdown := jsonb_build_object('E', v_e, 'M', v_m, 'P', v_p, 'C', v_c);
  v_bucket_start := to_timestamp(
    floor(extract(epoch from v_confirmed_at) / 1800) * 1800
  );
  v_input_hash := pg_catalog.encode(
    extensions.digest(
      concat_ws(
        '|',
        'medication-confirmation-v1',
        v_subject_id,
        v_weather_snapshot_id,
        v_bucket_start,
        v_e,
        v_m,
        v_p,
        v_c,
        v_med_high,
        v_med_mid
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.risk_snapshots (
    subject_id,
    weather_snapshot_id,
    hri,
    level,
    breakdown,
    reasons,
    input_hash,
    bucket_start,
    computed_at
  )
  values (
    v_subject_id,
    v_weather_snapshot_id,
    v_after_hri,
    v_after_level,
    v_breakdown,
    array['복약 정보 변경을 반영해 위험도를 다시 계산했습니다'],
    v_input_hash,
    v_bucket_start,
    v_confirmed_at
  )
  on conflict (subject_id, bucket_start, input_hash) do update
  set computed_at = excluded.computed_at
  returning id into v_risk_snapshot_id;

  select episode.id, episode.started_at
  into v_active_episode_id, v_episode_started_at
  from public.risk_episodes as episode
  where episode.subject_id = v_subject_id
    and episode.ended_at is null
  order by episode.started_at desc
  limit 1
  for update;

  if v_after_level in ('L0', 'L1', 'L2') then
    if v_active_episode_id is not null then
      update public.risk_episodes as episode
      set ended_at = v_confirmed_at
      where episode.id = v_active_episode_id
        and episode.ended_at is null;
    end if;
  else
    v_from_level := coalesce(v_before_level, 'L0'::public.risk_level);
    if v_before_level is null or v_before_level in ('L0', 'L1', 'L2')
      or v_active_episode_id is null
    then
      v_active_episode_id := gen_random_uuid();
      v_episode_started_at := v_confirmed_at;
      insert into public.risk_episodes (id, subject_id, entry_level, started_at)
      values (v_active_episode_id, v_subject_id, v_after_level, v_confirmed_at)
      on conflict do nothing;
      v_transition_type := 'ENTER';
      if v_from_level not in ('L0', 'L1', 'L2') then
        v_from_level := 'L2';
      end if;
    elsif v_before_level = 'L3' and v_after_level = 'L4' then
      v_transition_type := 'ESCALATE';
    end if;

    if v_transition_type is not null then
      v_transition_key := 'medication-confirmation:' || v_request_id::text;
      insert into public.alert_transitions (
        subject_id,
        episode_id,
        episode_started_at,
        from_level,
        to_level,
        transition_type,
        idempotency_key,
        occurred_at
      )
      values (
        v_subject_id,
        v_active_episode_id,
        v_episode_started_at,
        v_from_level,
        v_after_level,
        v_transition_type,
        v_transition_key,
        v_confirmed_at
      )
      on conflict (idempotency_key) do nothing
      returning id into v_transition_id;

      if v_transition_id is null then
        select transition.id
        into v_transition_id
        from public.alert_transitions as transition
        where transition.idempotency_key = v_transition_key;
      end if;

      -- The risk transition feeds the notification outbox. ALERT_SENT is only
      -- materialized after a real live provider delivery boundary, never at
      -- medication confirmation time and never in Demo mode.
    end if;
  end if;

  insert into public.medication_confirmation_receipts (
    request_id,
    subject_id,
    scan_session_id,
    confirmed_by,
    policy,
    medication_ids,
    before_hri,
    before_level,
    after_hri,
    after_level,
    risk_snapshot_id,
    transition_id,
    confirmed_at
  )
  values (
    v_request_id,
    v_subject_id,
    v_scan_session_id,
    v_profile_id,
    v_policy,
    v_medication_ids,
    v_before_hri,
    v_before_level,
    v_after_hri,
    v_after_level,
    v_risk_snapshot_id,
    v_transition_id,
    v_confirmed_at
  );

  return jsonb_build_object(
    'request_id', v_request_id,
    'before', case
      when v_before_hri is null then null
      else jsonb_build_object('hri', v_before_hri, 'level', v_before_level)
    end,
    'after', jsonb_build_object('hri', v_after_hri, 'level', v_after_level),
    'medication_ids', to_jsonb(v_medication_ids),
    'transition_created', v_transition_id is not null
  );
end;
$$;

revoke all on function public.confirm_medication_scan(jsonb)
from public, anon, authenticated;
grant execute on function public.confirm_medication_scan(jsonb)
to service_role;
