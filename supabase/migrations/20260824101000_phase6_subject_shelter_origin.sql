-- A subject location is private. Only trusted server code may resolve the
-- coordinate after it has independently authorized the requesting staff user.
create or replace function public.get_subject_shelter_origin(p_subject_id uuid)
returns table(latitude double precision, longitude double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select
    extensions.st_y(s.location::extensions.geometry) as latitude,
    extensions.st_x(s.location::extensions.geometry) as longitude
  from public.subjects as s
  where s.id = p_subject_id
  limit 1;
$$;

revoke execute on function public.get_subject_shelter_origin(uuid)
from public, anon, authenticated;
grant execute on function public.get_subject_shelter_origin(uuid)
to service_role;
