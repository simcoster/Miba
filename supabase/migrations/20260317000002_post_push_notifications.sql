-- Push notifications for board posts and comments

-- 1. New post: notify all invitees except author
create or replace function public.on_post_inserted_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_ids uuid[];
  v_sender_name text;
  v_activity_title text;
  v_preview text;
begin
  select coalesce(nullif(trim(p.full_name), ''), 'Someone'), a.title
  into v_sender_name, v_activity_title
  from public.profiles p, public.activities a
  where p.id = new.user_id and a.id = new.activity_id;

  v_preview := left(trim(new.content), 80);
  if length(trim(new.content)) > 80 then
    v_preview := v_preview || '...';
  end if;

  select array_agg(r.user_id) into v_recipient_ids
  from public.rsvps r
  where r.activity_id = new.activity_id
    and r.user_id != new.user_id;

  if v_recipient_ids is not null and array_length(v_recipient_ids, 1) > 0 then
    perform public.send_activity_push(
      new.activity_id,
      v_recipient_ids,
      'New post',
      v_sender_name || ': ' || v_preview,
      'new_post'
    );
  end if;
  return new;
end;
$$;

create trigger post_inserted_push
  after insert on public.posts
  for each row execute function public.on_post_inserted_push();

-- 2. New comment: notify post author + other commenters on that post (excluding comment author)
create or replace function public.on_post_comment_inserted_push()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_recipient_ids uuid[];
  v_sender_name text;
  v_preview text;
  v_post_author_id uuid;
begin
  select p.user_id into v_post_author_id from public.posts p where p.id = new.post_id;

  select coalesce(nullif(trim(pr.full_name), ''), 'Someone') into v_sender_name
  from public.profiles pr where pr.id = new.user_id;

  v_preview := left(trim(new.content), 80);
  if length(trim(new.content)) > 80 then
    v_preview := v_preview || '...';
  end if;

  -- Post author + distinct commenters on this post, excluding the comment author
  select array_agg(distinct uid) into v_recipient_ids
  from (
    select v_post_author_id as uid
    where v_post_author_id is not null and v_post_author_id != new.user_id
    union
    select pc.user_id
    from public.post_comments pc
    where pc.post_id = new.post_id and pc.user_id != new.user_id
  ) t;

  if v_recipient_ids is not null and array_length(v_recipient_ids, 1) > 0 then
    perform public.send_activity_push(
      new.activity_id,
      v_recipient_ids,
      'New comment',
      v_sender_name || ': ' || v_preview,
      'new_comment'
    );
  end if;
  return new;
end;
$$;

create trigger post_comment_inserted_push
  after insert on public.post_comments
  for each row execute function public.on_post_comment_inserted_push();
