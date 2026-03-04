-- Migration — Remove demo users and all demo-related code

-- 1. Drop rsvps UPDATE policy first (it depends on profiles.is_demo)
DROP POLICY IF EXISTS "Users manage own RSVP" ON public.rsvps;
CREATE POLICY "Users manage own RSVP"
  ON public.rsvps FOR UPDATE USING (auth.uid() = user_id);

-- 2. Drop is_demo column from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_demo;

-- 3. Delete demo users (cascades to profiles, rsvps, circle_members, etc.)
DELETE FROM auth.identities
  WHERE user_id IN (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002'
  );
DELETE FROM auth.users
  WHERE id IN (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002'
  );
