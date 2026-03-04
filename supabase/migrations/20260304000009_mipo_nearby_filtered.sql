-- RPC: return nearby proximity events where the OTHER user is still visible.
-- When Sally turns off visible, Bob's list will no longer include her.
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
  select
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
  order by e.created_at desc
  limit 20;
$$;

comment on function public.mipo_nearby_events is 'Mipo: nearby events filtered by other user still being visible.';

-- Enable realtime for mipo_visible_sessions so clients refetch when someone turns off visible
alter publication supabase_realtime add table public.mipo_visible_sessions;
