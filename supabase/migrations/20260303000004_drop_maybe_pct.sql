-- Migration 4 — Remove maybe_pct from rsvps
ALTER TABLE public.rsvps DROP COLUMN IF EXISTS maybe_pct;
