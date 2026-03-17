-- Poster extraction usage tracking (5 per user per day for From Poster AI feature)
create table public.poster_extractions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index poster_extractions_user_created on public.poster_extractions (user_id, created_at);

comment on table public.poster_extractions is 'Tracks From Poster AI extractions per user for daily limit (5/day).';

alter table public.poster_extractions enable row level security;

create policy "Users can insert own poster extractions"
  on public.poster_extractions for insert
  with check (user_id = auth.uid());

create policy "Users can select own poster extractions"
  on public.poster_extractions for select
  using (user_id = auth.uid());
