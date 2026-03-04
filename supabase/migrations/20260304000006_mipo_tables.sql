-- ============================================================
-- Mipo feature: visible mode and proximity notifications
-- ============================================================

-- Extensions for distance calculation (Haversine)
create extension if not exists "cube";
create extension if not exists "earthdistance";

-- Mipo selections: who each user wants to be visible to (mutual = both rows exist)
create table public.mipo_selections (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references public.profiles(id) on delete cascade,
  selected_user_id  uuid        not null references public.profiles(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (user_id, selected_user_id),
  check (user_id != selected_user_id)
);
comment on table public.mipo_selections is 'Mipo: users each user has selected to be visible to. Mutual selection required for proximity notifications.';

-- Mipo visible sessions: active visibility with location
create table public.mipo_visible_sessions (
  user_id     uuid        primary key references public.profiles(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  started_at  timestamptz not null default now(),
  expires_at  timestamptz,  -- null = no limit, until turned off
  updated_at  timestamptz not null default now()
);
comment on table public.mipo_visible_sessions is 'Mipo: active visible mode sessions with current location.';

-- Mipo proximity events: when two mutually-selected users come within 100m
create table public.mipo_proximity_events (
  id          uuid        primary key default gen_random_uuid(),
  user_a_id   uuid        not null references public.profiles(id) on delete cascade,
  user_b_id   uuid        not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  check (user_a_id < user_b_id)  -- canonical order for deduplication
);
comment on table public.mipo_proximity_events is 'Mipo: proximity events when two mutually-selected users are within 100m.';

-- Push token for notifications (one per user, overwritten on re-register)
alter table public.profiles add column if not exists push_token text;

-- Indexes
create index idx_mipo_selections_user_id on public.mipo_selections(user_id);
create index idx_mipo_selections_selected on public.mipo_selections(selected_user_id);
create index idx_mipo_proximity_events_user_a on public.mipo_proximity_events(user_a_id);
create index idx_mipo_proximity_events_user_b on public.mipo_proximity_events(user_b_id);
create index idx_mipo_proximity_events_created on public.mipo_proximity_events(created_at);

-- ============================================================
-- Proximity check function (Haversine via earthdistance)
-- ============================================================
create or replace function public.mipo_check_proximity(
  p_user_id uuid,
  p_lat     double precision,
  p_lng     double precision
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_other record;
  v_dist_meters double precision;
  v_recent_exists boolean;
  v_user_a uuid;
  v_user_b uuid;
begin
  -- For each user B where (p_user_id selected B) AND (B selected p_user_id) AND (B is visible and not expired)
  for v_other in
    select s.user_id as other_id, vs.lat, vs.lng
    from public.mipo_selections s
    join public.mipo_selections s2 on s2.user_id = s.selected_user_id and s2.selected_user_id = p_user_id
    join public.mipo_visible_sessions vs on vs.user_id = s.selected_user_id
    where s.user_id = p_user_id
      and s.selected_user_id != p_user_id
      and (vs.expires_at is null or vs.expires_at > now())
  loop
    -- Distance in meters (earthdistance)
    v_dist_meters := earth_distance(
      ll_to_earth(p_lat, p_lng),
      ll_to_earth(v_other.lat, v_other.lng)
    );

    if v_dist_meters <= 100 then
      -- Canonical order for deduplication
      if p_user_id < v_other.other_id then
        v_user_a := p_user_id;
        v_user_b := v_other.other_id;
      else
        v_user_a := v_other.other_id;
        v_user_b := p_user_id;
      end if;

      -- Deduplication: no event for same pair in last 15 minutes
      select exists (
        select 1 from public.mipo_proximity_events
        where user_a_id = v_user_a and user_b_id = v_user_b
          and created_at > now() - interval '15 minutes'
      ) into v_recent_exists;

      if not v_recent_exists then
        insert into public.mipo_proximity_events (user_a_id, user_b_id)
        values (v_user_a, v_user_b);
      end if;
    end if;
  end loop;
end;
$$;

-- Trigger: run proximity check when visible session is updated
create or replace function public.mipo_on_session_updated()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.mipo_check_proximity(new.user_id, new.lat, new.lng);
  return new;
end;
$$;

create trigger mipo_session_proximity_check
  after insert or update of lat, lng on public.mipo_visible_sessions
  for each row execute function public.mipo_on_session_updated();

-- ============================================================
-- RLS
-- ============================================================
alter table public.mipo_selections       enable row level security;
alter table public.mipo_visible_sessions  enable row level security;
alter table public.mipo_proximity_events  enable row level security;

-- mipo_selections: users manage their own selections
create policy "Users manage own mipo selections"
  on public.mipo_selections for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- mipo_visible_sessions: users manage own session; others need to read for proximity (handled by function)
create policy "Users manage own mipo session"
  on public.mipo_visible_sessions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Proximity check runs as definer and reads all visible sessions - we need a policy that allows
-- the trigger/function to work. The function is security definer so it bypasses RLS.
-- For client reads: users can only see events where they are user_a or user_b
create policy "Users see own proximity events"
  on public.mipo_proximity_events for select
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

-- Inserts are done by the trigger (SECURITY DEFINER function runs as postgres, bypasses RLS).
-- No INSERT policy for clients - they cannot insert proximity events directly.

-- Enable realtime for proximity events (for in-app notifications)
alter publication supabase_realtime add table public.mipo_proximity_events;
