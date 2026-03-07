-- Track users removed from All Friends — they stay hidden from invite lists until re-added to All Friends

CREATE TABLE IF NOT EXISTS public.all_friends_removals (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id          uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  excluded_user_id  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, excluded_user_id)
);

CREATE INDEX IF NOT EXISTS idx_all_friends_removals_owner
  ON public.all_friends_removals (owner_id);

ALTER TABLE public.all_friends_removals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage own removals"
  ON public.all_friends_removals FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());
