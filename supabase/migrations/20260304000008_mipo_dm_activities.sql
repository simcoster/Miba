-- Mipo DM: one activity per pair of users for 1-on-1 chat from proximity
create table if not exists public.mipo_dm_activities (
  user_a_id   uuid not null references public.profiles(id) on delete cascade,
  user_b_id   uuid not null references public.profiles(id) on delete cascade,
  activity_id uuid not null references public.activities(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_a_id, user_b_id),
  check (user_a_id < user_b_id)
);
comment on table public.mipo_dm_activities is 'Mipo: maps user pairs to a shared activity for 1-on-1 chat.';

create index idx_mipo_dm_activities_activity on public.mipo_dm_activities(activity_id);

alter table public.mipo_dm_activities enable row level security;

create policy "Users can manage own mipo dm"
  on public.mipo_dm_activities for all
  using (user_a_id = auth.uid() or user_b_id = auth.uid())
  with check (user_a_id = auth.uid() or user_b_id = auth.uid());
