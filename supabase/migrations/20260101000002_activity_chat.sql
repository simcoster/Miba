-- Migration 2 — Activity chat

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

DROP POLICY IF EXISTS "Invitees can read messages"    ON public.messages;
DROP POLICY IF EXISTS "Invitees can post messages"    ON public.messages;
DROP POLICY IF EXISTS "Users can delete own messages" ON public.messages;

CREATE POLICY "Invitees can read messages"
  ON public.messages FOR SELECT USING (
    public.is_activity_invitee(activity_id)
  );

CREATE POLICY "Invitees can post messages"
  ON public.messages FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_activity_invitee(activity_id)
  );

CREATE POLICY "Users can delete own messages"
  ON public.messages FOR DELETE USING (
    auth.uid() = user_id
  );

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
