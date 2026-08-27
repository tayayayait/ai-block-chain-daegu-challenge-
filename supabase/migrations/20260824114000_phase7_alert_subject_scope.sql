-- Phase 7 hardening: resolve an alert access cookie to the minimum subject scope
-- needed for shelter search and check-in. The raw cookie, event id, alert id,
-- guardian contact data, and subject coordinates never leave the server boundary.

create or replace function public.resolve_alert_subject_session(
  p_session_hash text,
  p_now timestamptz
)
returns table (
  session_id uuid,
  subject_id uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_session_hash is null
     or p_session_hash !~ '^[0-9a-f]{64}$'
     or p_now is null then
    raise exception using errcode = '22023', message = 'invalid alert subject session request';
  end if;

  return query
  select
    access_session.id,
    guardian_alert.subject_id,
    access_session.expires_at
  from public.alert_access_sessions as access_session
  join public.guardian_alerts as guardian_alert
    on guardian_alert.id = access_session.alert_id
   and guardian_alert.alert_transition_id = access_session.event_id
  where access_session.session_hash = p_session_hash
    and access_session.revoked_at is null
    and access_session.expires_at > p_now
  limit 1;
end;
$$;

revoke all on function public.resolve_alert_subject_session(text, timestamptz)
from public, anon, authenticated;
grant execute on function public.resolve_alert_subject_session(text, timestamptz)
to service_role;
