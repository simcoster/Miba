-- ============================================================
-- MIBA — Demo Users + Creator RSVP Lock
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- 1. Add is_demo flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- 2. Insert fake auth users (two demo accounts with no real login)
INSERT INTO auth.users (
  id, instance_id, aud, role,
  email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_user_meta_data, raw_app_meta_data,
  is_super_admin, confirmation_token, recovery_token,
  email_change_token_new, email_change
)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'demo_alex@miba.internal', '',
    now(), now(), now(),
    '{"full_name": "Alex Chen"}'::jsonb,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    false, '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'demo_sam@miba.internal', '',
    now(), now(), now(),
    '{"full_name": "Sam Rivera"}'::jsonb,
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    false, '', '', '', ''
  )
ON CONFLICT (id) DO NOTHING;

-- 3. Insert their profiles
INSERT INTO public.profiles (id, full_name, username, is_demo)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Alex Chen',   'alex_chen',   true),
  ('00000000-0000-0000-0000-000000000002', 'Sam Rivera',  'sam_rivera',  true)
ON CONFLICT (id) DO UPDATE SET
  is_demo    = true,
  full_name  = EXCLUDED.full_name,
  username   = EXCLUDED.username;

-- 4. Allow creator to remove any invitee (not just their own row).
DROP POLICY IF EXISTS "Users delete own RSVP" ON public.rsvps;

CREATE POLICY "Users delete own RSVP"
  ON public.rsvps FOR DELETE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.activities
      WHERE id = activity_id AND created_by = auth.uid()
    )
  );

-- 5. Allow activity creators to update RSVP status on behalf of demo users.
--    (Real users can still only update their own RSVP.)
DROP POLICY IF EXISTS "Users manage own RSVP" ON public.rsvps;

CREATE POLICY "Users manage own RSVP"
  ON public.rsvps FOR UPDATE USING (
    auth.uid() = user_id
    OR (
      -- Creator can flip the status of demo-user RSVPs on their activity
      EXISTS (
        SELECT 1 FROM public.activities
        WHERE id = activity_id AND created_by = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = user_id AND is_demo = true
      )
    )
  );

-- ============================================================
-- Done. Demo users "Alex Chen" (@alex_chen) and
-- "Sam Rivera" (@sam_rivera) are now searchable and invitable.
-- ============================================================
