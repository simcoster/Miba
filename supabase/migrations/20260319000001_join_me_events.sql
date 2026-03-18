-- Join me events: timer-based events with mandatory location, auto-deletion, Mipo integration.
-- Fully reversible: see supabase/revert/20260319000001_join_me_events.sql

-- 1. activities: add join_me columns
alter table public.activities
  add column if not exists is_join_me boolean not null default false,
  add column if not exists join_me_expires_at timestamptz,
  add column if not exists join_me_mipo_linked boolean not null default false;

comment on column public.activities.is_join_me is 'True for "Join me!" events: timer-based, mandatory location, auto-deleted when timer expires.';
comment on column public.activities.join_me_expires_at is 'When the join me event auto-deletes. Null for non-join_me or Mipo-linked with unlimited timer.';
comment on column public.activities.join_me_mipo_linked is 'True when created from Mipo "invite to join"; event is deleted when Mipo visible mode turns off.';

-- 2. splash_art: add join_me_banner
alter table public.activities drop constraint if exists activities_splash_art_check;
alter table public.activities
  add constraint activities_splash_art_check
  check (splash_art is null or splash_art in (
    'banner_1', 'banner_2', 'banner_3', 'banner_4', 'banner_5', 'banner_6',
    'banner_7', 'banner_8', 'banner_9', 'banner_10', 'banner_11', 'banner_12',
    'join_me_banner'
  ));

-- 3. mipo_visible_sessions: add join_me_activity_id
alter table public.mipo_visible_sessions
  add column if not exists join_me_activity_id uuid references public.activities(id) on delete set null;

comment on column public.mipo_visible_sessions.join_me_activity_id is 'When set, links this Mipo session to a join me event. Event is deleted when session is deleted.';

create index if not exists idx_mipo_visible_sessions_join_me_activity
  on public.mipo_visible_sessions(join_me_activity_id) where join_me_activity_id is not null;

-- 4. Trigger: on mipo_visible_sessions DELETE, delete linked join me activity
create or replace function public.on_mipo_session_deleted_delete_join_me()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if old.join_me_activity_id is not null then
    delete from public.activities where id = old.join_me_activity_id;
  end if;
  return old;
end;
$$;

create trigger mipo_session_deleted_delete_join_me
  before delete on public.mipo_visible_sessions
  for each row execute function public.on_mipo_session_deleted_delete_join_me();

-- 5. Trigger: on mipo_visible_sessions UPDATE of lat/lng, sync to chat_location_shares for join me
create or replace function public.on_mipo_session_updated_sync_join_me_location()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_post_id uuid;
  v_activity_id uuid;
begin
  if new.join_me_activity_id is null then
    return new;
  end if;

  select p.id, p.activity_id into v_post_id, v_activity_id
  from public.posts p
  where p.activity_id = new.join_me_activity_id
    and p.post_type = 'live_location'
    and p.chat_closed_at is null
  limit 1;

  if v_post_id is null then
    return new;
  end if;

  insert into public.chat_location_shares (activity_id, post_id, user_id, lat, lng, updated_at)
  values (v_activity_id, v_post_id, new.user_id, new.lat, new.lng, now())
  on conflict (post_id, user_id) where (post_id is not null)
  do update set
    lat = excluded.lat,
    lng = excluded.lng,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

create trigger mipo_session_updated_sync_join_me_location
  after update of lat, lng on public.mipo_visible_sessions
  for each row execute function public.on_mipo_session_updated_sync_join_me_location();

-- 6. Function and pg_cron: delete expired join me activities
create or replace function public.cleanup_expired_join_me_activities()
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  delete from public.activities
  where is_join_me = true
    and join_me_expires_at is not null
    and join_me_expires_at <= now();
end;
$$;

-- pg_cron: run every minute (requires pg_cron extension)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('join_me_cleanup', '* * * * *', 'select public.cleanup_expired_join_me_activities()');
  end if;
end
$$;
