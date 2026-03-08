-- Remove latest_version; version check uses react-native-version-check (store API)
-- Supabase only stores store URLs
delete from public.app_config where key = 'latest_version';
