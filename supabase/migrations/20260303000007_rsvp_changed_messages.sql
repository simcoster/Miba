-- Migration — Allow rsvp_changed system messages

ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_check
    CHECK (
      (type = 'user'   AND length(trim(content)) > 0)
      OR
      (type = 'system' AND content IN ('event_edited', 'rsvp_changed'))
    );
