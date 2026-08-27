-- Phase 3 durable state for risk episodes, one-time dashboard acknowledgement,
-- and server-only batch audit summaries.
create table public.risk_episodes (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects (id) on delete cascade,
  entry_level public.risk_level not null check (entry_level in ('L3', 'L4')),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, subject_id),
  check (ended_at is null or ended_at >= started_at)
);

create unique index risk_episodes_one_active_subject_idx
  on public.risk_episodes (subject_id)
  where ended_at is null;
create index risk_episodes_subject_time_idx
  on public.risk_episodes (subject_id, started_at desc);

alter table public.alert_transitions
  add constraint alert_transitions_episode_subject_fk
  foreign key (episode_id, subject_id)
  references public.risk_episodes (id, subject_id)
  on delete cascade;

alter table public.alert_transitions
  add constraint alert_transitions_id_subject_unique unique (id, subject_id);

alter table public.care_events
  add column alert_transition_id uuid;

alter table public.care_events
  add constraint care_events_alert_transition_subject_fk
  foreign key (alert_transition_id, subject_id)
  references public.alert_transitions (id, subject_id)
  on delete cascade;

create unique index care_events_alert_transition_idx
  on public.care_events (alert_transition_id)
  where alert_transition_id is not null;

create table public.alert_transition_acknowledgements (
  alert_transition_id uuid not null references public.alert_transitions (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (alert_transition_id, profile_id)
);

create index alert_transition_ack_profile_time_idx
  on public.alert_transition_acknowledgements (profile_id, acknowledged_at desc);

create table public.risk_batch_runs (
  id uuid primary key,
  status text not null check (status in ('COMPLETED', 'PARTIAL', 'SKIPPED_LOCKED')),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  total_subjects integer not null check (total_subjects >= 0),
  succeeded_subjects integer not null check (succeeded_subjects >= 0),
  failed_subjects integer not null check (failed_subjects >= 0),
  duplicate_snapshots integer not null check (duplicate_snapshots >= 0),
  transition_count integer not null check (transition_count >= 0),
  failed_subject_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  check (finished_at >= started_at),
  check (succeeded_subjects + failed_subjects = total_subjects),
  check (cardinality(failed_subject_ids) = failed_subjects)
);

create index risk_batch_runs_started_at_idx
  on public.risk_batch_runs (started_at desc);

create table public.risk_batch_locks (
  lock_key text primary key check (lock_key = 'risk-recompute'),
  owner_id uuid not null,
  acquired_at timestamptz not null,
  lease_until timestamptz not null,
  check (lease_until > acquired_at)
);

create trigger risk_episode_started_at_not_future
before insert or update of started_at on public.risk_episodes
for each row execute function private.reject_future_timestamp('started_at');

create trigger risk_episode_ended_at_not_future
before insert or update of ended_at on public.risk_episodes
for each row execute function private.reject_future_timestamp('ended_at');

create trigger alert_transition_ack_not_future
before insert or update of acknowledged_at on public.alert_transition_acknowledgements
for each row execute function private.reject_future_timestamp('acknowledged_at');

create trigger risk_batch_started_at_not_future
before insert or update of started_at on public.risk_batch_runs
for each row execute function private.reject_future_timestamp('started_at');

create trigger risk_batch_finished_at_not_future
before insert or update of finished_at on public.risk_batch_runs
for each row execute function private.reject_future_timestamp('finished_at');

alter table public.risk_episodes enable row level security;
alter table public.risk_episodes force row level security;
alter table public.alert_transition_acknowledgements enable row level security;
alter table public.alert_transition_acknowledgements force row level security;
alter table public.risk_batch_runs enable row level security;
alter table public.risk_batch_runs force row level security;
alter table public.risk_batch_locks enable row level security;
alter table public.risk_batch_locks force row level security;

revoke all on table public.risk_episodes from public, anon, authenticated;
revoke all on table public.alert_transition_acknowledgements from public, anon, authenticated;
revoke all on table public.risk_batch_runs from public, anon, authenticated;
revoke all on table public.risk_batch_locks from public, anon, authenticated;

grant all on table
  public.risk_episodes,
  public.alert_transition_acknowledgements,
  public.risk_batch_runs,
  public.risk_batch_locks
to service_role;

grant select (id, subject_id, entry_level, started_at, ended_at, created_at)
on public.risk_episodes to authenticated;

grant select (alert_transition_id, profile_id, acknowledged_at, created_at)
on public.alert_transition_acknowledgements to authenticated;
grant insert (alert_transition_id, profile_id, acknowledged_at)
on public.alert_transition_acknowledgements to authenticated;

grant select (alert_transition_id)
on public.care_events to authenticated;

create policy risk_episodes_read_permitted
on public.risk_episodes
for select
to authenticated
using ((select private.can_access_subject(subject_id)));

create policy alert_transition_ack_read_permitted
on public.alert_transition_acknowledgements
for select
to authenticated
using (
  exists (
    select 1
    from public.alert_transitions as risk_transition
    where risk_transition.id = alert_transition_id
      and (select private.can_access_subject(risk_transition.subject_id))
  )
);

create policy alert_transition_ack_insert_self
on public.alert_transition_acknowledgements
for insert
to authenticated
with check (
  profile_id = (select auth.uid())
  and exists (
    select 1
    from public.alert_transitions as risk_transition
    where risk_transition.id = alert_transition_id
      and (select private.can_access_subject(risk_transition.subject_id))
  )
);

create or replace function public.load_risk_subject_core(
  p_subject_id uuid,
  p_computed_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'subject', jsonb_build_object(
      'id', subject.id,
      'birth_year', subject.birth_year,
      'lives_alone', subject.lives_alone,
      'chronic_disease', subject.chronic_disease,
      'has_cooling', subject.has_cooling,
      'medication_profile_registered_at', subject.medication_profile_registered_at,
      'longitude', extensions.st_x(subject.location::extensions.geometry),
      'latitude', extensions.st_y(subject.location::extensions.geometry),
      'kma_nx', subject.kma_nx,
      'kma_ny', subject.kma_ny
    ),
    'medications', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'heat_class', medication.heat_class,
          'risk_tier', medication.risk_tier
        )
        order by medication.heat_class nulls last, medication.id
      )
      from public.medications as medication
      where medication.subject_id = subject.id
    ), '[]'::jsonb),
    'shelter_checkins', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'checked_in_at', checkin.checked_in_at,
          'attestation_state', checkin.attestation_state
        )
        order by checkin.checked_in_at desc, checkin.id
      )
      from public.shelter_checkins as checkin
      where checkin.subject_id = subject.id
        and checkin.attestation_state = 'VERIFIED'
        and checkin.checked_in_at >= p_computed_at - interval '24 hours'
        and checkin.checked_in_at <= p_computed_at
    ), '[]'::jsonb)
  )
  from public.subjects as subject
  where subject.id = p_subject_id
  limit 1
$$;

create or replace function public.load_risk_history(
  p_subject_id uuid,
  p_computed_at timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'previous_snapshot', (
      select jsonb_build_object(
        'level', snapshot.level,
        'computed_at', snapshot.computed_at
      )
      from public.risk_snapshots as snapshot
      where snapshot.subject_id = p_subject_id
        and snapshot.computed_at <= p_computed_at
      order by snapshot.computed_at desc, snapshot.id desc
      limit 1
    ),
    'last_safe_snapshot', (
      select jsonb_build_object(
        'level', snapshot.level,
        'computed_at', snapshot.computed_at
      )
      from public.risk_snapshots as snapshot
      where snapshot.subject_id = p_subject_id
        and snapshot.computed_at <= p_computed_at
        and snapshot.level in ('L0', 'L1', 'L2')
      order by snapshot.computed_at desc, snapshot.id desc
      limit 1
    ),
    'active_episode', (
      select jsonb_build_object(
        'id', episode.id,
        'started_at', episode.started_at
      )
      from public.risk_episodes as episode
      where episode.subject_id = p_subject_id
        and episode.ended_at is null
      order by episode.started_at desc
      limit 1
    ),
    'episode_transitions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'transition_type', risk_transition.transition_type,
          'to_level', risk_transition.to_level,
          'occurred_at', risk_transition.occurred_at
        )
        order by risk_transition.occurred_at, risk_transition.id
      )
      from public.alert_transitions as risk_transition
      where risk_transition.episode_id = (
        select episode.id
        from public.risk_episodes as episode
        where episode.subject_id = p_subject_id
          and episode.ended_at is null
        order by episode.started_at desc
        limit 1
      )
    ), '[]'::jsonb)
  )
$$;

create or replace function public.commit_risk_computation(p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snapshot jsonb := p_command -> 'snapshot';
  v_episode_mutation jsonb := p_command -> 'episode_mutation';
  v_transition jsonb := p_command -> 'transition';
  v_subject_id uuid;
  v_snapshot_id bigint;
  v_snapshot_inserted boolean := false;
  v_transition_id uuid;
  v_transition_inserted boolean := false;
  v_has_transition boolean;
  v_result jsonb;
begin
  if jsonb_typeof(p_command) <> 'object'
    or jsonb_typeof(v_snapshot) <> 'object'
    or jsonb_typeof(v_episode_mutation) <> 'object'
  then
    raise exception using errcode = '22023', message = 'invalid risk commit command';
  end if;

  v_subject_id := (v_snapshot ->> 'subject_id')::uuid;
  v_has_transition := coalesce(jsonb_typeof(v_transition) <> 'null', false);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_subject_id::text, 0)
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
    (v_snapshot ->> 'weather_snapshot_id')::bigint,
    (v_snapshot ->> 'hri')::smallint,
    (v_snapshot ->> 'level')::public.risk_level,
    v_snapshot -> 'breakdown',
    array(select jsonb_array_elements_text(v_snapshot -> 'reasons')),
    v_snapshot ->> 'input_hash',
    (v_snapshot ->> 'bucket_start')::timestamptz,
    (v_snapshot ->> 'computed_at')::timestamptz
  )
  on conflict (subject_id, bucket_start, input_hash) do nothing
  returning id into v_snapshot_id;
  v_snapshot_inserted := found;

  if not v_snapshot_inserted then
    select snapshot.id
    into strict v_snapshot_id
    from public.risk_snapshots as snapshot
    where snapshot.subject_id = v_subject_id
      and snapshot.bucket_start = (v_snapshot ->> 'bucket_start')::timestamptz
      and snapshot.input_hash = v_snapshot ->> 'input_hash';
  end if;

  case v_episode_mutation ->> 'kind'
    when 'START' then
      if (v_episode_mutation -> 'episode' ->> 'subject_id')::uuid <> v_subject_id then
        raise exception using errcode = '22023', message = 'episode subject mismatch';
      end if;
      insert into public.risk_episodes (id, subject_id, entry_level, started_at)
      values (
        (v_episode_mutation -> 'episode' ->> 'id')::uuid,
        v_subject_id,
        (v_episode_mutation -> 'episode' ->> 'entry_level')::public.risk_level,
        (v_episode_mutation -> 'episode' ->> 'started_at')::timestamptz
      )
      on conflict do nothing;
    when 'END' then
      update public.risk_episodes as episode
      set ended_at = (v_episode_mutation ->> 'ended_at')::timestamptz
      where episode.id = (v_episode_mutation ->> 'episode_id')::uuid
        and episode.subject_id = v_subject_id
        and episode.ended_at is null;
    when 'NONE' then
      null;
    else
      raise exception using errcode = '22023', message = 'invalid episode mutation';
  end case;

  if v_has_transition then
    if (v_transition ->> 'subject_id')::uuid <> v_subject_id then
      raise exception using errcode = '22023', message = 'risk event mismatch';
    end if;

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
      (v_transition ->> 'episode_id')::uuid,
      (v_transition ->> 'episode_started_at')::timestamptz,
      (v_transition ->> 'from_level')::public.risk_level,
      (v_transition ->> 'to_level')::public.risk_level,
      (v_transition ->> 'transition_type')::public.alert_transition_type,
      v_transition ->> 'idempotency_key',
      (v_transition ->> 'occurred_at')::timestamptz
    )
    on conflict (idempotency_key) do nothing
    returning id into v_transition_id;
    v_transition_inserted := found;

    if not v_transition_inserted then
      select risk_transition.id
      into strict v_transition_id
      from public.alert_transitions as risk_transition
      where risk_transition.idempotency_key = v_transition ->> 'idempotency_key';
    end if;

  end if;

  select jsonb_build_object(
    'snapshot_inserted', v_snapshot_inserted,
    'transition_inserted', v_transition_inserted,
    'snapshot', jsonb_build_object(
      'subject_id', snapshot.subject_id,
      'weather_snapshot_id', snapshot.weather_snapshot_id,
      'hri', snapshot.hri,
      'level', snapshot.level,
      'breakdown', snapshot.breakdown,
      'reasons', snapshot.reasons,
      'input_hash', snapshot.input_hash,
      'bucket_start', snapshot.bucket_start,
      'computed_at', snapshot.computed_at
    )
  )
  into strict v_result
  from public.risk_snapshots as snapshot
  where snapshot.id = v_snapshot_id;

  return v_result;
end;
$$;

create or replace function public.try_acquire_risk_batch_lock(
  p_lock_key text,
  p_owner_id uuid,
  p_acquired_at timestamptz,
  p_lease_until timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.risk_batch_locks (lock_key, owner_id, acquired_at, lease_until)
  values (p_lock_key, p_owner_id, p_acquired_at, p_lease_until)
  on conflict (lock_key) do update
  set
    owner_id = excluded.owner_id,
    acquired_at = excluded.acquired_at,
    lease_until = excluded.lease_until
  where public.risk_batch_locks.lease_until <= excluded.acquired_at
    or public.risk_batch_locks.owner_id = excluded.owner_id;
  return found;
end;
$$;

create or replace function public.release_risk_batch_lock(
  p_lock_key text,
  p_owner_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.risk_batch_locks as batch_lock
  where batch_lock.lock_key = p_lock_key
    and batch_lock.owner_id = p_owner_id;
  return found;
end;
$$;

revoke all on function public.load_risk_subject_core(uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.load_risk_history(uuid, timestamptz)
from public, anon, authenticated;
revoke all on function public.commit_risk_computation(jsonb)
from public, anon, authenticated;
revoke all on function public.try_acquire_risk_batch_lock(text, uuid, timestamptz, timestamptz)
from public, anon, authenticated;
revoke all on function public.release_risk_batch_lock(text, uuid)
from public, anon, authenticated;

grant execute on function public.load_risk_subject_core(uuid, timestamptz)
to service_role;
grant execute on function public.load_risk_history(uuid, timestamptz)
to service_role;
grant execute on function public.commit_risk_computation(jsonb)
to service_role;
grant execute on function public.try_acquire_risk_batch_lock(text, uuid, timestamptz, timestamptz)
to service_role;
grant execute on function public.release_risk_batch_lock(text, uuid)
to service_role;
