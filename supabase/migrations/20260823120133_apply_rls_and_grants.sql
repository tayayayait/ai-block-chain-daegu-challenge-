-- Authorization is derived from auth.uid() joined to public.profiles. JWT
-- user metadata is intentionally not an authorization source.
create or replace function private.current_profile_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles as p
  where p.id = (select auth.uid())
  limit 1
$$;

create or replace function private.current_profile_role()
returns public.profile_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
  limit 1
$$;

create or replace function private.is_organization_admin(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.organization_id = target_organization_id
      and p.role = 'ADMIN'
  ), false)
$$;

create or replace function private.can_access_subject(target_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
    select 1
    from public.profiles as p
    join public.subjects as s
      on s.organization_id = p.organization_id
    where p.id = (select auth.uid())
      and s.id = target_subject_id
      and (
        p.role = 'ADMIN'
        or exists (
          select 1
          from public.subject_assignments as assignment
          where assignment.subject_id = s.id
            and assignment.profile_id = p.id
            and assignment.organization_id = p.organization_id
        )
      )
  ), false)
$$;

revoke all on function private.current_profile_org_id() from public, anon, authenticated;
revoke all on function private.current_profile_role() from public, anon, authenticated;
revoke all on function private.is_organization_admin(uuid) from public, anon, authenticated;
revoke all on function private.can_access_subject(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.current_profile_org_id() to authenticated;
grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.is_organization_admin(uuid) to authenticated;
grant execute on function private.can_access_subject(uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.subjects enable row level security;
alter table public.subjects force row level security;
alter table public.subject_assignments enable row level security;
alter table public.subject_assignments force row level security;
alter table public.shelters enable row level security;
alter table public.shelters force row level security;
alter table public.medication_scan_sessions enable row level security;
alter table public.medication_scan_sessions force row level security;
alter table public.medications enable row level security;
alter table public.medications force row level security;
alter table public.medication_api_cache enable row level security;
alter table public.medication_api_cache force row level security;
alter table public.weather_snapshots enable row level security;
alter table public.weather_snapshots force row level security;
alter table public.risk_snapshots enable row level security;
alter table public.risk_snapshots force row level security;
alter table public.alert_transitions enable row level security;
alter table public.alert_transitions force row level security;
alter table public.shelter_reports enable row level security;
alter table public.shelter_reports force row level security;
alter table public.shelter_checkins enable row level security;
alter table public.shelter_checkins force row level security;
alter table public.care_events enable row level security;
alter table public.care_events force row level security;
alter table public.guardian_alerts enable row level security;
alter table public.guardian_alerts force row level security;
alter table public.alert_access_tokens enable row level security;
alter table public.alert_access_tokens force row level security;
alter table public.attestation_jobs enable row level security;
alter table public.attestation_jobs force row level security;

revoke all on table public.organizations from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.subjects from anon, authenticated;
revoke all on table public.subject_assignments from anon, authenticated;
revoke all on table public.shelters from anon, authenticated;
revoke all on table public.medication_scan_sessions from anon, authenticated;
revoke all on table public.medications from anon, authenticated;
revoke all on table public.medication_api_cache from anon, authenticated;
revoke all on table public.weather_snapshots from anon, authenticated;
revoke all on table public.risk_snapshots from anon, authenticated;
revoke all on table public.alert_transitions from anon, authenticated;
revoke all on table public.shelter_reports from anon, authenticated;
revoke all on table public.shelter_checkins from anon, authenticated;
revoke all on table public.care_events from anon, authenticated;
revoke all on table public.guardian_alerts from anon, authenticated;
revoke all on table public.alert_access_tokens from anon, authenticated;
revoke all on table public.attestation_jobs from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant all on table
  public.organizations,
  public.profiles,
  public.subjects,
  public.subject_assignments,
  public.shelters,
  public.medication_scan_sessions,
  public.medications,
  public.medication_api_cache,
  public.weather_snapshots,
  public.risk_snapshots,
  public.alert_transitions,
  public.shelter_reports,
  public.shelter_checkins,
  public.care_events,
  public.guardian_alerts,
  public.alert_access_tokens,
  public.attestation_jobs
to service_role;
grant all on all sequences in schema public to service_role;

grant select (id, name, created_at)
on public.organizations to authenticated;

grant select (id, organization_id, role, display_name, created_at, updated_at)
on public.profiles to authenticated;
grant update (display_name)
on public.profiles to authenticated;

-- PII columns (name, birth year, phone, address, location and consent) are
-- deliberately absent. Server DTO functions perform masking and explicit reveal.
grant select (
  id,
  organization_id,
  sex,
  lives_alone,
  chronic_disease,
  has_cooling,
  senior_mode,
  medication_profile_registered_at,
  created_at,
  updated_at
)
on public.subjects to authenticated;
grant update (
  lives_alone,
  chronic_disease,
  has_cooling,
  senior_mode,
  medication_profile_registered_at
)
on public.subjects to authenticated;

grant select (organization_id, subject_id, profile_id, assigned_at)
on public.subject_assignments to authenticated;
grant insert (organization_id, subject_id, profile_id, assigned_at)
on public.subject_assignments to authenticated;
grant delete on public.subject_assignments to authenticated;

grant select (
  id,
  name,
  gu,
  facility_type,
  is_im_bank,
  road_address,
  location,
  kma_nx,
  kma_ny
)
on public.shelters to anon, authenticated;

grant select (
  id,
  subject_id,
  image_quality,
  status,
  attempt_count,
  purge_after,
  image_deleted_at,
  created_at,
  updated_at
)
on public.medication_scan_sessions to authenticated;

grant select (
  id,
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
on public.medications to authenticated;

grant select (
  id,
  subject_id,
  weather_snapshot_id,
  hri,
  level,
  breakdown,
  reasons,
  bucket_start,
  computed_at
)
on public.risk_snapshots to authenticated;

grant select (
  id,
  subject_id,
  episode_id,
  episode_started_at,
  from_level,
  to_level,
  transition_type,
  occurred_at
)
on public.alert_transitions to authenticated;

grant select (
  id,
  subject_id,
  shelter_id,
  checked_in_at,
  actor_scope,
  attestation_state,
  attestation_uid,
  created_at
)
on public.shelter_checkins to authenticated;

grant select (
  id,
  subject_id,
  event_type,
  risk_level,
  hri,
  occurred_at,
  attestation_state,
  attestation_uid,
  issuer,
  created_at
)
on public.care_events to authenticated;

grant select (
  id,
  alert_transition_id,
  subject_id,
  channel,
  template_key,
  risk_level,
  status,
  recorded_at,
  created_at,
  updated_at
)
on public.guardian_alerts to authenticated;

create policy organizations_read_own
on public.organizations
for select
to authenticated
using (id = (select private.current_profile_org_id()));

create policy profiles_read_permitted
on public.profiles
for select
to authenticated
using (
  organization_id = (select private.current_profile_org_id())
  and (
    (select private.current_profile_role()) = 'ADMIN'
    or id = (select auth.uid())
  )
);

create policy profiles_update_permitted
on public.profiles
for update
to authenticated
using (
  organization_id = (select private.current_profile_org_id())
  and (
    (select private.current_profile_role()) = 'ADMIN'
    or id = (select auth.uid())
  )
)
with check (
  organization_id = (select private.current_profile_org_id())
  and (
    (select private.current_profile_role()) = 'ADMIN'
    or id = (select auth.uid())
  )
);

create policy subjects_read_permitted
on public.subjects
for select
to authenticated
using ((select private.can_access_subject(id)));

create policy subjects_update_permitted
on public.subjects
for update
to authenticated
using ((select private.can_access_subject(id)))
with check (
  organization_id = (select private.current_profile_org_id())
  and (select private.can_access_subject(id))
);

create policy assignments_read_permitted
on public.subject_assignments
for select
to authenticated
using (
  organization_id = (select private.current_profile_org_id())
  and (
    (select private.current_profile_role()) = 'ADMIN'
    or profile_id = (select auth.uid())
  )
);

create policy assignments_insert_admin
on public.subject_assignments
for insert
to authenticated
with check ((select private.is_organization_admin(organization_id)));

create policy assignments_delete_admin
on public.subject_assignments
for delete
to authenticated
using ((select private.is_organization_admin(organization_id)));

create policy shelters_public_read
on public.shelters
for select
to anon, authenticated
using (true);

create policy medication_scans_read_permitted
on public.medication_scan_sessions
for select
to authenticated
using ((select private.can_access_subject(subject_id)));

create policy medications_read_permitted
on public.medications
for select
to authenticated
using ((select private.can_access_subject(subject_id)));

create policy risk_snapshots_read_permitted
on public.risk_snapshots
for select
to authenticated
using ((select private.can_access_subject(subject_id)));

create policy alert_transitions_read_permitted
on public.alert_transitions
for select
to authenticated
using ((select private.can_access_subject(subject_id)));

create policy shelter_checkins_read_permitted
on public.shelter_checkins
for select
to authenticated
using ((select private.can_access_subject(subject_id)));

create policy care_events_read_permitted
on public.care_events
for select
to authenticated
using ((select private.can_access_subject(subject_id)));

create policy guardian_alerts_read_permitted
on public.guardian_alerts
for select
to authenticated
using ((select private.can_access_subject(subject_id)));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medication-images',
  'medication-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
