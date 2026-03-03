-- Migration — Edit system messages in activity chat

-- Add message type column (default 'user', system messages are inserted by the host)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS type     text    NOT NULL DEFAULT 'user'
    CHECK (type IN ('user', 'system')),
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Drop the existing content check and replace with one that allows
-- the sentinel value used for system messages ('event_edited')
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_content_check;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_content_check
    CHECK (
      (type = 'user'   AND length(trim(content)) > 0)
      OR
      (type = 'system' AND content = 'event_edited')
    );

-- Allow the host to update their own system messages (for 30-min merge)
DROP POLICY IF EXISTS "Users can update own system messages" ON public.messages;
CREATE POLICY "Users can update own system messages"
  ON public.messages FOR UPDATE
  USING  (auth.uid() = user_id AND type = 'system')
  WITH CHECK (auth.uid() = user_id AND type = 'system');
