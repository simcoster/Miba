-- App config for version check and store URLs (read by anon for pre-auth version check)
create table if not exists public.app_config (
  key text primary key,
  value text not null
);

comment on table public.app_config is 'App-wide config: store_url_ios, store_url_android. Version check uses react-native-version-check (store API).';

-- Allow anyone to read (version check runs before auth)
alter table public.app_config enable row level security;
create policy "Allow public read"
  on public.app_config for select
  to anon, authenticated
  using (true);

-- Writes via service role (EAS build hook) or Supabase dashboard bypass RLS

-- Seed initial values (TestFlight / internal testing URLs)
insert into public.app_config (key, value) values
  ('store_url_ios', 'itms-apps://beta.itunes.apple.com'),
  ('store_url_android', 'https://play.google.com/store/apps/details?id=com.miba.app')
on conflict (key) do nothing;
