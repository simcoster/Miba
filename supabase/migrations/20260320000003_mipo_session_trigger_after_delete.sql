-- Change trigger from BEFORE to AFTER DELETE.
-- BEFORE delete caused "tuple to be deleted was already modified" when activity
-- cascade deleted chat_location_shares (trigger there modified rows).

drop trigger if exists mipo_session_deleted_delete_join_me on public.mipo_visible_sessions;

create trigger mipo_session_deleted_delete_join_me
  after delete on public.mipo_visible_sessions
  for each row execute function public.on_mipo_session_deleted_delete_join_me();
