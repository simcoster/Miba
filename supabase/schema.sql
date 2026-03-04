-- ============================================================
-- MIBA ("מי בא?") — Supabase Database Schema
-- Run this entire file in Supabase SQL Editor
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- TABLES
-- ============================================================

-- Profiles (one per auth.users row, auto-created via trigger)
create table public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  username    text        unique,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'Extended user profile data, one row per auth user.';

-- Circles (owner-managed contact lists used as invite shortcuts)
create table public.circles (
  id          uuid        primary key default uuid_generate_v4(),
  name        text        not null,
  description text,
  emoji       text        not null default '👥',
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
comment on table public.circles is 'A named group of contacts owned by one user. Used only as a bulk-invite shortcut when creating activities — no circle reference is stored on activities.';

-- Circle members (users in a circle — owner is NOT stored here, see circles.created_by)
create table public.circle_members (
  id         uuid        primary key default uuid_generate_v4(),
  circle_id  uuid        not null references public.circles(id) on delete cascade,
  user_id    uuid        not null references public.profiles(id) on delete cascade,
  role       text        not null default 'member' check (role = 'member'),
  joined_at  timestamptz not null default now(),
  unique (circle_id, user_id)
);
comment on table public.circle_members is 'Membership table linking users to circles. Owner is circles.created_by, not stored here.';

-- Activities (standalone events — no circle_id)
create table public.activities (
  id            uuid        primary key default uuid_generate_v4(),
  created_by    uuid        references public.profiles(id) on delete set null,
  title         text        not null,
  description   text,
  location      text,
  activity_time timestamptz not null,
  status        text        not null default 'active' check (status in ('active', 'cancelled')),
  created_at    timestamptz not null default now()
);
comment on table public.activities is 'An event created by a user. Invitees are tracked via rsvps (status=pending/in/out).';

-- RSVPs — doubles as the invite list.
--   pending = invited, no response yet
--   in      = going
--   out     = can't make it
-- The creator inserts pending rows for all invitees at creation time,
-- then each invitee updates their own row.
create table public.rsvps (
  id          uuid        primary key default uuid_generate_v4(),
  activity_id uuid        not null references public.activities(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  status      text        not null check (status in ('pending', 'in', 'out')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (activity_id, user_id)
);
comment on table public.rsvps is 'Invite list + response tracking for an activity. pending=invited, in=going, out=declined.';

-- Circle invites (invite a user by their user_id or invite code)
create table public.circle_invites (
  id              uuid        primary key default uuid_generate_v4(),
  circle_id       uuid        not null references public.circles(id) on delete cascade,
  invited_by      uuid        references public.profiles(id) on delete set null,
  invited_user_id uuid        references public.profiles(id) on delete cascade,
  invite_code     text        unique not null default encode(gen_random_bytes(6), 'hex'),
  status          text        not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '7 days')
);
comment on table public.circle_invites is 'Pending invitations to join a circle.';

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_circle_members_user_id   on public.circle_members(user_id);
create index idx_circle_members_circle_id on public.circle_members(circle_id);
create index idx_activities_created_by    on public.activities(created_by);
create index idx_activities_activity_time on public.activities(activity_time);
create index idx_rsvps_activity_id        on public.rsvps(activity_id);
create index idx_rsvps_user_id            on public.rsvps(user_id);
create index idx_circle_invites_invited_user on public.circle_invites(invited_user_id);
create index idx_circle_invites_code      on public.circle_invites(invite_code);

-- ============================================================
-- FUNCTIONS & HELPERS (defined before RLS policies that reference them)
-- ============================================================

-- Checks whether the current user is the OWNER (creator) of a circle.
-- Security definer (runs as postgres/BYPASSRLS) to avoid RLS recursion.
-- Used by: circle_members SELECT (owners see their full member list).
create or replace function public.is_circle_owner(p_circle_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.circles
    where id = p_circle_id and created_by = auth.uid()
  );
$$;

-- Checks whether the current user has an rsvp row for an activity
-- (i.e. was invited). Security definer bypasses rsvps RLS — no recursion.
-- Used by: activities SELECT, rsvps SELECT.
create or replace function public.is_activity_invitee(p_activity_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.rsvps
    where activity_id = p_activity_id and user_id = auth.uid()
  );
$$;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles       enable row level security;
alter table public.circles        enable row level security;
alter table public.circle_members enable row level security;
alter table public.activities     enable row level security;
alter table public.rsvps          enable row level security;
alter table public.circle_invites enable row level security;

-- ---------- profiles ----------
create policy "Anyone can read profiles"
  on public.profiles for select using (true);

create policy "Users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- ---------- circles ----------
-- Only the owner sees their own circles (circles are private mailing lists)
create policy "Owners can view their circles"
  on public.circles for select using (created_by = auth.uid());

create policy "Authenticated users can create circles"
  on public.circles for insert with check (auth.uid() = created_by);

create policy "Circle owners can update circles"
  on public.circles for update using (created_by = auth.uid());

create policy "Circle owners can delete circles"
  on public.circles for delete using (created_by = auth.uid());

-- ---------- circle_members ----------
-- You can see your own membership rows (know which circles you're in).
-- Circle owners can see ALL rows for their circles (to manage the member list).
create policy "Circle members can see membership"
  on public.circle_members for select using (
    user_id = auth.uid()
    OR public.is_circle_owner(circle_id)
  );

-- Owner can add members; user can add self (e.g. when accepting invite)
create policy "Owner can add members; user can add self"
  on public.circle_members for insert with check (
    public.is_circle_owner(circle_id)
    OR user_id = auth.uid()
  );

create policy "Owner or self can remove members"
  on public.circle_members for delete using (
    user_id = auth.uid()
    OR public.is_circle_owner(circle_id)
  );

-- ---------- activities ----------
-- You can see an activity if you created it or were invited (have an rsvp row)
create policy "Creators and invitees can view activities"
  on public.activities for select using (
    created_by = auth.uid()
    OR public.is_activity_invitee(id)
  );

create policy "Authenticated users can create activities"
  on public.activities for insert with check (auth.uid() = created_by);

create policy "Activity creator can update"
  on public.activities for update using (auth.uid() = created_by);

create policy "Activity creator can delete"
  on public.activities for delete using (auth.uid() = created_by);

-- ---------- rsvps ----------
-- All invitees can see the full guest list for an activity they're part of
create policy "Invitees can view RSVPs"
  on public.rsvps for select using (
    public.is_activity_invitee(activity_id)
  );

-- Activity creator can bulk-insert pending invites for others at creation time;
-- users can also insert their own response
create policy "Creator can invite; users manage own RSVP"
  on public.rsvps for insert with check (
    exists (select 1 from public.activities where id = activity_id and created_by = auth.uid())
    OR user_id = auth.uid()
  );

-- Users can only update or delete their own RSVP row
create policy "Users manage own RSVP"
  on public.rsvps for update using (auth.uid() = user_id);

create policy "Users delete own RSVP"
  on public.rsvps for delete using (auth.uid() = user_id);

-- ---------- circle_invites ----------
create policy "Involved parties can view invites"
  on public.circle_invites for select using (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
    OR public.is_circle_owner(circle_id)
    OR exists (
      select 1 from public.circle_members
      where circle_id = circle_invites.circle_id and user_id = auth.uid()
    )
  );

create policy "Circle owner can create invites"
  on public.circle_invites for insert with check (
    auth.uid() = invited_by
    AND public.is_circle_owner(circle_id)
  );

create policy "Invited user can update their invite"
  on public.circle_invites for update using (
    invited_user_id = auth.uid() or invited_by = auth.uid()
  );

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Auto-update updated_at on profiles
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger rsvps_updated_at
  before update on public.rsvps
  for each row execute function public.set_updated_at();

-- ============================================================
-- DONE — Schema created successfully
-- ============================================================
