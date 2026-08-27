-- Phase 2 durable model. Phase 6 route geometry tables are deliberately deferred
-- until their source CRS and provenance columns are available.
create schema if not exists private;

create type public.profile_role as enum ('ADMIN', 'CARE_WORKER');
create type public.subject_sex as enum ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED');
create type public.risk_level as enum ('L0', 'L1', 'L2', 'L3', 'L4');
create type public.medication_risk_tier as enum ('HIGH', 'MID', 'NONE');
create type public.medication_source as enum ('AI_AUTO', 'AI_CONFIRMED', 'MANUAL');
create type public.attestation_state as enum ('UNVERIFIED', 'PENDING', 'VERIFIED', 'FAILED');
create type public.checkin_actor_scope as enum ('CAREGIVER', 'SUBJECT_SCOPED');
create type public.heat_advisory as enum ('NONE', 'WATCH', 'WARNING');
create type public.weather_source as enum ('KMA_APIHUB_500M', 'KMA_VILLAGE_FCST');
create type public.medication_image_quality as enum ('GOOD', 'BLURRY', 'PARTIAL', 'UNREADABLE');
create type public.medication_scan_status as enum (
  'UPLOADED',
  'EXTRACTING',
  'NEEDS_RETAKE',
  'NEEDS_CONFIRMATION',
  'MANUAL_REQUIRED',
  'COMPLETED',
  'FAILED'
);
create type public.alert_transition_type as enum ('ENTER', 'ESCALATE', 'PERSIST_2H');
create type public.care_event_type as enum ('VISIT', 'SHELTER_CHECKIN', 'ALERT_SENT');
create type public.guardian_alert_status as enum (
  'QUEUED',
  'PROCESSING',
  'DEMO_RECORDED',
  'ACCEPTED',
  'DELIVERED',
  'RETRY_WAIT',
  'FAILED_PERMANENT',
  'SUPPRESSED'
);
create type public.guardian_channel as enum ('SMS', 'ALIMTALK');
create type public.guardian_template as enum ('HEAT_L3', 'HEAT_L4');
create type public.attestation_job_state as enum (
  'PENDING',
  'PROCESSING',
  'RETRY_WAIT',
  'VERIFIED',
  'FAILED'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  role public.profile_role not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 80),
  birth_year smallint not null,
  sex public.subject_sex not null,
  phone text,
  guardian_phone text,
  address text not null check (length(btrim(address)) > 0),
  location extensions.geography(Point, 4326) not null,
  kma_nx smallint not null,
  kma_ny smallint not null,
  lives_alone boolean not null default true,
  chronic_disease boolean not null default false,
  has_cooling boolean not null default true,
  senior_mode boolean not null default false,
  -- Distinguishes "reviewed and taking none" from "medication profile not registered".
  medication_profile_registered_at timestamptz,
  consented_at timestamptz not null,
  pii_updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.subject_assignments (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subject_id uuid not null,
  profile_id uuid not null,
  assigned_at timestamptz not null default now(),
  primary key (subject_id, profile_id),
  foreign key (organization_id, subject_id)
    references public.subjects (organization_id, id) on delete cascade,
  foreign key (organization_id, profile_id)
    references public.profiles (organization_id, id) on delete cascade
);

create table public.shelters (
  id text primary key,
  name text not null check (length(btrim(name)) > 0),
  gu text not null check (gu in ('중구', '동구', '서구', '남구', '북구', '수성구', '달서구', '달성군')),
  facility_type text not null check (facility_type in ('경로당', '금융기관', '행정복지센터', '기타')),
  is_im_bank boolean not null default false,
  road_address text not null check (length(btrim(road_address)) > 0),
  location extensions.geography(Point, 4326) not null,
  kma_nx smallint not null,
  kma_ny smallint not null,
  source_geo_idn text not null unique,
  geocode_result text not null check (geocode_result = 'SUCC'),
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.medication_scan_sessions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  image_path text not null unique check (length(btrim(image_path)) > 0),
  image_quality public.medication_image_quality,
  status public.medication_scan_status not null default 'UPLOADED',
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  model_id text,
  purge_after timestamptz not null default (now() + interval '24 hours'),
  image_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (purge_after > created_at)
);

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  product_name text not null check (length(btrim(product_name)) > 0),
  item_seq text,
  ingredient_name text,
  heat_class text check (
    heat_class is null or heat_class in (
      '이뇨제',
      '항콜린제',
      '항정신병제',
      '항우울제',
      '1세대 항히스타민제',
      '혈압강하제',
      '칼슘채널길항제',
      '질산염·혈관확장제',
      '리튬',
      '항간질제',
      '항치매제',
      '항불안제·근이완제',
      '교감신경흥분제'
    )
  ),
  risk_tier public.medication_risk_tier not null,
  source public.medication_source not null,
  confidence real check (confidence is null or confidence between 0 and 1),
  scan_session_id uuid references public.medication_scan_sessions (id) on delete set null,
  confirmed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((risk_tier = 'NONE') = (heat_class is null))
);

create table public.medication_api_cache (
  api_kind text not null check (api_kind in ('PILL_IDENTIFICATION', 'E_DRUG', 'DUR')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (api_kind, request_hash),
  check (jsonb_typeof(response) in ('object', 'array')),
  check (expires_at > fetched_at)
);

create table public.weather_snapshots (
  id bigint generated by default as identity primary key,
  -- APIHub 500m points and village-forecast cells use different namespaces.
  location_key text not null,
  source public.weather_source not null,
  location extensions.geography(Point, 4326) not null,
  kma_nx smallint not null,
  kma_ny smallint not null,
  temperature_c real not null,
  humidity_pct real not null check (humidity_pct between 0 and 100),
  feels_like_c real not null,
  advisory public.heat_advisory not null default 'NONE',
  tropical_night_streak smallint not null default 0 check (tropical_night_streak >= 0),
  is_partial boolean not null default false,
  is_stale boolean not null default false,
  error_code text,
  observed_at timestamptz not null,
  collected_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (location_key, source, observed_at),
  check (expires_at > observed_at),
  check (
    (source = 'KMA_APIHUB_500M' and location_key like 'apihub:%')
    or (source = 'KMA_VILLAGE_FCST' and location_key like 'village:%')
  )
);

create table public.risk_snapshots (
  id bigint generated by default as identity primary key,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  weather_snapshot_id bigint not null references public.weather_snapshots (id) on delete restrict,
  hri smallint not null check (hri between 0 and 100),
  level public.risk_level not null,
  breakdown jsonb not null,
  reasons text[] not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  bucket_start timestamptz not null,
  computed_at timestamptz not null default now(),
  unique (subject_id, bucket_start, input_hash),
  check (cardinality(reasons) between 1 and 3),
  check (
    jsonb_typeof(breakdown) = 'object'
    and (breakdown ->> 'E') ~ '^[0-9]+$'
    and (breakdown ->> 'M') ~ '^[0-9]+$'
    and (breakdown ->> 'P') ~ '^[0-9]+$'
    and (breakdown ->> 'C') ~ '^[0-9]+$'
    and (breakdown ->> 'E')::smallint between 0 and 50
    and (breakdown ->> 'M')::smallint between 0 and 25
    and (breakdown ->> 'P')::smallint between 0 and 20
    and (breakdown ->> 'C')::smallint between 0 and 6
    and hri = greatest(
      0,
      least(
        100,
        (breakdown ->> 'E')::smallint
          + (breakdown ->> 'M')::smallint
          + (breakdown ->> 'P')::smallint
          - (breakdown ->> 'C')::smallint
      )
    )
  )
);

create table public.alert_transitions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  episode_id uuid not null,
  episode_started_at timestamptz not null,
  from_level public.risk_level not null,
  to_level public.risk_level not null,
  transition_type public.alert_transition_type not null,
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  check (to_level in ('L3', 'L4')),
  -- A recovered subject starts a new episode and therefore uses ENTER.
  check (
    (transition_type = 'ENTER' and from_level in ('L0', 'L1', 'L2'))
    or (transition_type = 'ESCALATE' and from_level = 'L3' and to_level = 'L4')
    or (transition_type = 'PERSIST_2H' and from_level = to_level)
  )
);

create table public.shelter_reports (
  id uuid primary key default gen_random_uuid(),
  shelter_id text not null references public.shelters (id) on delete restrict,
  is_open boolean not null,
  -- Optional in S-06; an omitted answer must not be coerced to "normal".
  crowd_level smallint check (crowd_level is null or crowd_level between 0 and 2),
  observed_at timestamptz not null,
  reporter_hash text not null check (reporter_hash ~ '^[0-9a-f]{64}$'),
  client_request_id uuid not null unique,
  attestation_state public.attestation_state not null default 'UNVERIFIED',
  attestation_uid text,
  created_at timestamptz not null default now(),
  check (attestation_state <> 'VERIFIED' or attestation_uid is not null)
);

create table public.shelter_checkins (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  shelter_id text not null references public.shelters (id) on delete restrict,
  checked_in_at timestamptz not null,
  actor_scope public.checkin_actor_scope not null,
  actor_ref_hash text not null check (actor_ref_hash ~ '^[0-9a-f]{64}$'),
  attestation_state public.attestation_state not null default 'UNVERIFIED',
  attestation_uid text,
  created_at timestamptz not null default now(),
  check (attestation_state <> 'VERIFIED' or attestation_uid is not null)
);

create table public.care_events (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  event_type public.care_event_type not null,
  risk_level public.risk_level not null,
  hri smallint not null check (hri between 0 and 100),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  subject_hash text not null check (subject_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now(),
  attestation_state public.attestation_state not null default 'UNVERIFIED',
  attestation_uid text,
  issuer text,
  created_at timestamptz not null default now(),
  check (attestation_state <> 'VERIFIED' or attestation_uid is not null)
);

create table public.guardian_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_transition_id uuid not null references public.alert_transitions (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  recipient_ref text not null check (recipient_ref ~ '^[0-9a-f]{64}$'),
  provider text not null default 'DEMO' check (provider = 'DEMO'),
  channel public.guardian_channel not null,
  template_key public.guardian_template not null,
  risk_level public.risk_level not null check (risk_level in ('L3', 'L4')),
  status public.guardian_alert_status not null default 'QUEUED',
  idempotency_key text not null unique,
  provider_message_id text,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  deep_link_path text not null check (
    deep_link_path like '/%'
    and deep_link_path not like '%?%'
    and deep_link_path not like '%#%'
    and deep_link_path not like '%://%'
  ),
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_until timestamptz,
  error_code text,
  recorded_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (template_key = 'HEAT_L3' and risk_level = 'L3')
    or (template_key = 'HEAT_L4' and risk_level = 'L4')
  ),
  check (
    provider <> 'DEMO'
    or (
      status not in ('ACCEPTED', 'DELIVERED')
      and sent_at is null
      and accepted_at is null
      and delivered_at is null
    )
  )
);

create table public.alert_access_tokens (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.guardian_alerts (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  exchanged_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (exchanged_at is null or revoked_at is null)
);

create table public.attestation_jobs (
  id uuid primary key default gen_random_uuid(),
  care_event_id uuid references public.care_events (id) on delete cascade,
  shelter_report_id uuid references public.shelter_reports (id) on delete cascade,
  shelter_checkin_id uuid references public.shelter_checkins (id) on delete cascade,
  state public.attestation_job_state not null default 'PENDING',
  attempt_count smallint not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  error_code text,
  idempotency_key text not null unique,
  attestation_uid text,
  transaction_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(care_event_id, shelter_report_id, shelter_checkin_id) = 1),
  check (state <> 'VERIFIED' or attestation_uid is not null)
);

create index profiles_organization_idx on public.profiles (organization_id, id);
create index subjects_organization_idx on public.subjects (organization_id, id);
create index subjects_location_gist on public.subjects using gist (location);
create index subject_assignments_profile_idx
  on public.subject_assignments (profile_id, subject_id);
create index shelters_location_gist on public.shelters using gist (location);
create index shelters_filter_idx on public.shelters (gu, is_im_bank, facility_type);
create index medication_scans_subject_time_idx
  on public.medication_scan_sessions (subject_id, created_at desc);
create index medications_subject_time_idx
  on public.medications (subject_id, created_at desc);
create index medication_api_cache_expiry_idx on public.medication_api_cache (expires_at);
create index weather_location_time_idx
  on public.weather_snapshots (location_key, source, observed_at desc);
create index weather_village_time_idx
  on public.weather_snapshots (kma_nx, kma_ny, observed_at desc);
create index risk_subject_time_idx
  on public.risk_snapshots (subject_id, computed_at desc);
create index risk_input_hash_idx on public.risk_snapshots (input_hash);
create index alert_transitions_subject_time_idx
  on public.alert_transitions (subject_id, occurred_at desc);
create index shelter_reports_latest_idx
  on public.shelter_reports (shelter_id, observed_at desc);
create index shelter_checkins_subject_time_idx
  on public.shelter_checkins (subject_id, checked_in_at desc)
  where attestation_state = 'VERIFIED';
create index care_events_subject_time_idx
  on public.care_events (subject_id, occurred_at desc);
create index guardian_alerts_work_idx
  on public.guardian_alerts (status, next_attempt_at)
  where status in ('QUEUED', 'RETRY_WAIT');
create index attestation_jobs_work_idx
  on public.attestation_jobs (state, next_attempt_at)
  where state in ('PENDING', 'RETRY_WAIT');

create or replace function private.reject_future_timestamp()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  event_time timestamptz;
begin
  event_time := (to_jsonb(new) ->> tg_argv[0])::timestamptz;
  if event_time > clock_timestamp() then
    raise exception using errcode = '22007', message = 'event timestamp cannot be in the future';
  end if;
  return new;
end;
$$;

create trigger weather_observed_at_not_future
before insert or update of observed_at on public.weather_snapshots
for each row execute function private.reject_future_timestamp('observed_at');

create trigger shelter_report_observed_at_not_future
before insert or update of observed_at on public.shelter_reports
for each row execute function private.reject_future_timestamp('observed_at');

create trigger shelter_checkin_not_future
before insert or update of checked_in_at on public.shelter_checkins
for each row execute function private.reject_future_timestamp('checked_in_at');

create trigger alert_transition_not_future
before insert or update of occurred_at on public.alert_transitions
for each row execute function private.reject_future_timestamp('occurred_at');

create trigger care_event_not_future
before insert or update of occurred_at on public.care_events
for each row execute function private.reject_future_timestamp('occurred_at');

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger subjects_set_updated_at
before update on public.subjects
for each row execute function private.set_updated_at();

create trigger shelters_set_updated_at
before update on public.shelters
for each row execute function private.set_updated_at();

create trigger medication_scans_set_updated_at
before update on public.medication_scan_sessions
for each row execute function private.set_updated_at();

create trigger medications_set_updated_at
before update on public.medications
for each row execute function private.set_updated_at();

create trigger guardian_alerts_set_updated_at
before update on public.guardian_alerts
for each row execute function private.set_updated_at();

create trigger attestation_jobs_set_updated_at
before update on public.attestation_jobs
for each row execute function private.set_updated_at();

create or replace function private.set_subject_pii_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if row(
    new.name,
    new.birth_year,
    new.sex,
    new.phone,
    new.guardian_phone,
    new.address,
    new.location,
    new.consented_at
  ) is distinct from row(
    old.name,
    old.birth_year,
    old.sex,
    old.phone,
    old.guardian_phone,
    old.address,
    old.location,
    old.consented_at
  ) then
    new.pii_updated_at := now();
  end if;
  return new;
end;
$$;

create trigger subjects_set_pii_updated_at
before update on public.subjects
for each row execute function private.set_subject_pii_updated_at();

revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
