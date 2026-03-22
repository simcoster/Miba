-- Circle linked to event: one circle per event per user. Syncs members while event is active.
-- When event is past or deleted, link is cleared and circle becomes normal.
ALTER TABLE public.circles
  ADD COLUMN IF NOT EXISTS linked_activity_id uuid REFERENCES public.activities(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_circles_linked_activity_owner
  ON public.circles (linked_activity_id, created_by)
  WHERE linked_activity_id IS NOT NULL AND created_by IS NOT NULL;

COMMENT ON COLUMN public.circles.linked_activity_id IS 'When set, this circle syncs members from the event. Cleared when event is past or deleted.';
