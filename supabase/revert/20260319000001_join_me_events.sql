-- REVERT: Join me events
-- Run manually via Supabase SQL Editor or: psql -f supabase/revert/20260319000001_join_me_events.sql

-- 1. pg_cron: unschedule job (if pg_cron exists)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('join_me_cleanup');
  end if;
end
$$;

-- 2. Drop cleanup function
drop function if exists public.cleanup_expired_join_me_activities();

-- 3. Drop mipo sync trigger
drop trigger if exists mipo_session_updated_sync_join_me_location on public.mipo_visible_sessions;
drop function if exists public.on_mipo_session_updated_sync_join_me_location();

-- 4. Drop mipo delete trigger
drop trigger if exists mipo_session_deleted_delete_join_me on public.mipo_visible_sessions;
drop function if exists public.on_mipo_session_deleted_delete_join_me();

-- 5. mipo_visible_sessions: clear and drop join_me_activity_id
update public.mipo_visible_sessions set join_me_activity_id = null where join_me_activity_id is not null;
drop index if exists public.idx_mipo_visible_sessions_join_me_activity;
alter table public.mipo_visible_sessions drop column if exists join_me_activity_id;

-- 6. activities: drop join_me columns
alter table public.activities
  drop column if exists is_join_me,
  drop column if exists join_me_expires_at,
  drop column if exists join_me_mipo_linked;

-- 7. splash_art: remove join_me_banner from constraint
alter table public.activities drop constraint if exists activities_splash_art_check;
alter table public.activities
  add constraint activities_splash_art_check
  check (splash_art is null or splash_art in (
    'banner_1', 'banner_2', 'banner_3', 'banner_4', 'banner_5', 'banner_6',
    'banner_7', 'banner_8', 'banner_9', 'banner_10', 'banner_11', 'banner_12'
  ));
