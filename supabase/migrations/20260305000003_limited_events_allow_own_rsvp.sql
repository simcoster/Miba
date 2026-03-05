-- Invited users (pending) must see their own RSVP row for limited events.
-- Without this, my_rsvp is null and they don't appear in Invited tab or Updates.

DROP POLICY IF EXISTS "Invitees can view RSVPs" ON public.rsvps;
CREATE POLICY "Invitees can view RSVPs"
  ON public.rsvps FOR SELECT USING (
    public.is_activity_invitee(activity_id)
    AND (
      public.can_see_rsvp_row(activity_id, status)
      OR user_id = auth.uid()  -- users can always see their own rsvp (needed for pending/maybe/out on limited events)
    )
  );
