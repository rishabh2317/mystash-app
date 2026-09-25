-- Commerce shopping country metadata (no coordinates stored).
alter table public.users
  add column if not exists country_detected_at timestamptz,
  add column if not exists last_location_check_at timestamptz,
  add column if not exists country_source text;

alter table public.users
  drop constraint if exists users_country_source_check;

alter table public.users
  add constraint users_country_source_check
  check (country_source is null or country_source in ('location', 'manual'));

comment on column public.users.country is 'ISO-3166-1 alpha-2 commerce/shopping country';
comment on column public.users.country_detected_at is 'When country was last set from device location';
comment on column public.users.last_location_check_at is 'When location was last checked (even if country unchanged)';
comment on column public.users.country_source is 'location = auto-detected; manual = user override; null = unset/legacy';
