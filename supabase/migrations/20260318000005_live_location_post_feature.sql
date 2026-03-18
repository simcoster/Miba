-- Live location post feature: generalize messages and chat_location_shares with post_id.
-- Mipo DM: post_id IS NULL (activity-scoped). Live location post: post_id set (post-scoped).
-- Fully reversible: see supabase/revert/20260318000005_live_location_post_feature.sql

-- 1. messages: add post_id
alter table public.messages
  add column if not exists post_id uuid references public.posts(id) on delete cascade;

create index if not exists idx_messages_post_id on public.messages(post_id) where post_id is not null;

-- 2. chat_location_shares: add id (surrogate PK), post_id, expires_at; migrate PK
alter table public.chat_location_shares
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.chat_location_shares
  add column if not exists post_id uuid references public.posts(id) on delete cascade;

alter table public.chat_location_shares
  add column if not exists expires_at timestamptz;

alter table public.chat_location_shares drop constraint if exists chat_location_shares_pkey;

alter table public.chat_location_shares add primary key (id);

create unique index if not exists idx_chat_loc_unique_activity
  on public.chat_location_shares (activity_id, user_id)
  where post_id is null;

create unique index if not exists idx_chat_loc_unique_post
  on public.chat_location_shares (post_id, user_id)
  where post_id is not null;

create index if not exists idx_chat_location_shares_post_id
  on public.chat_location_shares(post_id)
  where post_id is not null;

-- 3. posts: add post_type, creator_expires_at, chat_closed_at
alter table public.posts
  add column if not exists post_type text not null default 'text'
  check (post_type in ('text', 'live_location'));

alter table public.posts
  add column if not exists creator_expires_at timestamptz;

alter table public.posts
  add column if not exists chat_closed_at timestamptz;

create unique index if not exists idx_posts_active_live_location
  on public.posts (activity_id)
  where post_type = 'live_location' and chat_closed_at is null;

-- 4. Triggers: include post_id in location share messages
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
    and (post_id is not distinct from new.post_id)
    and type = 'system'
    and content in ('location_share_started', 'location_share_stopped');
  insert into public.messages (activity_id, user_id, type, content, post_id)
  values (new.activity_id, new.user_id, 'system', 'location_share_started', new.post_id);
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
    and (post_id is not distinct from old.post_id)
    and type = 'system'
    and content in ('location_share_started', 'location_share_stopped');
  insert into public.messages (activity_id, user_id, type, content, post_id)
  values (old.activity_id, old.user_id, 'system', 'location_share_stopped', old.post_id);
  return old;
end;
$$;

-- 5. RLS: messages - when post_id set, require chat not closed
drop policy if exists "Invitees can post messages" on public.messages;
create policy "Invitees can post messages"
  on public.messages for insert
  with check (
    auth.uid() = user_id
    and public.is_activity_invitee(activity_id)
    and (
      post_id is null
      or exists (
        select 1 from public.posts p
        where p.id = post_id and p.chat_closed_at is null
      )
    )
  );

-- RLS: chat_location_shares - when post_id set, require chat not closed and activity_id matches
drop policy if exists "Invitees can insert own chat location share" on public.chat_location_shares;
create policy "Invitees can insert own chat location share"
  on public.chat_location_shares for insert
  with check (
    auth.uid() = user_id
    and public.is_activity_invitee(activity_id)
    and (
      (post_id is null)
      or (
        exists (
          select 1 from public.posts p
          where p.id = post_id and p.activity_id = activity_id and p.chat_closed_at is null
        )
      )
    )
  );
