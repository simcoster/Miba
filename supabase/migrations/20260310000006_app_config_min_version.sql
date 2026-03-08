-- Add min_version for Supabase-based version check (replaces react-native-version-check)
-- When you release a new build, update min_version so older clients see the update prompt.
insert into public.app_config (key, value) values
  ('min_version', '1.0.2')
on conflict (key) do update set value = excluded.value;
