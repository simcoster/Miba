-- Host ping: allow event organizer to nudge invitees (pending/maybe) with a notification.
-- Limited to 1 ping per day per activity.

-- 1. Allow host_ping system messages
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages
  add constraint messages_content_check
    check (
      (type = 'user'   and length(trim(content)) > 0)
      or
      (type = 'system' and content in (
        'event_edited', 'rsvp_changed', 'edit_suggestion',
        'location_share_started', 'location_share_stopped',
        'host_ping'
      ))
    );

-- 2. Track last host ping per activity (for 24h rate limit)
create table if not exists public.host_pings (
  activity_id uuid not null references public.activities(id) on delete cascade,
  pinged_at   timestamptz not null default now(),
  primary key (activity_id)
);

comment on table public.host_pings is 'Tracks last host ping per activity for 24h rate limiting.';

alter table public.host_pings enable row level security;

-- Only host can read their activity's ping record
create policy "Host can read own activity pings"
  on public.host_pings for select
  using (
    exists (
      select 1 from public.activities a
      where a.id = activity_id and a.created_by = auth.uid()
    )
  );

-- 3. RPC: host pings invitees with pending/maybe status
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
  -- Must be authenticated
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  -- Get activity and verify caller is host
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

  -- Check rate limit
  select pinged_at into v_last_ping
  from public.host_pings
  where activity_id = p_activity_id;

  if v_last_ping is not null and v_last_ping > v_cutoff then
    return jsonb_build_object('ok', false, 'error', 'You can only ping once per day. Try again tomorrow.');
  end if;

  -- Get pending/maybe invitees (exclude host)
  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = p_activity_id
    and r.status in ('pending', 'maybe')
    and r.user_id != v_host_id;

  if v_recipient_ids is null or array_length(v_recipient_ids, 1) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No one to ping');
  end if;

  -- Insert system message (for Updates feed)
  insert into public.messages (activity_id, user_id, type, content)
  values (p_activity_id, v_host_id, 'system', 'host_ping');

  -- Send push notification
  perform public.send_activity_push(
    p_activity_id,
    v_recipient_ids,
    'RSVP reminder',
    v_host_name || ' wants to know if you''re coming to ' || coalesce(v_activity_title, 'this event'),
    'host_ping'
  );

  -- Record ping for rate limit
  insert into public.host_pings (activity_id, pinged_at)
  values (p_activity_id, now())
  on conflict (activity_id) do update set pinged_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.host_ping_invitees is 'Host pings invitees with pending/maybe RSVP. Limited to 1 per day per activity.';
