-- Migration — Activity exclusions (host can exclude users or circles from invite list)
-- Excluded users/circles are not invited; if already invited, their rsvp is removed by the app.

CREATE TABLE IF NOT EXISTS public.activity_exclusions (
  id          uuid        primary key default gen_random_uuid(),
  activity_id uuid        not null references public.activities(id) on delete cascade,
  user_id     uuid        references public.profiles(id) on delete cascade,
  circle_id   uuid        references public.circles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint activity_exclusions_one_target check (
    (user_id is not null and circle_id is null) or (user_id is null and circle_id is not null)
  )
);

-- Partial unique indexes: one exclusion per user/circle per activity
create unique index idx_activity_exclusions_user_unique
  on public.activity_exclusions (activity_id, user_id) where user_id is not null;
create unique index idx_activity_exclusions_circle_unique
  on public.activity_exclusions (activity_id, circle_id) where circle_id is not null;

create index idx_activity_exclusions_activity_id on public.activity_exclusions(activity_id);

comment on table public.activity_exclusions is 'Users or circles excluded from an activity invite list. Host-only. Excluded users are not invited.';

-- Only activity creator (host) can manage exclusions
alter table public.activity_exclusions enable row level security;

create policy "Host can view activity exclusions"
  on public.activity_exclusions for select using (
    exists (
      select 1 from public.activities
      where id = activity_id and created_by = auth.uid()
    )
  );

create policy "Host can insert activity exclusions"
  on public.activity_exclusions for insert with check (
    exists (
      select 1 from public.activities
      where id = activity_id and created_by = auth.uid()
    )
  );

create policy "Host can delete activity exclusions"
  on public.activity_exclusions for delete using (
    exists (
      select 1 from public.activities
      where id = activity_id and created_by = auth.uid()
    )
  );
