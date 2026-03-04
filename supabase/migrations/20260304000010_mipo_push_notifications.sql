-- Mipo: send push notifications when a proximity match is detected
-- Requires pg_net extension for HTTP from Postgres

create extension if not exists pg_net;

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
      'sound', 'default',
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
      'sound', 'default',
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

comment on function public.mipo_send_proximity_push is 'Sends Expo push notifications to both users when a Mipo proximity match is detected.';

-- Trigger: send push after proximity event is inserted
create or replace function public.mipo_on_proximity_inserted()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.mipo_send_proximity_push(new.id, new.user_a_id, new.user_b_id);
  return new;
end;
$$;

create trigger mipo_proximity_push_notify
  after insert on public.mipo_proximity_events
  for each row execute function public.mipo_on_proximity_inserted();
