-- Mipo: make proximity distance user-pickable (500m, 3km, 10km, or custom)

alter table public.mipo_visible_sessions
  add column if not exists proximity_distance_m integer not null default 500;

comment on column public.mipo_visible_sessions.proximity_distance_m is 'Mipo: distance in meters within which to trigger proximity notification. User picks: 500, 3000, 10000, or custom.';

-- Update mipo_check_proximity to use per-session distance
-- Trigger passes the session's proximity_distance_m; we use the minimum of both users' radii
-- so we only trigger when BOTH would consider each other nearby
create or replace function public.mipo_check_proximity(
  p_user_id uuid,
  p_lat     double precision,
  p_lng     double precision,
  p_distance_meters integer default 500
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
  v_effective_dist integer;
begin
  for v_other in
    select s.selected_user_id as other_id, vs.lat, vs.lng, vs.proximity_distance_m as other_distance_m
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

    -- Use the smaller of the two users' radii (both must consider each other nearby)
    v_effective_dist := least(p_distance_meters, coalesce(v_other.other_distance_m, 500));

    if v_dist_meters <= v_effective_dist then
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

-- Update trigger to pass proximity_distance_m
create or replace function public.mipo_on_session_updated()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.mipo_check_proximity(
    new.user_id,
    new.lat,
    new.lng,
    coalesce(new.proximity_distance_m, 500)
  );
  return new;
end;
$$;

-- Recreate trigger to also fire when proximity_distance_m changes
drop trigger if exists mipo_session_proximity_check on public.mipo_visible_sessions;
create trigger mipo_session_proximity_check
  after insert or update of lat, lng, proximity_distance_m on public.mipo_visible_sessions
  for each row execute function public.mipo_on_session_updated();
