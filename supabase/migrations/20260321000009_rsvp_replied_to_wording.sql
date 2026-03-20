-- RSVP notifications: "replied to" instead of "changed their rsvp for"

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
  v_status_icon text;
  v_is_join_me boolean;
  v_channel_id text := 'activity-updates';
  v_body text;
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

  if v_is_join_me and new.status != 'in' then
    return coalesce(new, old);
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Someone') into v_changed_name
  from public.profiles where id = new.user_id;

  v_status_label := case new.status
    when 'in' then 'I''m in!'
    when 'maybe' then 'Maybe'
    when 'out' then 'Can''t go'
    else 'Invited'
  end;

  v_status_icon := case new.status
    when 'in' then '✓'
    when 'maybe' then '?'
    when 'out' then '✗'
    else '•'
  end;

  v_body := v_changed_name || ' replied to ' || coalesce(v_activity_title, 'this event') || '. ' || v_status_icon || ' ''' || v_status_label || '''';

  if v_is_join_me and new.status = 'in' then
    v_channel_id := 'join-me-rsvp';
  end if;

  perform public.send_activity_push(
    coalesce(new.activity_id, old.activity_id),
    array[v_host_id],
    'RSVP update',
    v_body,
    'rsvp_host',
    v_channel_id
  );
  return coalesce(new, old);
end;
$$;
