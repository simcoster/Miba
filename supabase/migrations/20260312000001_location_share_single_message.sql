-- When a user enables or disables location sharing, remove their previous
-- location share announcement so only the most recent one appears.

create or replace function public.on_chat_location_share_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Remove previous location share messages from this user in this activity
  delete from public.messages
  where activity_id = new.activity_id
    and user_id = new.user_id
    and type = 'system'
    and content in ('location_share_started', 'location_share_stopped');
  -- Insert the new announcement
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
  -- Remove previous location share messages from this user in this activity
  delete from public.messages
  where activity_id = old.activity_id
    and user_id = old.user_id
    and type = 'system'
    and content in ('location_share_started', 'location_share_stopped');
  -- Insert the new announcement
  insert into public.messages (activity_id, user_id, type, content)
  values (old.activity_id, old.user_id, 'system', 'location_share_stopped');
  return old;
end;
$$;
