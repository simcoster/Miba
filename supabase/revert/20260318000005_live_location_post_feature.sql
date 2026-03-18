-- REVERT: Live location post feature
-- Run manually via Supabase SQL Editor or: psql -f supabase/revert/20260318000005_live_location_post_feature.sql
-- WARNING: Permanently deletes all live location posts, their chat messages, and location shares.

-- 1. Data cleanup
delete from public.messages where post_id is not null;
delete from public.chat_location_shares where post_id is not null;
delete from public.posts where post_type = 'live_location';

-- 2. messages: drop post_id
drop index if exists public.idx_messages_post_id;
alter table public.messages drop column if exists post_id;

-- 3. chat_location_shares: restore original schema
drop index if exists public.idx_chat_location_shares_post_id;
drop index if exists public.idx_chat_loc_unique_activity;
drop index if exists public.idx_chat_loc_unique_post;

alter table public.chat_location_shares drop constraint if exists chat_location_shares_pkey;
alter table public.chat_location_shares add primary key (activity_id, user_id);
alter table public.chat_location_shares drop column if exists id;
alter table public.chat_location_shares drop column if exists post_id;
alter table public.chat_location_shares drop column if exists expires_at;

-- 4. posts: drop new columns
drop index if exists public.idx_posts_active_live_location;
alter table public.posts drop column if exists post_type;
alter table public.posts drop column if exists creator_expires_at;
alter table public.posts drop column if exists chat_closed_at;

-- 5. Restore triggers (original from 20260312000001, no post_id)
create or replace function public.on_chat_location_share_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.messages
  where activity_id = new.activity_id
    and user_id = new.user_id
    and type = 'system'
    and content in ('location_share_started', 'location_share_stopped');
  insert into public.messages (activity_id, user_id, type, content)
  values (new.activity_id, new.user_id, 'system', 'location_share_started');
  return new;
end;
$$;

create or replace function public.on_chat_location_share_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.messages
  where activity_id = old.activity_id
    and user_id = old.user_id
    and type = 'system'
    and content in ('location_share_started', 'location_share_stopped');
  insert into public.messages (activity_id, user_id, type, content)
  values (old.activity_id, old.user_id, 'system', 'location_share_stopped');
  return old;
end;
$$;

-- 6. Restore RLS policies
drop policy if exists "Invitees can post messages" on public.messages;
create policy "Invitees can post messages"
  on public.messages for insert
  with check (
    auth.uid() = user_id
    and public.is_activity_invitee(activity_id)
  );

drop policy if exists "Invitees can insert own chat location share" on public.chat_location_shares;
create policy "Invitees can insert own chat location share"
  on public.chat_location_shares for insert
  with check (
    auth.uid() = user_id
    and public.is_activity_invitee(activity_id)
  );
