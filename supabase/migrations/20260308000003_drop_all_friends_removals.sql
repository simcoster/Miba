-- Remove all_friends_removals: "removed from All Friends" no longer tracked.
-- Removing from All Friends just means they're no longer in any circle;
-- they can still be invited to events and will be re-added to All Friends if added to any other circle.

DROP TABLE IF EXISTS public.all_friends_removals;
