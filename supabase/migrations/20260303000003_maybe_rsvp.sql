-- Migration 3 — Maybe RSVP + activity editing

-- Add maybe_pct and note columns to rsvps
ALTER TABLE public.rsvps
  ADD COLUMN IF NOT EXISTS maybe_pct smallint CHECK (maybe_pct IN (25, 50, 75)),
  ADD COLUMN IF NOT EXISTS note text;

-- Extend the status check constraint to include 'maybe'
DO $$
BEGIN
  ALTER TABLE public.rsvps DROP CONSTRAINT IF EXISTS rsvps_status_check;
  ALTER TABLE public.rsvps
    ADD CONSTRAINT rsvps_status_check
    CHECK (status IN ('pending', 'in', 'out', 'maybe'));
EXCEPTION WHEN others THEN
  NULL;
END $$;
