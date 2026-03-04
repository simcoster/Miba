-- Migration: Circle owner is separate from members. Members are never admins.
-- - Remove admin role from circle_members (only 'member' allowed)
-- - RLS: use is_circle_owner() instead of role='admin'
-- - Do NOT add owner to circle_members when creating (handled in app)

-- 0. Ensure is_circle_owner exists (may not exist if DB was created via migrations only)
CREATE OR REPLACE FUNCTION public.is_circle_owner(p_circle_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.circles
    WHERE id = p_circle_id AND created_by = auth.uid()
  );
$$;

-- 1. Update any existing admin rows to member, then restrict role to 'member' only
UPDATE public.circle_members SET role = 'member' WHERE role = 'admin';

ALTER TABLE public.circle_members
  DROP CONSTRAINT IF EXISTS circle_members_role_check;

ALTER TABLE public.circle_members
  ADD CONSTRAINT circle_members_role_check CHECK (role = 'member');

-- 2. circle_members: only owner can add/remove (or user adds self when accepting invite)
DROP POLICY IF EXISTS "Creator or admin can add members" ON public.circle_members;
CREATE POLICY "Owner can add members; user can add self"
  ON public.circle_members FOR INSERT WITH CHECK (
    public.is_circle_owner(circle_id)
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Admin or self can remove members" ON public.circle_members;
CREATE POLICY "Owner or self can remove members"
  ON public.circle_members FOR DELETE USING (
    user_id = auth.uid()
    OR public.is_circle_owner(circle_id)
  );

-- 3. circle_invites: owner can view and create (owner is not in circle_members)
DROP POLICY IF EXISTS "Involved parties can view invites" ON public.circle_invites;
CREATE POLICY "Involved parties can view invites"
  ON public.circle_invites FOR SELECT USING (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
    OR public.is_circle_owner(circle_id)
    OR EXISTS (
      SELECT 1 FROM public.circle_members
      WHERE circle_id = circle_invites.circle_id AND user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Circle admins can create invites" ON public.circle_invites;
CREATE POLICY "Circle owner can create invites"
  ON public.circle_invites FOR INSERT WITH CHECK (
    auth.uid() = invited_by
    AND public.is_circle_owner(circle_id)
  );
