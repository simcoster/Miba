-- Migration: Friends feature — All Friends circle, contact imports, friend-joined updates

-- 1. Add is_all_friends to circles
ALTER TABLE public.circles
  ADD COLUMN IF NOT EXISTS is_all_friends boolean NOT NULL DEFAULT false;

-- Unique: only one All Friends circle per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_circles_one_all_friends_per_user
  ON public.circles (created_by)
  WHERE is_all_friends = true;

-- 2. Add email and phone to profiles (for search)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email_unique
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL;

-- Update handle_new_user to copy email from auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url, email)
  VALUES (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    new.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

-- 3. Contact imports (from device contacts)
CREATE TABLE IF NOT EXISTS public.contact_imports (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  email       text,
  phone       text,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_imports_has_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_imports_user_email
  ON public.contact_imports (user_id, lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_imports_user_phone
  ON public.contact_imports (user_id, phone)
  WHERE phone IS NOT NULL;

ALTER TABLE public.contact_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own contact imports"
  ON public.contact_imports FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. Friend-joined updates (when imported contact joins Miba)
CREATE TABLE IF NOT EXISTS public.friend_joined_updates (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  new_user_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contact_import_id  uuid        REFERENCES public.contact_imports(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_friend_joined_recipient
  ON public.friend_joined_updates (recipient_id);

ALTER TABLE public.friend_joined_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recipients can read own friend joined updates"
  ON public.friend_joined_updates FOR SELECT
  USING (recipient_id = auth.uid());

-- 5. Trigger: when new user signs up, match contact_imports and create friend_joined_updates
CREATE OR REPLACE FUNCTION public.on_new_user_friend_joined()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
  norm_email text;
BEGIN
  norm_email := lower(trim(new.email));
  IF norm_email IS NULL OR norm_email = '' THEN
    RETURN new;
  END IF;

  FOR r IN
    SELECT ci.id AS contact_import_id, ci.user_id AS recipient_id
    FROM public.contact_imports ci
    WHERE ci.user_id != new.id
      AND lower(trim(ci.email)) = norm_email
  LOOP
    INSERT INTO public.friend_joined_updates (recipient_id, new_user_id, contact_import_id)
    VALUES (r.recipient_id, new.id, r.contact_import_id);
  END LOOP;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_friend_joined ON auth.users;
CREATE TRIGGER on_auth_user_friend_joined
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.on_new_user_friend_joined();
