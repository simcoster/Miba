-- Migration — Limited events: max participants (excluding host), first-come-first-served

-- 1. Add columns to activities
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS is_limited boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_participants smallint,
  ADD COLUMN IF NOT EXISTS limited_closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS limited_reopened_at timestamptz;

-- Check: if limited, max_participants must be set and >= 1 (spots for friends)
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_limited_check;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_limited_check
  CHECK ((NOT is_limited) OR (is_limited AND max_participants IS NOT NULL AND max_participants >= 1));

-- 2. Trigger: Host RSVP lock (BEFORE UPDATE) — host cannot change RSVP for limited events
CREATE OR REPLACE FUNCTION public.limited_host_rsvp_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.activities a
    WHERE a.id = NEW.activity_id AND a.is_limited = true AND a.created_by = NEW.user_id
  ) AND NEW.status != 'in' THEN
    RAISE EXCEPTION 'Host cannot change RSVP in limited events';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS limited_host_rsvp_lock_trigger ON public.rsvps;
CREATE TRIGGER limited_host_rsvp_lock_trigger
  BEFORE UPDATE ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.limited_host_rsvp_lock();

-- 3. Trigger: Close/Reopen (AFTER INSERT OR UPDATE) — max excludes host
CREATE OR REPLACE FUNCTION public.limited_close_reopen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_activity record;
  v_going_count int;
BEGIN
  SELECT a.id, a.is_limited, a.max_participants, a.limited_closed_at, a.activity_time
  INTO v_activity
  FROM public.activities a
  WHERE a.id = COALESCE(NEW.activity_id, OLD.activity_id);

  IF NOT FOUND OR NOT v_activity.is_limited OR v_activity.max_participants IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Count non-host rows with status 'in'
  SELECT COUNT(*)::int INTO v_going_count
  FROM public.rsvps r
  JOIN public.activities a ON a.id = r.activity_id
  WHERE r.activity_id = v_activity.id
    AND r.status = 'in'
    AND r.user_id != a.created_by;

  -- Close: non-host going count >= max
  IF v_going_count >= v_activity.max_participants THEN
    UPDATE public.activities
    SET limited_closed_at = now(), limited_reopened_at = NULL
    WHERE id = v_activity.id AND limited_closed_at IS NULL;
  ELSIF v_activity.limited_closed_at IS NOT NULL AND v_activity.activity_time > now() AND v_going_count < v_activity.max_participants THEN
    -- Reopen: count dropped below max and event time hasn't passed
    UPDATE public.activities
    SET limited_closed_at = NULL, limited_reopened_at = now()
    WHERE id = v_activity.id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS limited_close_reopen_trigger ON public.rsvps;
CREATE TRIGGER limited_close_reopen_trigger
  AFTER INSERT OR UPDATE OF status ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.limited_close_reopen();

-- 4. Activities RLS: closed limited events visible only to host and 'in' participants
DROP POLICY IF EXISTS "Creators and invitees can view activities" ON public.activities;
CREATE POLICY "Creators and invitees can view activities"
  ON public.activities FOR SELECT USING (
    created_by = auth.uid()
    OR (
      public.is_activity_invitee(id)
      AND (
        (coalesce(is_limited, false) = false OR limited_closed_at IS NULL)
        OR EXISTS (
          SELECT 1 FROM public.rsvps r
          WHERE r.activity_id = id AND r.user_id = auth.uid() AND r.status = 'in'
        )
      )
    )
  );

-- 5. RSVP RLS: for limited events, non-host sees only 'in' rows
DROP POLICY IF EXISTS "Invitees can view RSVPs" ON public.rsvps;
CREATE POLICY "Invitees can view RSVPs"
  ON public.rsvps FOR SELECT USING (
    public.is_activity_invitee(activity_id)
    AND (
      EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND a.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND (coalesce(a.is_limited, false) = false))
      OR (status = 'in' AND EXISTS (SELECT 1 FROM public.activities a WHERE a.id = activity_id AND coalesce(a.is_limited, false) = true AND a.created_by != auth.uid()))
    )
  );
