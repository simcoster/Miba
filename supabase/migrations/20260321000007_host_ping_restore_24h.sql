-- Restore host ping 24h rate limit (reverting the test-only "limit disabled" change).
create or replace function public.host_ping_invitees(p_activity_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_host_id uuid;
  v_host_name text;
  v_activity_title text;
  v_is_join_me boolean;
  v_recipient_ids uuid[];
  v_last_ping timestamptz;
  v_cutoff timestamptz := now() - interval '24 hours';
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select a.created_by, coalesce(nullif(trim(p.full_name), ''), 'Someone'), a.title, coalesce(a.is_join_me, false)
  into v_host_id, v_host_name, v_activity_title, v_is_join_me
  from public.activities a
  left join public.profiles p on p.id = a.created_by
  where a.id = p_activity_id;

  if v_host_id is null then
    return jsonb_build_object('ok', false, 'error', 'Activity not found');
  end if;

  if v_is_join_me then
    return jsonb_build_object('ok', false, 'error', 'Ping is not available for Join me events');
  end if;

  if auth.uid() != v_host_id then
    return jsonb_build_object('ok', false, 'error', 'Only the host can ping invitees');
  end if;

  select pinged_at into v_last_ping
  from public.host_pings
  where activity_id = p_activity_id;

  if v_last_ping is not null and v_last_ping > v_cutoff then
    return jsonb_build_object('ok', false, 'error', 'You can only ping once per day. Try again tomorrow.');
  end if;

  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = p_activity_id
    and r.status in ('pending', 'maybe')
    and r.user_id != v_host_id;

  if v_recipient_ids is null or array_length(v_recipient_ids, 1) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No one to ping');
  end if;

  insert into public.messages (activity_id, user_id, type, content)
  values (p_activity_id, v_host_id, 'system', 'host_ping');

  perform public.send_activity_push(
    p_activity_id,
    v_recipient_ids,
    'RSVP reminder',
    v_host_name || ' wants to know if you''re coming to ' || coalesce(v_activity_title, 'this event'),
    'host_ping'
  );

  insert into public.host_pings (activity_id, pinged_at)
  values (p_activity_id, now())
  on conflict (activity_id) do update set pinged_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.host_ping_invitees is 'Host pings invitees with pending/maybe RSVP. Limited to 1 per day per activity.';
