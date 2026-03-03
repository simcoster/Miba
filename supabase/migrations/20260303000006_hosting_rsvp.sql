-- Migration 6 — Hosting RSVP status
-- Extend the status check constraint to include 'hosting'
DO $$
BEGIN
  ALTER TABLE public.rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
  ALTER TABLE public.rsvps
    ADD CONSTRAINT rsvps_status_check
    CHECK (status IN ('pending', 'in', 'out', 'maybe', 'hosting'));
EXCEPTION WHEN others THEN
  NULL;
END $$;
