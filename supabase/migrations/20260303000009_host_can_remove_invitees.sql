-- Migration — Ensure activity creator can remove invitees from their activity

-- Allow creator to delete any rsvp for their activity (remove invitee)
DROP POLICY IF EXISTS "Users delete own RSVP" ON public.rsvps;
CREATE POLICY "Users delete own RSVP"
  ON public.rsvps FOR DELETE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.activities
      WHERE id = activity_id AND created_by = auth.uid()
    )
  );
