-- Notify invitees when an event is cancelled (status -> 'cancelled')
-- Recipients: everyone except host, with RSVP status != 'out' (not declined)
-- Note: "hidden" is stored client-side (AsyncStorage) and cannot be filtered server-side

create or replace function public.on_activity_cancelled_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_ids uuid[];
  v_host_id uuid;
  v_activity_title text;
begin
  if new.status != 'cancelled' or old.status = 'cancelled' then
    return new;
  end if;

  v_host_id := new.created_by;
  v_activity_title := coalesce(new.title, 'An event');

  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = new.id
    and r.user_id != v_host_id
    and r.status != 'out';

  if v_recipient_ids is not null and array_length(v_recipient_ids, 1) > 0 then
    perform public.send_activity_push(
      new.id,
      v_recipient_ids,
      'Event cancelled',
      v_activity_title || ' has been cancelled',
      'event_cancelled'
    );
  end if;
  return new;
end;
$$;

create trigger activity_cancelled_push
  after update of status on public.activities
  for each row execute function public.on_activity_cancelled_push();
