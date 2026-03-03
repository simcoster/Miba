-- ============================================================
-- MIBA — All migrations (paste this entire file into the
-- Supabase SQL Editor and click Run)
--
-- Safe to re-run: every statement uses IF NOT EXISTS /
-- ON CONFLICT / DROP IF EXISTS so nothing breaks if a
-- migration was already applied.
-- ============================================================


-- ============================================================
-- MIGRATION 1 — Demo users + RSVP policy updates
-- ============================================================

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


-- ============================================================
-- MIGRATION 2 — Activity chat
-- ============================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id uuid        NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  content     text        NOT NULL CHECK (length(trim(content)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.messages IS 'Chat messages for an activity, visible to all invitees.';

CREATE INDEX IF NOT EXISTS idx_messages_activity_id ON public.messages(activity_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at  ON public.messages(created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Drop policies first so re-runs are safe
DROP POLICY IF EXISTS "Invitees can read messages"   ON public.messages;
DROP POLICY IF EXISTS "Invitees can post messages"   ON public.messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON public.messages;

CREATE POLICY "Invitees can read messages"
  ON public.messages FOR SELECT USING (
    public.is_activity_invitee(activity_id)
  );

CREATE POLICY "Invitees can post messages"
  ON public.messages FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_activity_invitee(activity_id)
  );

CREATE POLICY "Users can delete own messages"
  ON public.messages FOR DELETE USING (
    auth.uid() = user_id
  );

-- Enable Realtime (safe to run even if already added)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- ============================================================
-- Done.
-- ============================================================
