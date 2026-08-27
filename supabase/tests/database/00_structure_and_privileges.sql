begin;

set local search_path = public, extensions, pg_catalog;

select plan(118);

-- The complete Phase 2 model must be present before behavioral RLS tests run.
select has_table(
  'public',
  table_name,
  format('public.%s exists', table_name)
)
from unnest(array[
  'organizations',
  'profiles',
  'subjects',
  'subject_assignments',
  'subject_registration_receipts',
  'shelters',
  'medication_scan_sessions',
  'medication_image_cleanup_jobs',
  'medications',
  'medication_api_cache',
  'weather_snapshots',
  'risk_snapshots',
  'alert_transitions',
  'shelter_reports',
  'shelter_checkins',
  'care_events',
  'guardian_alerts',
  'alert_access_tokens',
  'attestation_jobs'
]::text[]) as required_tables(table_name);

-- Every table in the exposed public schema uses RLS, including server-only tables.
select ok(
  relation.relrowsecurity,
  format('public.%s has RLS enabled', required_tables.table_name)
)
from unnest(array[
  'organizations',
  'profiles',
  'subjects',
  'subject_assignments',
  'subject_registration_receipts',
  'shelters',
  'medication_scan_sessions',
  'medication_image_cleanup_jobs',
  'medications',
  'medication_api_cache',
  'weather_snapshots',
  'risk_snapshots',
  'alert_transitions',
  'shelter_reports',
  'shelter_checkins',
  'care_events',
  'guardian_alerts',
  'alert_access_tokens',
  'attestation_jobs'
]::text[]) as required_tables(table_name)
join pg_namespace as namespace
  on namespace.nspname = 'public'
join pg_class as relation
  on relation.relnamespace = namespace.oid
 and relation.relname = required_tables.table_name;

select ok(
  relation.relforcerowsecurity,
  format('public.%s forces RLS for non-bypass owners', required_tables.table_name)
)
from unnest(array[
  'organizations',
  'profiles',
  'subjects',
  'subject_assignments',
  'subject_registration_receipts',
  'shelters',
  'medication_scan_sessions',
  'medication_image_cleanup_jobs',
  'medications',
  'medication_api_cache',
  'weather_snapshots',
  'risk_snapshots',
  'alert_transitions',
  'shelter_reports',
  'shelter_checkins',
  'care_events',
  'guardian_alerts',
  'alert_access_tokens',
  'attestation_jobs'
]::text[]) as required_tables(table_name)
join pg_namespace as namespace
  on namespace.nspname = 'public'
join pg_class as relation
  on relation.relnamespace = namespace.oid
 and relation.relname = required_tables.table_name;

-- Exact policy inventories catch both missing authorization and accidental
-- permissive policies. Empty arrays are intentional for server-only tables.
select policies_are(
  'public',
  table_name,
  expected_policies,
  format('public.%s has only the intended RLS policies', table_name)
)
from (
  values
    (
      'organizations',
      array['organizations_read_own']::text[]
    ),
    (
      'profiles',
      array['profiles_read_permitted', 'profiles_update_permitted']::text[]
    ),
    (
      'subjects',
      array['subjects_read_permitted', 'subjects_update_permitted']::text[]
    ),
    (
      'subject_assignments',
      array[
        'assignments_read_permitted',
        'assignments_insert_admin',
        'assignments_delete_admin'
      ]::text[]
    ),
    (
      'subject_registration_receipts',
      array[]::text[]
    ),
    (
      'shelters',
      array[]::text[]
    ),
    (
      'medication_scan_sessions',
      array['medication_scans_read_permitted']::text[]
    ),
    (
      'medication_image_cleanup_jobs',
      array[]::text[]
    ),
    (
      'medications',
      array['medications_read_permitted']::text[]
    ),
    (
      'medication_api_cache',
      array[]::text[]
    ),
    (
      'weather_snapshots',
      array[]::text[]
    ),
    (
      'risk_snapshots',
      array['risk_snapshots_read_permitted']::text[]
    ),
    (
      'alert_transitions',
      array['alert_transitions_read_permitted']::text[]
    ),
    (
      'shelter_reports',
      array[]::text[]
    ),
    (
      'shelter_checkins',
      array['shelter_checkins_read_permitted']::text[]
    ),
    (
      'care_events',
      array['care_events_read_permitted']::text[]
    ),
    (
      'guardian_alerts',
      array['guardian_alerts_read_permitted']::text[]
    ),
    (
      'alert_access_tokens',
      array[]::text[]
    ),
    (
      'attestation_jobs',
      array[]::text[]
    )
) as policy_contract(table_name, expected_policies);

-- Background workers use service_role. It needs all CRUD capabilities on every
-- Phase 2 table while browser roles retain narrow, column-scoped grants.
select ok(
  has_table_privilege(
    'service_role',
    format('public.%I', table_name),
    'SELECT'
  )
  and has_table_privilege(
    'service_role',
    format('public.%I', table_name),
    'INSERT'
  )
  and has_table_privilege(
    'service_role',
    format('public.%I', table_name),
    'UPDATE'
  )
  and has_table_privilege(
    'service_role',
    format('public.%I', table_name),
    'DELETE'
  ),
  format('service_role has CRUD privileges on public.%s', table_name)
)
from unnest(array[
  'organizations',
  'profiles',
  'subjects',
  'subject_assignments',
  'subject_registration_receipts',
  'shelters',
  'medication_scan_sessions',
  'medication_image_cleanup_jobs',
  'medications',
  'medication_api_cache',
  'weather_snapshots',
  'risk_snapshots',
  'alert_transitions',
  'shelter_reports',
  'shelter_checkins',
  'care_events',
  'guardian_alerts',
  'alert_access_tokens',
  'attestation_jobs'
]::text[]) as service_tables(table_name);

select is_empty(
  $$
    select distinct column_name::text
    from information_schema.column_privileges
    where table_schema = 'public'
      and table_name = 'shelters'
      and grantee = 'anon'
      and privilege_type = 'SELECT'
  $$,
  'Phase 5 removes direct anon shelter columns in favor of the server DTO RPC'
);

select ok(
  not has_column_privilege('anon', 'public.shelters', column_name, 'SELECT'),
  format('anon cannot read shelters.%s', column_name)
)
from unnest(array[
  'source_geo_idn',
  'geocode_result',
  'imported_at',
  'updated_at'
]::text[]) as private_shelter_columns(column_name);

select ok(
  not has_table_privilege(
    'anon',
    format('public.%I', table_name),
    'SELECT'
  ),
  format('anon has no SELECT privilege on public.%s', table_name)
)
from unnest(array[
  'subjects',
  'subject_registration_receipts',
  'medication_image_cleanup_jobs',
  'medication_api_cache',
  'shelter_reports',
  'alert_access_tokens',
  'attestation_jobs'
]::text[]) as anon_denied_tables(table_name);

select ok(
  not has_table_privilege(
    'authenticated',
    format('public.%I', table_name),
    'SELECT'
  ),
  format('authenticated has no SELECT privilege on server-only public.%s', table_name)
)
from unnest(array[
  'subject_registration_receipts',
  'medication_image_cleanup_jobs',
  'medication_api_cache',
  'weather_snapshots',
  'shelter_reports',
  'alert_access_tokens',
  'attestation_jobs'
]::text[]) as authenticated_denied_tables(table_name);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE'),
  'anon has no USAGE privilege on the private schema'
);

select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated can resolve explicitly granted private authorization helpers'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.can_access_subject(uuid)',
    'EXECUTE'
  ),
  'anon cannot execute the subject authorization helper'
);

select ok(
  has_function_privilege(
    'authenticated',
    'private.can_access_subject(uuid)',
    'EXECUTE'
  ),
  'authenticated can execute the subject authorization helper'
);

select * from finish();
rollback;
