-- Fix: send_activity_push "is not unique" error
-- The 6-param version (with optional channel_id) created an overload alongside the old 5-param version.
-- PostgreSQL couldn't resolve calls with 5 args. Drop the old overload so only the 6-param version exists.
drop function if exists public.send_activity_push(uuid, uuid[], text, text, text);
