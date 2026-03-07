-- Activity push notifications: chat, RSVP changes, new invites, limited re-opens
-- Requires pg_net (from mipo_push_notifications migration)
-- 30-min per-event-per-recipient cooldown

create extension if not exists pg_net;

-- Cooldown table: don't send to same user for same event within 30 mins
create table if not exists public.notification_cooldowns (
  activity_id uuid not null references public.activities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  last_sent_at timestamptz not null default now(),
  primary key (activity_id, user_id)
);

comment on table public.notification_cooldowns is 'Tracks last push notification sent per activity per user for 30-min rate limiting.';

-- Send push to recipients, respecting cooldown. Batches all sends in one Expo API call.
create or replace function public.send_activity_push(
  p_activity_id uuid,
  p_recipient_ids uuid[],
  p_title text,
  p_body text,
  p_notification_type text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_id uuid;
  v_token text;
  v_body jsonb := '[]'::jsonb;
  v_msg jsonb;
  v_cutoff timestamptz := now() - interval '30 minutes';
  v_cooldown record;
begin
  foreach v_recipient_id in array p_recipient_ids
  loop
    -- Skip if cooldown not expired
    select last_sent_at into v_cooldown
    from public.notification_cooldowns
    where activity_id = p_activity_id and user_id = v_recipient_id;
    if found and v_cooldown.last_sent_at > v_cutoff then
      continue;
    end if;

    -- Fetch push token
    select push_token into v_token
    from public.profiles where id = v_recipient_id;
    if v_token is null or trim(v_token) = '' then
      continue;
    end if;

    v_msg := jsonb_build_object(
      'to', v_token,
      'title', p_title,
      'body', p_body,
      'sound', 'default',
      'priority', 'high',
      'channelId', 'activity-updates',
      'data', jsonb_build_object(
        'type', p_notification_type,
        'activityId', p_activity_id
      )
    );
    v_body := v_body || v_msg;

    -- Record cooldown (upsert)
    insert into public.notification_cooldowns (activity_id, user_id, last_sent_at)
    values (p_activity_id, v_recipient_id, now())
    on conflict (activity_id, user_id) do update set last_sent_at = now();
  end loop;

  if jsonb_array_length(v_body) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Accept', 'application/json'
      ),
      body := v_body
    );
  end if;
end;
$$;

comment on function public.send_activity_push is 'Sends Expo push notifications to recipients for an activity, with 30-min per-recipient cooldown.';

-- 1. Chat messages: notify all invitees except sender
create or replace function public.on_message_inserted_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_ids uuid[];
  v_sender_name text;
  v_activity_title text;
  v_preview text;
begin
  if coalesce(new.type, 'user') != 'user' then
    return new;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'Someone'), a.title
  into v_sender_name, v_activity_title
  from public.profiles p, public.activities a
  where p.id = new.user_id and a.id = new.activity_id;

  v_preview := left(trim(new.content), 80);
  if length(trim(new.content)) > 80 then
    v_preview := v_preview || '...';
  end if;

  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = new.activity_id
    and r.user_id != new.user_id;

  if v_recipient_ids is not null and array_length(v_recipient_ids, 1) > 0 then
    perform public.send_activity_push(
      new.activity_id,
      v_recipient_ids,
      'New message',
      v_sender_name || ': ' || v_preview,
      'chat'
    );
  end if;
  return new;
end;
$$;

create trigger message_inserted_push
  after insert on public.messages
  for each row execute function public.on_message_inserted_push();

-- 2. Host RSVP notifications: when invitee RSVP changes (not when host changes it)
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
begin
  -- Get host and activity
  select a.created_by, a.title into v_host_id, v_activity_title
  from public.activities a where a.id = coalesce(new.activity_id, old.activity_id);

  if v_host_id is null then
    return coalesce(new, old);
  end if;

  -- Skip if this is the host's own RSVP row
  if (tg_op = 'INSERT' and new.user_id = v_host_id) or
     (tg_op = 'UPDATE' and new.user_id = v_host_id) then
    return coalesce(new, old);
  end if;

  -- On UPDATE: skip if host made the change (auth.uid() = host)
  if tg_op = 'UPDATE' and auth.uid() = v_host_id then
    return coalesce(new, old);
  end if;

  -- INSERT: only notify host when status != 'pending' (e.g. Mipo DM both get 'in')
  if tg_op = 'INSERT' and new.status = 'pending' then
    return new;
  end if;

  -- UPDATE: only when status actually changed
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
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

  perform public.send_activity_push(
    coalesce(new.activity_id, old.activity_id),
    array[v_host_id],
    'RSVP update',
    v_changed_name || ' is now ' || v_status_label,
    'rsvp_host'
  );
  return coalesce(new, old);
end;
$$;

create trigger rsvp_changed_push
  after insert or update of status on public.rsvps
  for each row execute function public.on_rsvp_changed_push();

-- 3. New event invites: when invitee gets pending RSVP
create or replace function public.on_rsvp_invite_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_host_name text;
  v_activity_title text;
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

  select coalesce(nullif(trim(p.full_name), ''), 'Someone'), a.title
  into v_host_name, v_activity_title
  from public.activities a
  join public.profiles p on p.id = a.created_by
  where a.id = new.activity_id;

  perform public.send_activity_push(
    new.activity_id,
    array[new.user_id],
    'New event',
    v_host_name || ' invited you to ' || coalesce(v_activity_title, 'an event'),
    'new_invite'
  );
  return new;
end;
$$;

create trigger rsvp_invite_push
  after insert on public.rsvps
  for each row execute function public.on_rsvp_invite_push();

-- 4. Limited event re-opens: notify pending/maybe invitees
create or replace function public.on_activity_limited_reopened_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_ids uuid[];
begin
  if new.limited_reopened_at is null then
    return new;
  end if;
  if old.limited_reopened_at is not distinct from new.limited_reopened_at then
    return new;
  end if;

  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = new.id
    and r.status in ('pending', 'maybe');

  if v_recipient_ids is not null and array_length(v_recipient_ids, 1) > 0 then
    perform public.send_activity_push(
      new.id,
      v_recipient_ids,
      'Event reopened',
      'A spot opened up for ' || coalesce(new.title, 'this event'),
      'limited_reopened'
    );
  end if;
  return new;
end;
$$;

create trigger activity_limited_reopened_push
  after update of limited_reopened_at on public.activities
  for each row execute function public.on_activity_limited_reopened_push();
