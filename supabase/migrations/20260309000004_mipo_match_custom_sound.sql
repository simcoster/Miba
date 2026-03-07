-- Mipo match notifications: use custom sound match_playful.mp3
-- Other notifications (activity, messages) keep default sound

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
begin
  -- Fetch push tokens and names for both users
  select push_token, full_name into v_token_a, v_name_a
  from public.profiles where id = p_user_a_id;
  select push_token, full_name into v_token_b, v_name_b
  from public.profiles where id = p_user_b_id;

  -- Build messages array (only include users with valid push tokens)
  v_body := '[]'::jsonb;

  if v_token_a is not null and trim(v_token_a) != '' then
    v_msg := jsonb_build_object(
      'to', v_token_a,
      'title', 'Friend nearby!',
      'body', 'You''re nearby ' || coalesce(nullif(trim(v_name_b), ''), 'a friend') || '!',
      'sound', 'match_playful.mp3',
      'priority', 'high',
      'channelId', 'mipo-proximity',
      'data', jsonb_build_object('type', 'mipo_proximity', 'eventId', p_event_id)
    );
    v_body := v_body || v_msg;
  end if;

  if v_token_b is not null and trim(v_token_b) != '' then
    v_msg := jsonb_build_object(
      'to', v_token_b,
      'title', 'Friend nearby!',
      'body', 'You''re nearby ' || coalesce(nullif(trim(v_name_a), ''), 'a friend') || '!',
      'sound', 'match_playful.mp3',
      'priority', 'high',
      'channelId', 'mipo-proximity',
      'data', jsonb_build_object('type', 'mipo_proximity', 'eventId', p_event_id)
    );
    v_body := v_body || v_msg;
  end if;

  -- Only call Expo API if we have at least one recipient
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
