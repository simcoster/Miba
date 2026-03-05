-- Fix: Deduplicate nearby events - return only the most recent event per other user.
-- Previously multiple events for the same pair (within 15-min dedup window) could appear as duplicate rows.
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
    join public.mipo_visible_sessions vs on vs.user_id = (case when e.user_a_id = p_user_id then e.user_b_id else e.user_a_id end)
      and (vs.expires_at is null or vs.expires_at > now())
    where (e.user_a_id = p_user_id or e.user_b_id = p_user_id)
      and e.created_at >= p_cutoff
    order by other_id, e.created_at desc
  ) sub
  order by created_at desc
  limit 20;
$$;
