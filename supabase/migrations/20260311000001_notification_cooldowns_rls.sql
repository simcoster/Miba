-- Enable RLS on notification_cooldowns (Supabase lint: public table without RLS)
-- Table is only accessed by send_activity_push() (SECURITY DEFINER), which bypasses RLS.
-- No policies needed: deny-by-default blocks direct client access; backend functions unaffected.

ALTER TABLE public.notification_cooldowns ENABLE ROW LEVEL SECURITY;
