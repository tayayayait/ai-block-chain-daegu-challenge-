begin;

set local search_path = public, extensions, pg_catalog;
set local role service_role;

select plan(3);

select lives_ok(
  $$
    insert into public.weather_snapshots (
      location_key, source, location, kma_nx, kma_ny,
      temperature_c, humidity_pct, feels_like_c,
      observed_at, collected_at, expires_at
    )
    values
      (
        'apihub:test:history', 'KMA_APIHUB_500M',
        extensions.st_setsrid(extensions.st_makepoint(128.604, 35.874), 4326)::extensions.geography,
        89, 90, 34.5, 62, 37.1,
        '2026-08-24T05:00:00Z', '2026-08-24T05:01:00Z', '2026-08-24T06:00:00Z'
      ),
      (
        'apihub:test:history', 'KMA_APIHUB_500M',
        extensions.st_setsrid(extensions.st_makepoint(128.604, 35.874), 4326)::extensions.geography,
        89, 90, 34.5, 62, 37.1,
        '2026-08-24T05:00:00Z', '2026-08-24T05:06:00Z', '2026-08-24T06:00:00Z'
      )
  $$,
  'later collections of the same provider observation remain append-only'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.weather_snapshots
    where location_key = 'apihub:test:history'
  $$,
  array[2::bigint],
  'both collection revisions are retained'
);

select throws_ok(
  $$
    insert into public.weather_snapshots (
      location_key, source, location, kma_nx, kma_ny,
      temperature_c, humidity_pct, feels_like_c,
      observed_at, collected_at, expires_at
    )
    values (
      'apihub:test:history', 'KMA_APIHUB_500M',
      extensions.st_setsrid(extensions.st_makepoint(128.604, 35.874), 4326)::extensions.geography,
      89, 90, 34.5, 62, 37.1,
      '2026-08-24T05:00:00Z', '2026-08-24T05:06:00Z', '2026-08-24T06:00:00Z'
    )
  $$,
  '23505',
  null,
  'the exact same collection attempt remains idempotent'
);

select * from finish();
rollback;
