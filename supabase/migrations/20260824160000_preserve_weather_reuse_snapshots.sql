alter table public.weather_snapshots
  drop constraint weather_snapshots_location_key_source_observed_at_key;

alter table public.weather_snapshots
  add constraint weather_snapshots_collection_unique
  unique (location_key, source, observed_at, collected_at);

comment on constraint weather_snapshots_collection_unique on public.weather_snapshots is
  'Keeps provider observations idempotent within one collection attempt while allowing later cache reuse to be recorded as a new stale snapshot.';
