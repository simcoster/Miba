-- Join me: high-priority push for host when someone changes to "I'm in"
-- Fully reversible: see supabase/revert/20260319000002_join_me_rsvp_push_high_priority.sql

-- Add optional channel_id parameter to send_activity_push
create or replace function public.send_activity_push(
  p_activity_id uuid,
  p_recipient_ids uuid[],
  p_title text,
  p_body text,
  p_notification_type text,
  p_channel_id text default 'activity-updates'
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
      'sound', 'default',
      'priority', 'high',
      'channelId', p_channel_id,
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

-- Update on_rsvp_changed_push: use join-me-rsvp channel (high-priority) for host when join_me "I'm in"
create or replace function public.on_rsvp_changed_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_host_id uuid;
  v_changed_name text;
  v_activity_title text;
  v_status_label text;
  v_is_join_me boolean;
  v_channel_id text := 'activity-updates';
begin
  select a.created_by, a.title, coalesce(a.is_join_me, false) into v_host_id, v_activity_title, v_is_join_me
  from public.activities a where a.id = coalesce(new.activity_id, old.activity_id);

  if v_host_id is null then
    return coalesce(new, old);
  end if;

  if (tg_op = 'INSERT' and new.user_id = v_host_id) or
     (tg_op = 'UPDATE' and new.user_id = v_host_id) then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' and auth.uid() = v_host_id then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return coalesce(new, old);
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Someone') into v_changed_name
  from public.profiles where id = new.user_id;

  v_status_label := case new.status
    when 'in' then 'in'
    when 'maybe' then 'maybe'
    when 'out' then 'out'
    else 'pending'
  end;

  -- Host gets high-priority (join-me-rsvp channel) only when join_me event and status is "I'm in"
  if v_is_join_me and new.status = 'in' then
    v_channel_id := 'join-me-rsvp';
  end if;

  perform public.send_activity_push(
    coalesce(new.activity_id, old.activity_id),
    array[v_host_id],
    'RSVP update',
    v_changed_name || ' is now ' || v_status_label,
    'rsvp_host',
    v_channel_id
  );
  return coalesce(new, old);
end;
$$;
