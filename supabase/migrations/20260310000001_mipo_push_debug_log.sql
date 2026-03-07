-- Debug logging for Mipo proximity push notifications (Android)
-- Query: select * from notification_debug_log order by created_at desc limit 50;

create table if not exists public.notification_debug_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  event_type text not null,
  payload jsonb,
  message text
);

comment on table public.notification_debug_log is 'Debug log for push notification flow. Query to inspect mipo proximity push behavior.';

-- Allow authenticated users to read (for debugging); only functions insert
alter table public.notification_debug_log enable row level security;
create policy "Allow read for authenticated"
  on public.notification_debug_log for select
  to authenticated using (true);

-- ============================================================
-- mipo_check_proximity: log dedup blocks and inserts
-- ============================================================
create or replace function public.mipo_check_proximity(
  p_user_id uuid,
  p_lat     double precision,
  p_lng     double precision
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_other record;
  v_dist_meters double precision;
  v_recent_exists boolean;
  v_user_a uuid;
  v_user_b uuid;
  v_inserted_id uuid;
begin
  for v_other in
    select s.selected_user_id as other_id, vs.lat, vs.lng
    from public.mipo_selections s
    join public.mipo_selections s2 on s2.user_id = s.selected_user_id and s2.selected_user_id = p_user_id
    join public.mipo_visible_sessions vs on vs.user_id = s.selected_user_id
    where s.user_id = p_user_id
      and s.selected_user_id != p_user_id
      and (vs.expires_at is null or vs.expires_at > now())
  loop
    v_dist_meters := earth_distance(
      ll_to_earth(p_lat, p_lng),
      ll_to_earth(v_other.lat, v_other.lng)
    );

    if v_dist_meters <= 100 then
      if p_user_id < v_other.other_id then
        v_user_a := p_user_id;
        v_user_b := v_other.other_id;
      else
        v_user_a := v_other.other_id;
        v_user_b := p_user_id;
      end if;

      select exists (
        select 1 from public.mipo_proximity_events
        where user_a_id = v_user_a and user_b_id = v_user_b
          and created_at > now() - interval '15 minutes'
      ) into v_recent_exists;

      if v_recent_exists then
        insert into public.notification_debug_log (event_type, payload, message)
        values ('mipo_proximity_dedup_blocked', jsonb_build_object(
          'user_a_id', v_user_a, 'user_b_id', v_user_b,
          'trigger_user_id', p_user_id, 'distance_m', round(v_dist_meters::numeric, 2)
        ), 'Same pair within 15 min - no event inserted');
      else
        insert into public.mipo_proximity_events (user_a_id, user_b_id)
        values (v_user_a, v_user_b)
        returning id into v_inserted_id;
        insert into public.notification_debug_log (event_type, payload, message)
        values ('mipo_proximity_event_inserted', jsonb_build_object(
          'event_id', v_inserted_id, 'user_a_id', v_user_a, 'user_b_id', v_user_b,
          'trigger_user_id', p_user_id, 'distance_m', round(v_dist_meters::numeric, 2)
        ), 'New proximity event - trigger will send push');
      end if;
    end if;
  end loop;
end;
$$;

-- ============================================================
-- mipo_send_proximity_push: log token status and send attempts
-- ============================================================
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
      'sound', 'match_playful.mp3',
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
      'sound', 'match_playful.mp3',
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
