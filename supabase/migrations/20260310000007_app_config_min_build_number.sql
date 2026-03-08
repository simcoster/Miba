-- Switch from min_version to min_build_number (Expo/EAS manages build numbers)
-- When you release a new build, update min_build_number so older clients see the update prompt.
delete from public.app_config where key = 'min_version';
insert into public.app_config (key, value) values
  ('min_build_number', '1')
on conflict (key) do update set value = excluded.value;
