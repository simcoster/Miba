-- Remove 'hosting' from RSVP statuses. Host is identified by activity.created_by, not RSVP status.
-- Migrate existing hosting rows to 'in' (host is going)
UPDATE public.rsvps SET status = 'in' WHERE status = 'hosting';

-- Remove hosting from the status check constraint
DO $$
BEGIN
  ALTER TABLE public.rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
  ALTER TABLE public.rsvps
    ADD CONSTRAINT rsvps_status_check
    CHECK (status IN ('pending', 'in', 'out', 'maybe'));
EXCEPTION WHEN others THEN
  NULL;
END $$;
