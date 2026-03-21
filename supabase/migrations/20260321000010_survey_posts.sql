-- Survey posts: polls with single/multi-select, ping for unanswered participants.
-- Mirrors host_ping pattern (24h rate limit, push notifications).

-- 1. posts: add survey type and survey_metadata
alter table public.posts drop constraint if exists posts_post_type_check;
alter table public.posts
  add constraint posts_post_type_check
  check (post_type in ('text', 'live_location', 'survey'));

alter table public.posts
  add column if not exists survey_metadata jsonb;

comment on column public.posts.survey_metadata is 'For survey posts: { question, options: string[], allow_multiple: boolean }';

-- 2. survey_responses: one response per user per survey
create table if not exists public.survey_responses (
  id              uuid        primary key default gen_random_uuid(),
  post_id         uuid        not null references public.posts(id) on delete cascade,
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  selected_indices int[]      not null default '{}',
  created_at      timestamptz not null default now(),
  unique (post_id, user_id)
);

comment on table public.survey_responses is 'Survey responses: selected_indices are indices into survey_metadata.options.';

create index idx_survey_responses_post_id on public.survey_responses(post_id);

alter table public.survey_responses enable row level security;

create policy "Invitees can read survey responses"
  on public.survey_responses for select using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and public.is_activity_invitee(p.activity_id)
    )
  );

create policy "Users can insert own survey response"
  on public.survey_responses for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.posts p
      where p.id = post_id and public.is_activity_invitee(p.activity_id)
    )
  );

create policy "Users can update own survey response"
  on public.survey_responses for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.survey_responses;

-- 3. survey_pings: rate limit (1 ping per 24h per survey)
create table if not exists public.survey_pings (
  post_id    uuid        primary key references public.posts(id) on delete cascade,
  pinged_at  timestamptz not null default now()
);

comment on table public.survey_pings is 'Tracks last survey ping per post for 24h rate limiting.';

alter table public.survey_pings enable row level security;

create policy "Post creator can read survey pings"
  on public.survey_pings for select using (
    exists (
      select 1 from public.posts p
      where p.id = post_id and p.user_id = auth.uid()
    )
  );

-- 4. Allow survey_ping system messages
alter table public.messages drop constraint if exists messages_content_check;
alter table public.messages
  add constraint messages_content_check
    check (
      (type = 'user'   and length(trim(content)) > 0)
      or
      (type = 'system' and content in (
        'event_edited', 'rsvp_changed', 'edit_suggestion',
        'location_share_started', 'location_share_stopped',
        'host_ping', 'survey_ping'
      ))
    );

-- 5. RPC: ping unanswered survey participants
create or replace function public.survey_ping_unanswered(p_post_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_post record;
  v_activity_id uuid;
  v_host_id uuid;
  v_host_name text;
  v_activity_title text;
  v_recipient_ids uuid[];
  v_last_ping timestamptz;
  v_cutoff timestamptz := now() - interval '24 hours';
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select p.id, p.activity_id, p.user_id into v_post
  from public.posts p
  where p.id = p_post_id and p.post_type = 'survey';

  if v_post is null then
    return jsonb_build_object('ok', false, 'error', 'Survey not found');
  end if;

  if auth.uid() != v_post.user_id then
    return jsonb_build_object('ok', false, 'error', 'Only the creator can ping');
  end if;

  v_activity_id := v_post.activity_id;

  select coalesce(nullif(trim(pr.full_name), ''), 'Someone'), a.title, a.created_by
  into v_host_name, v_activity_title, v_host_id
  from public.activities a
  left join public.profiles pr on pr.id = a.created_by
  where a.id = v_activity_id;

  -- Check rate limit
  select pinged_at into v_last_ping
  from public.survey_pings
  where post_id = p_post_id;

  if v_last_ping is not null and v_last_ping > v_cutoff then
    return jsonb_build_object('ok', false, 'error', 'You can only ping once per day. Try again tomorrow.');
  end if;

  -- Get invitees who haven't responded (exclude host)
  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = v_activity_id
    and r.user_id != v_host_id
    and not exists (
      select 1 from public.survey_responses sr
      where sr.post_id = p_post_id and sr.user_id = r.user_id
    );

  if v_recipient_ids is null or array_length(v_recipient_ids, 1) = 0 then
    return jsonb_build_object('ok', false, 'error', 'No one to ping');
  end if;

  -- Insert system message (for Updates feed)
  insert into public.messages (activity_id, user_id, type, content, post_id)
  values (v_activity_id, auth.uid(), 'system', 'survey_ping', p_post_id);

  -- Send push notification
  perform public.send_activity_push(
    v_activity_id,
    v_recipient_ids,
    'Survey reminder',
    v_host_name || ' wants your answer on a survey for ' || coalesce(v_activity_title, 'this event'),
    'survey_ping'
  );

  -- Record ping for rate limit
  insert into public.survey_pings (post_id, pinged_at)
  values (p_post_id, now())
  on conflict (post_id) do update set pinged_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

comment on function public.survey_ping_unanswered is 'Creator pings invitees who have not answered the survey. Limited to 1 per day per survey.';
