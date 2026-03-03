-- Migration 1 — Demo users + RSVP policy updates

-- Add is_demo flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

-- Insert fake auth users (two demo accounts — no real login possible)
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

-- Insert demo profiles
INSERT INTO public.profiles (id, full_name, username, is_demo)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'Alex Chen',  'alex_chen',  true),
  ('00000000-0000-0000-0000-000000000002', 'Sam Rivera', 'sam_rivera', true)
ON CONFLICT (id) DO UPDATE SET
  is_demo   = true,
  full_name = EXCLUDED.full_name,
  username  = EXCLUDED.username;

-- Allow creator to remove any invitee from their activity
DROP POLICY IF EXISTS "Users delete own RSVP" ON public.rsvps;
CREATE POLICY "Users delete own RSVP"
  ON public.rsvps FOR DELETE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.activities
      WHERE id = activity_id AND created_by = auth.uid()
    )
  );

-- Allow creator to update RSVP on behalf of demo users
DROP POLICY IF EXISTS "Users manage own RSVP" ON public.rsvps;
CREATE POLICY "Users manage own RSVP"
  ON public.rsvps FOR UPDATE USING (
    auth.uid() = user_id
    OR (
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
