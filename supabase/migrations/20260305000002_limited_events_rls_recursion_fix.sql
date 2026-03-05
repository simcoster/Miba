-- Fix infinite recursion: activities policy queries rsvps, rsvps policy queries activities.
-- Use SECURITY DEFINER functions to bypass RLS when reading the other table.

-- 1. Function for activities policy: check if user has 'in' RSVP (reads rsvps, bypasses RLS)
CREATE OR REPLACE FUNCTION public.user_has_in_rsvp(p_activity_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rsvps r
    WHERE r.activity_id = p_activity_id AND r.user_id = auth.uid() AND r.status = 'in'
  );
$$;

-- 2. Function for rsvps policy: check if user can see this rsvp row (reads activities, bypasses RLS)
CREATE OR REPLACE FUNCTION public.can_see_rsvp_row(p_activity_id uuid, p_status text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.activities a WHERE a.id = p_activity_id AND a.created_by = auth.uid())
    OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = p_activity_id AND (coalesce(a.is_limited, false) = false))
    OR (p_status = 'in' AND EXISTS (SELECT 1 FROM public.activities a WHERE a.id = p_activity_id AND coalesce(a.is_limited, false) = true AND a.created_by != auth.uid()));
$$;

-- 3. Replace activities policy to use the function instead of direct rsvps query
DROP POLICY IF EXISTS "Creators and invitees can view activities" ON public.activities;
CREATE POLICY "Creators and invitees can view activities"
  ON public.activities FOR SELECT USING (
    created_by = auth.uid()
    OR (
      public.is_activity_invitee(id)
      AND (
        (coalesce(is_limited, false) = false OR limited_closed_at IS NULL)
        OR public.user_has_in_rsvp(id)
      )
    )
  );

-- 4. Replace rsvps policy to use the function instead of direct activities query
DROP POLICY IF EXISTS "Invitees can view RSVPs" ON public.rsvps;
CREATE POLICY "Invitees can view RSVPs"
  ON public.rsvps FOR SELECT USING (
    public.is_activity_invitee(activity_id)
    AND public.can_see_rsvp_row(activity_id, status)
  );
