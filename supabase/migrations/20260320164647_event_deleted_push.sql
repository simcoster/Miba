-- Notify invitees when host deletes an event (BEFORE DELETE).
-- Conditions: event created > 1 hour ago, not a join_me event.
-- Recipients: everyone except host, with RSVP status != 'out' (not declined).

create or replace function public.on_activity_deleted_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_ids uuid[];
  v_host_id uuid;
  v_activity_title text;
begin
  -- Skip join me events
  if coalesce(old.is_join_me, false) then
    return old;
  end if;

  -- Only notify if event was created more than 1 hour ago
  if old.created_at > now() - interval '1 hour' then
    return old;
  end if;

  v_host_id := old.created_by;
  v_activity_title := coalesce(old.title, 'An event');

  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = old.id
    and r.user_id != v_host_id
    and r.status != 'out';

  if v_recipient_ids is not null and array_length(v_recipient_ids, 1) > 0 then
    perform public.send_activity_push(
      old.id,
      v_recipient_ids,
      'Event deleted',
      v_activity_title || ' has been deleted',
      'event_deleted'
    );
  end if;
  return old;
end;
$$;

create trigger activity_deleted_push
  before delete on public.activities
  for each row execute function public.on_activity_deleted_push();
