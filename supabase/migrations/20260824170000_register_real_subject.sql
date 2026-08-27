-- Trusted-server boundary for registering one real subject. The calling route
-- verifies the Supabase session and re-geocodes the address; this RPC repeats
-- the durable ADMIN/organization checks and commits subject + assignment in one
-- PostgreSQL transaction.
create or replace function public.register_subject_service_role(p_command jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_profile_id uuid;
  v_organization_id uuid;
  v_subject jsonb;
  v_subject_id uuid;
  v_name text;
  v_birth_year smallint;
  v_sex public.subject_sex;
  v_phone text;
  v_guardian_phone text;
  v_address text;
  v_longitude double precision;
  v_latitude double precision;
  v_kma_nx smallint;
  v_kma_ny smallint;
  v_lives_alone boolean;
  v_chronic_disease boolean;
  v_has_cooling boolean;
  v_senior_mode boolean;
  v_consented_at timestamptz;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'subject registration is service-role only';
  end if;

  if jsonb_typeof(p_command) is distinct from 'object'
    or jsonb_typeof(p_command -> 'subject') is distinct from 'object'
  then
    raise exception using errcode = '22023', message = 'invalid subject registration command';
  end if;

  begin
    v_actor_profile_id := (p_command ->> 'actor_profile_id')::uuid;
    v_subject := p_command -> 'subject';
    v_name := btrim(v_subject ->> 'name');
    v_birth_year := (v_subject ->> 'birth_year')::smallint;
    v_sex := (v_subject ->> 'sex')::public.subject_sex;
    v_phone := nullif(v_subject ->> 'phone', '');
    v_guardian_phone := nullif(v_subject ->> 'guardian_phone', '');
    v_address := btrim(v_subject ->> 'address');
    v_longitude := (v_subject ->> 'longitude')::double precision;
    v_latitude := (v_subject ->> 'latitude')::double precision;
    v_kma_nx := (v_subject ->> 'kma_nx')::smallint;
    v_kma_ny := (v_subject ->> 'kma_ny')::smallint;
    v_lives_alone := (v_subject ->> 'lives_alone')::boolean;
    v_chronic_disease := (v_subject ->> 'chronic_disease')::boolean;
    v_has_cooling := (v_subject ->> 'has_cooling')::boolean;
    v_senior_mode := (v_subject ->> 'senior_mode')::boolean;
    v_consented_at := (v_subject ->> 'consented_at')::timestamptz;
  exception
    when others then
      raise exception using errcode = '22023', message = 'invalid subject registration command';
  end;

  select profile.organization_id
  into v_organization_id
  from public.profiles as profile
  where profile.id = v_actor_profile_id
    and profile.role = 'ADMIN'
  limit 1;

  if v_organization_id is null then
    raise exception using errcode = '42501', message = 'verified administrator required';
  end if;

  if length(v_name) not between 1 and 80
    or v_birth_year not between extract(year from current_date)::integer - 130
      and extract(year from current_date)::integer
    or (v_phone is not null and v_phone !~ '^0[0-9]{8,10}$')
    or (v_guardian_phone is not null and v_guardian_phone !~ '^0[0-9]{8,10}$')
    or length(v_address) not between 2 and 160
    or v_address not like '대구광역시 %'
    or v_longitude not between 128.2 and 129.2
    or v_latitude not between 35.4 and 36.3
    or v_kma_nx <= 0
    or v_kma_ny <= 0
    or jsonb_typeof(v_subject -> 'lives_alone') is distinct from 'boolean'
    or jsonb_typeof(v_subject -> 'chronic_disease') is distinct from 'boolean'
    or jsonb_typeof(v_subject -> 'has_cooling') is distinct from 'boolean'
    or jsonb_typeof(v_subject -> 'senior_mode') is distinct from 'boolean'
    or v_consented_at is null
    or v_consented_at > now() + interval '5 minutes'
  then
    raise exception using errcode = '22023', message = 'invalid subject registration command';
  end if;

  insert into public.subjects (
    organization_id,
    name,
    birth_year,
    sex,
    phone,
    guardian_phone,
    address,
    location,
    kma_nx,
    kma_ny,
    lives_alone,
    chronic_disease,
    has_cooling,
    senior_mode,
    consented_at
  )
  values (
    v_organization_id,
    v_name,
    v_birth_year,
    v_sex,
    v_phone,
    v_guardian_phone,
    v_address,
    extensions.st_setsrid(
      extensions.st_makepoint(v_longitude, v_latitude),
      4326
    )::extensions.geography,
    v_kma_nx,
    v_kma_ny,
    v_lives_alone,
    v_chronic_disease,
    v_has_cooling,
    v_senior_mode,
    v_consented_at
  )
  returning id into v_subject_id;

  insert into public.subject_assignments (
    organization_id,
    subject_id,
    profile_id
  )
  values (
    v_organization_id,
    v_subject_id,
    v_actor_profile_id
  );

  return v_subject_id;
end;
$$;

revoke all on function public.register_subject_service_role(jsonb)
from public, anon, authenticated;
grant execute on function public.register_subject_service_role(jsonb)
to service_role;

comment on function public.register_subject_service_role(jsonb) is
  'Service-role-only atomic registration of a Naver-confirmed Daegu subject and creator assignment.';
