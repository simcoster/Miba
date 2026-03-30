-- Rare admin path: remove one account by email.
-- - Deletes events/circles they own; strips RSVP, circle invites, and circle membership as invitee.
-- - Reassigns board/chat (messages, posts, comments, surveys) on others' events to a system "Deleted user" profile.
-- Call only with the service role (or postgres in SQL editor). Not exposed to anon/authenticated.

-- System account used only to attribute orphaned discussion content after admin user deletion.
-- Not for login. UUID is fixed so admin_delete_user_by_email can reference it.

do $$
begin
  if not exists (
    select 1 from auth.users where id = '00000000-0000-0000-0000-00000000de1e'
  ) then
    insert into auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_user_meta_data, raw_app_meta_data,
      is_super_admin, confirmation_token, recovery_token,
      email_change_token_new, email_change
    )
    values (
      '00000000-0000-0000-0000-00000000de1e',
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      'deleted_user@miba.internal', '',
      now(), now(), now(),
      '{"full_name": "Deleted user"}'::jsonb,
      '{"provider": "email", "providers": ["email"]}'::jsonb,
      false, '', '', '', ''
    );
  end if;
end $$;

insert into public.profiles (id, full_name, username, email)
values (
  '00000000-0000-0000-0000-00000000de1e',
  'Deleted user',
  'deleted_user',
  'deleted_user@miba.internal'
)
on conflict (id) do update set
  full_name = excluded.full_name,
  username  = excluded.username,
  email     = excluded.email;

create or replace function public.admin_delete_user_by_email(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_norm text;
  v_count int;
  v_uid uuid;
  v_placeholder constant uuid := '00000000-0000-0000-0000-00000000de1e';
  v_deleted_activities int;
  v_deleted_circles int;
  v_msg int;
  v_posts int;
  v_comments int;
  v_survey int;
begin
  if p_email is null or btrim(p_email) = '' then
    raise exception 'email is required';
  end if;

  v_norm := lower(btrim(p_email));

  select count(*)::int into v_count
  from auth.users
  where lower(btrim(email)) = v_norm;

  if v_count = 0 then
    raise exception 'no user found for email %', p_email;
  end if;

  if v_count > 1 then
    raise exception 'multiple auth.users rows match email %; aborting for safety', p_email;
  end if;

  select id into strict v_uid
  from auth.users
  where lower(btrim(email)) = v_norm;

  if v_uid = v_placeholder then
    raise exception 'cannot delete the system deleted-user placeholder account';
  end if;

  if not exists (select 1 from public.profiles where id = v_placeholder) then
    raise exception 'deleted user placeholder profile is missing; re-run admin delete migration';
  end if;

  -- Events they host: delete first so messages/posts cascade away (nothing to reassign there).
  delete from public.activities where created_by = v_uid;
  get diagnostics v_deleted_activities = row_count;

  -- Remaining discussion rows (events they were only invited to): attribute to placeholder.
  update public.messages set user_id = v_placeholder where user_id = v_uid;
  get diagnostics v_msg = row_count;

  update public.posts set user_id = v_placeholder where user_id = v_uid;
  get diagnostics v_posts = row_count;

  update public.post_comments set user_id = v_placeholder where user_id = v_uid;
  get diagnostics v_comments = row_count;

  -- Survey: avoid unique (post_id, user_id) conflict with placeholder.
  delete from public.survey_responses sr
  where sr.user_id = v_uid
    and exists (
      select 1 from public.survey_responses x
      where x.post_id = sr.post_id
        and x.user_id = v_placeholder
    );

  update public.survey_responses set user_id = v_placeholder where user_id = v_uid;
  get diagnostics v_survey = row_count;

  -- Live location rows: drop rather than merge PK conflicts.
  delete from public.chat_location_shares where user_id = v_uid;

  -- Invites / membership as invitee (not host — hosted activities already removed).
  delete from public.rsvps where user_id = v_uid;
  delete from public.circle_invites where invited_user_id = v_uid;
  delete from public.circle_members where user_id = v_uid;

  delete from public.circles where created_by = v_uid;
  get diagnostics v_deleted_circles = row_count;

  delete from auth.identities where user_id = v_uid;
  delete from auth.users where id = v_uid;

  if not found then
    raise exception 'failed to delete auth.users row for %', v_uid;
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', v_uid,
    'email', v_norm,
    'deleted_activities_owned', v_deleted_activities,
    'deleted_circles_owned', v_deleted_circles,
    'reassigned_messages', v_msg,
    'reassigned_posts', v_posts,
    'reassigned_post_comments', v_comments,
    'reassigned_survey_responses', v_survey
  );
end;
$$;

comment on function public.admin_delete_user_by_email(text) is
  'Admin-only: delete one auth user by email; strip invitee rows; reassign board/chat to Deleted user placeholder; remove owned activities/circles. Requires service_role.';

revoke all on function public.admin_delete_user_by_email(text) from public;
grant execute on function public.admin_delete_user_by_email(text) to service_role;
