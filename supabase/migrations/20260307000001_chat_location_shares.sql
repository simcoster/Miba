-- Chat location shares: per-activity live location sharing in Mipo DM chats.
-- When a user shares, a row is inserted; when they stop, it's deleted.
-- Triggers insert system messages for "started" and "stopped".

create table public.chat_location_shares (
  activity_id uuid        not null references public.activities(id) on delete cascade,
  user_id     uuid        not null references public.profiles(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  updated_at  timestamptz not null default now(),
  primary key (activity_id, user_id)
);

comment on table public.chat_location_shares is 'Live location sharing in activity chats. Per-activity: Dan sharing in Sally chat only creates rows for that activity.';

create index idx_chat_location_shares_activity on public.chat_location_shares(activity_id);

alter table public.chat_location_shares enable row level security;

create policy "Invitees can read chat location shares"
  on public.chat_location_shares for select
  using (public.is_activity_invitee(activity_id));

create policy "Invitees can insert own chat location share"
  on public.chat_location_shares for insert
  with check (
    auth.uid() = user_id
    and public.is_activity_invitee(activity_id)
  );

create policy "Users can update own chat location share"
  on public.chat_location_shares for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own chat location share"
  on public.chat_location_shares for delete
  using (auth.uid() = user_id);

-- Allow location_share_started and location_share_stopped system messages
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages
  add constraint messages_content_check
    check (
      (type = 'user'   and length(trim(content)) > 0)
      or
      (type = 'system' and content in (
        'event_edited', 'rsvp_changed', 'edit_suggestion',
        'location_share_started', 'location_share_stopped'
      ))
    );

-- Trigger: insert system message when user starts sharing
create or replace function public.on_chat_location_share_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.messages (activity_id, user_id, type, content)
  values (new.activity_id, new.user_id, 'system', 'location_share_started');
  return new;
end;
$$;

create trigger chat_location_share_insert_trigger
  after insert on public.chat_location_shares
  for each row execute function public.on_chat_location_share_insert();

-- Trigger: insert system message when user stops sharing
create or replace function public.on_chat_location_share_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.messages (activity_id, user_id, type, content)
  values (old.activity_id, old.user_id, 'system', 'location_share_stopped');
  return old;
end;
$$;

create trigger chat_location_share_delete_trigger
  after delete on public.chat_location_shares
  for each row execute function public.on_chat_location_share_delete();

alter publication supabase_realtime add table public.chat_location_shares;
