-- Join me invite: use "X wants to hang, come say hi!" instead of "X invited you to Y"

create or replace function public.on_rsvp_invite_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_host_name text;
  v_activity_title text;
  v_is_join_me boolean;
  v_body text;
begin
  if new.status != 'pending' then
    return new;
  end if;

  -- Skip host's own row
  if exists (
    select 1 from public.activities a
    where a.id = new.activity_id and a.created_by = new.user_id
  ) then
    return new;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'Someone'), a.title, coalesce(a.is_join_me, false)
  into v_host_name, v_activity_title, v_is_join_me
  from public.activities a
  join public.profiles p on p.id = a.created_by
  where a.id = new.activity_id;

  if v_is_join_me then
    v_body := v_host_name || ' wants to hang, come say hi!';
  else
    v_body := v_host_name || ' invited you to ' || coalesce(v_activity_title, 'an event');
  end if;

  perform public.send_activity_push(
    new.activity_id,
    array[new.user_id],
    'New event',
    v_body,
    'new_invite'
  );
  return new;
end;
$$;
