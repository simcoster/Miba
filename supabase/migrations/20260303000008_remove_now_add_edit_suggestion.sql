-- Migration — Remove Now time option, add edit_suggestion system messages

-- 1. Convert existing "Now" activities (sentinel 1970-01-01) to created_at + 10 minutes
UPDATE public.activities
SET activity_time = created_at + interval '10 minutes'
WHERE activity_time = '1970-01-01 00:00:00+00'::timestamptz
   OR activity_time = '1970-01-01T00:00:00.000Z'::timestamptz;

-- 2. Allow edit_suggestion system messages
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_check
    CHECK (
      (type = 'user'   AND length(trim(content)) > 0)
      OR
      (type = 'system' AND content IN ('event_edited', 'rsvp_changed', 'edit_suggestion'))
    );
