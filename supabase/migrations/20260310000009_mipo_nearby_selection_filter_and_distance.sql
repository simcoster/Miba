-- Mipo: three fixes
-- 1. Filter nearby events by our current selections: don't show matches with people we removed from our list
-- 2. Filter by current distance: only show events where we're still within each other's distance (tab was showing stale matches)
-- 3. Ensure matching distance uses minimum of both users' radii in mipo_check_proximity

-- 1 & 2. mipo_nearby_events: only show events where we still have the other in our selection AND we're still within distance
create or replace function public.mipo_nearby_events(p_user_id uuid, p_cutoff timestamptz default now() - interval '30 minutes')
returns table (
  id uuid,
  user_a_id uuid,
  user_b_id uuid,
  created_at timestamptz,
  other_id uuid,
  other_full_name text,
  other_avatar_url text
)
language sql
security definer
set search_path = public
as $$
  select * from (
    select distinct on (other_id)
      e.id,
      e.user_a_id,
      e.user_b_id,
      e.created_at,
      case when e.user_a_id = p_user_id then e.user_b_id else e.user_a_id end as other_id,
      p.full_name as other_full_name,
      p.avatar_url as other_avatar_url
    from public.mipo_proximity_events e
    join public.profiles p on p.id = (case when e.user_a_id = p_user_id then e.user_b_id else e.user_a_id end)
    join public.mipo_visible_sessions vs_other on vs_other.user_id = (case when e.user_a_id = p_user_id then e.user_b_id else e.user_a_id end)
      and (vs_other.expires_at is null or vs_other.expires_at > now())
    join public.mipo_visible_sessions my_vs on my_vs.user_id = p_user_id
    join public.mipo_selections my_sel on my_sel.user_id = p_user_id
      and my_sel.selected_user_id = (case when e.user_a_id = p_user_id then e.user_b_id else e.user_a_id end)
    where (e.user_a_id = p_user_id or e.user_b_id = p_user_id)
      and e.created_at >= p_cutoff
      and earth_distance(
          ll_to_earth(my_vs.lat, my_vs.lng),
          ll_to_earth(vs_other.lat, vs_other.lng)
        ) <= least(
          coalesce(my_vs.proximity_distance_m, 500),
          coalesce(vs_other.proximity_distance_m, 500)
        )
    order by other_id, e.created_at desc
  ) sub
  order by created_at desc
  limit 20;
$$;

comment on function public.mipo_nearby_events is 'Mipo: nearby events filtered by other still visible, still in our selection, and still within distance.';

-- 2. Re-apply mipo_check_proximity with minimum-distance logic (in case debug migration overwrote it)
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

    -- Use the minimum of both users' radii: match only when BOTH would consider each other nearby
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
