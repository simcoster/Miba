-- Event deleted: notify only guests who RSVP'd "in" or "maybe" (not pending/out).
-- Removes: join_me skip, "created > 1 hour ago" skip, and pending-invitee blast.
-- send_activity_push: bypass 30m cooldown for event_deleted so it always delivers.

create or replace function public.send_activity_push(
  p_activity_id uuid,
  p_recipient_ids uuid[],
  p_title text,
  p_body text,
  p_notification_type text,
  p_channel_id text default 'activity-updates'
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
  v_skip_cooldown boolean := p_notification_type = 'event_deleted';
begin
  foreach v_recipient_id in array p_recipient_ids
  loop
    if not v_skip_cooldown then
      select last_sent_at into v_cooldown
      from public.notification_cooldowns
      where activity_id = p_activity_id and user_id = v_recipient_id;
      if found and v_cooldown.last_sent_at > v_cutoff then
        continue;
      end if;
    end if;

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
      'channelId', p_channel_id,
      'data', jsonb_build_object(
        'type', p_notification_type,
        'activityId', p_activity_id
      )
    );
    v_body := v_body || v_msg;

    if not v_skip_cooldown then
      insert into public.notification_cooldowns (activity_id, user_id, last_sent_at)
      values (p_activity_id, v_recipient_id, now())
      on conflict (activity_id, user_id) do update set last_sent_at = now();
    end if;
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
  v_host_id := old.created_by;
  v_activity_title := coalesce(old.title, 'An event');

  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = old.id
    and r.user_id is distinct from v_host_id
    and r.status in ('in', 'maybe');

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

comment on function public.on_activity_deleted_push() is
  'Before delete on activities: Expo push to RSVP in/maybe invitees (excludes host, pending, out). Join me and immediate deletes included.';
