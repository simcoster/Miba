-- ============================================================
-- MIBA — Activity Chat
-- Run this file in the Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id uuid        NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.profiles(id)   ON DELETE CASCADE,
  content     text        NOT NULL CHECK (length(trim(content)) > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.messages IS 'Chat messages for an activity, visible to all invitees.';

CREATE INDEX IF NOT EXISTS idx_messages_activity_id ON public.messages(activity_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at  ON public.messages(created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Any user with an RSVP for the activity can read its messages
CREATE POLICY "Invitees can read messages"
  ON public.messages FOR SELECT USING (
    public.is_activity_invitee(activity_id)
  );

-- Users can only post under their own user_id, and only if they are invited
CREATE POLICY "Invitees can post messages"
  ON public.messages FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_activity_invitee(activity_id)
  );

-- Users can delete their own messages
CREATE POLICY "Users can delete own messages"
  ON public.messages FOR DELETE USING (
    auth.uid() = user_id
  );

-- Enable Realtime for this table (run once)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- ============================================================
-- Done.
-- ============================================================
