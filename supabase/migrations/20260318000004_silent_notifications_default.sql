-- Notifications silent by default. Mipo match and activity push no longer play sound.
-- Later: add user preference or parameter for loud notifications from events.

-- Mipo proximity push: remove sound (was match_playful.mp3)
create or replace function public.mipo_send_proximity_push(
  p_event_id uuid,
  p_user_a_id uuid,
  p_user_b_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_token_a text;
  v_token_b text;
  v_name_a text;
  v_name_b text;
  v_body jsonb;
  v_msg jsonb;
  v_has_token_a boolean := false;
  v_has_token_b boolean := false;
begin
  select push_token, full_name into v_token_a, v_name_a
  from public.profiles where id = p_user_a_id;
  select push_token, full_name into v_token_b, v_name_b
  from public.profiles where id = p_user_b_id;

  v_has_token_a := (v_token_a is not null and trim(v_token_a) != '');
  v_has_token_b := (v_token_b is not null and trim(v_token_b) != '');

  insert into public.notification_debug_log (event_type, payload, message)
  values ('mipo_push_invoked', jsonb_build_object(
    'event_id', p_event_id, 'user_a_id', p_user_a_id, 'user_b_id', p_user_b_id,
    'has_token_a', v_has_token_a, 'has_token_b', v_has_token_b,
    'token_a_prefix', case when v_has_token_a then left(v_token_a, 30) || '...' else null end,
    'token_b_prefix', case when v_has_token_b then left(v_token_b, 30) || '...' else null end
  ), 'mipo_send_proximity_push called - will send to ' ||
    case when v_has_token_a and v_has_token_b then 'both'
         when v_has_token_a then 'user_a only'
         when v_has_token_b then 'user_b only'
         else 'neither (no valid tokens)' end);

  v_body := '[]'::jsonb;

  if v_has_token_a then
    v_msg := jsonb_build_object(
      'to', v_token_a,
      'title', 'Friend nearby!',
      'body', 'You''re nearby ' || coalesce(nullif(trim(v_name_b), ''), 'a friend') || '!',
      'sound', null,
      'priority', 'high',
      'channelId', 'mipo-proximity',
      'data', jsonb_build_object('type', 'mipo_proximity', 'eventId', p_event_id)
    );
    v_body := v_body || v_msg;
  end if;

  if v_has_token_b then
    v_msg := jsonb_build_object(
      'to', v_token_b,
      'title', 'Friend nearby!',
      'body', 'You''re nearby ' || coalesce(nullif(trim(v_name_a), ''), 'a friend') || '!',
      'sound', null,
      'priority', 'high',
      'channelId', 'mipo-proximity',
      'data', jsonb_build_object('type', 'mipo_proximity', 'eventId', p_event_id)
    );
    v_body := v_body || v_msg;
  end if;

  if jsonb_array_length(v_body) > 0 then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Accept', 'application/json'
      ),
      body := v_body
    );
    insert into public.notification_debug_log (event_type, payload, message)
    values ('mipo_push_sent', jsonb_build_object(
      'event_id', p_event_id, 'recipient_count', jsonb_array_length(v_body)
    ), 'Expo push API called for ' || jsonb_array_length(v_body)::text || ' recipient(s)');
  else
    insert into public.notification_debug_log (event_type, payload, message)
    values ('mipo_push_skipped', jsonb_build_object('event_id', p_event_id), 'No valid push tokens - Expo not called');
  end if;
end;
$$;

-- Activity push (chat, RSVP, invites, limited re-opens, posts): silent by default
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
    select last_sent_at into v_cooldown
    from public.notification_cooldowns
    where activity_id = p_activity_id and user_id = v_recipient_id;
    if found and v_cooldown.last_sent_at > v_cutoff then
      continue;
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
      'sound', null,
      'priority', 'high',
      'channelId', 'activity-updates',
      'data', jsonb_build_object(
        'type', p_notification_type,
        'activityId', p_activity_id
      )
    );
    v_body := v_body || v_msg;

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
