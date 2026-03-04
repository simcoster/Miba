-- Ensure circle owners can see all members (fixes empty circle when members exist)
-- The profile embed in some Supabase setups can fail; the app now fetches profiles separately.

DROP POLICY IF EXISTS "Circle members can see membership" ON public.circle_members;
CREATE POLICY "Circle members can see membership"
  ON public.circle_members FOR SELECT USING (
    user_id = auth.uid()
    OR public.is_circle_owner(circle_id)
  );
