-- Event board: posts and comments for normal events (replaces chat)
-- Mipo DMs keep using messages table for chat

-- Posts table
create table public.posts (
  id          uuid        primary key default gen_random_uuid(),
  activity_id uuid        not null references public.activities(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  content     text        not null check (length(trim(content)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.posts is 'Board posts for normal events. Mipo DMs use messages instead.';

create index idx_posts_activity_id on public.posts(activity_id);
create index idx_posts_created_at on public.posts(created_at);

alter table public.posts enable row level security;

create policy "Invitees can read posts"
  on public.posts for select using (public.is_activity_invitee(activity_id));

create policy "Invitees can insert own posts"
  on public.posts for insert with check (
    auth.uid() = user_id and public.is_activity_invitee(activity_id)
  );

create policy "Users can update own posts"
  on public.posts for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own posts"
  on public.posts for delete using (auth.uid() = user_id);

alter publication supabase_realtime add table public.posts;

-- Post comments table (activity_id for realtime filtering)
create table public.post_comments (
  id          uuid        primary key default gen_random_uuid(),
  post_id     uuid        not null references public.posts(id) on delete cascade,
  activity_id uuid        not null references public.activities(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  content     text        not null check (length(trim(content)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.post_comments is 'Comments on board posts.';

create index idx_post_comments_post_id on public.post_comments(post_id);
create index idx_post_comments_activity_id on public.post_comments(activity_id);
create index idx_post_comments_created_at on public.post_comments(created_at);

alter table public.post_comments enable row level security;

-- Helper: can user read/write comments on this post? (invitee of the activity)
create or replace function public.is_post_comment_invitee(p_post_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.posts p
    where p.id = p_post_id and public.is_activity_invitee(p.activity_id)
  );
$$;

create policy "Invitees can read post comments"
  on public.post_comments for select using (
    public.is_post_comment_invitee(post_id)
  );

-- Trigger: set activity_id from post on insert
create or replace function public.post_comments_set_activity_id()
returns trigger language plpgsql as $$
begin
  select p.activity_id into new.activity_id from public.posts p where p.id = new.post_id;
  return new;
end;
$$;

create trigger post_comments_set_activity_id
  before insert on public.post_comments
  for each row execute function public.post_comments_set_activity_id();

create policy "Invitees can insert own comments"
  on public.post_comments for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.posts p
      where p.id = post_id and public.is_activity_invitee(p.activity_id)
    )
  );

create policy "Users can update own comments"
  on public.post_comments for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own comments"
  on public.post_comments for delete using (auth.uid() = user_id);

alter publication supabase_realtime add table public.post_comments;

-- Trigger: updated_at on posts
create or replace function public.set_posts_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger posts_updated_at
  before update on public.posts
  for each row execute function public.set_posts_updated_at();

create trigger post_comments_updated_at
  before update on public.post_comments
  for each row execute function public.set_posts_updated_at();

-- Data cleanup: delete old user chat messages for normal (non-Mipo) events
delete from public.messages
where type = 'user'
  and activity_id not in (select activity_id from public.mipo_dm_activities);
