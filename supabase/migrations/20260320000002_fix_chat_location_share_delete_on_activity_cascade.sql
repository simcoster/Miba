-- Fix: on_chat_location_share_delete fires when chat_location_shares are cascade-deleted
-- from activity delete. Inserting a message with the deleted activity_id causes FK violation.
-- Skip the location_share_stopped message when the activity no longer exists.

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
  -- Only insert location_share_stopped if activity still exists (user turned off share manually).
  -- When activity is being deleted, skip - the whole chat is gone.
  if exists (select 1 from public.activities where id = old.activity_id) then
    insert into public.messages (activity_id, user_id, type, content, post_id)
    values (old.activity_id, old.user_id, 'system', 'location_share_stopped', old.post_id);
  end if;
  return old;
end;
$$;
