-- Fix: mipo_check_proximity used s.user_id (p_user_id) as other_id instead of s.selected_user_id.
-- This caused user_a_id = user_b_id = p_user_id, violating the check (user_a_id < user_b_id).
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
begin
  -- For each user B where (p_user_id selected B) AND (B selected p_user_id) AND (B is visible and not expired)
  for v_other in
    select s.selected_user_id as other_id, vs.lat, vs.lng
    from public.mipo_selections s
    join public.mipo_selections s2 on s2.user_id = s.selected_user_id and s2.selected_user_id = p_user_id
    join public.mipo_visible_sessions vs on vs.user_id = s.selected_user_id
    where s.user_id = p_user_id
      and s.selected_user_id != p_user_id
      and (vs.expires_at is null or vs.expires_at > now())
  loop
    -- Distance in meters (earthdistance)
    v_dist_meters := earth_distance(
      ll_to_earth(p_lat, p_lng),
      ll_to_earth(v_other.lat, v_other.lng)
    );

    if v_dist_meters <= 100 then
      -- Canonical order for deduplication
      if p_user_id < v_other.other_id then
        v_user_a := p_user_id;
        v_user_b := v_other.other_id;
      else
        v_user_a := v_other.other_id;
        v_user_b := p_user_id;
      end if;

      -- Deduplication: no event for same pair in last 15 minutes
      select exists (
        select 1 from public.mipo_proximity_events
        where user_a_id = v_user_a and user_b_id = v_user_b
          and created_at > now() - interval '15 minutes'
      ) into v_recent_exists;

      if not v_recent_exists then
        insert into public.mipo_proximity_events (user_a_id, user_b_id)
        values (v_user_a, v_user_b);
      end if;
    end if;
  end loop;
end;
$$;
