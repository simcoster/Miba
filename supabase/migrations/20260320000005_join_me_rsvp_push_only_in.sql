-- Join me: notify host only when someone changes to "I'm in", not when they decline or maybe

create or replace function public.on_rsvp_changed_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_host_id uuid;
  v_changed_name text;
  v_activity_title text;
  v_status_label text;
  v_is_join_me boolean;
  v_channel_id text := 'activity-updates';
begin
  select a.created_by, a.title, coalesce(a.is_join_me, false) into v_host_id, v_activity_title, v_is_join_me
  from public.activities a where a.id = coalesce(new.activity_id, old.activity_id);

  if v_host_id is null then
    return coalesce(new, old);
  end if;

  if (tg_op = 'INSERT' and new.user_id = v_host_id) or
     (tg_op = 'UPDATE' and new.user_id = v_host_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and auth.uid() = v_host_id then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return coalesce(new, old);
  end if;

  -- Join me: only notify host when someone changes to "I'm in", never for decline/maybe
  if v_is_join_me and new.status != 'in' then
    return coalesce(new, old);
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Someone') into v_changed_name
  from public.profiles where id = new.user_id;

  v_status_label := case new.status
    when 'in' then 'in'
    when 'maybe' then 'maybe'
    when 'out' then 'out'
    else 'pending'
  end;

  -- Host gets high-priority (join-me-rsvp channel) only when join_me event and status is "I'm in"
  if v_is_join_me and new.status = 'in' then
    v_channel_id := 'join-me-rsvp';
  end if;

  perform public.send_activity_push(
    coalesce(new.activity_id, old.activity_id),
    array[v_host_id],
    'RSVP update',
    v_changed_name || ' is now ' || v_status_label,
    'rsvp_host',
    v_channel_id
  );
  return coalesce(new, old);
end;
$$;
