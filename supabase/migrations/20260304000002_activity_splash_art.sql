-- Add optional splash art preset to activities (coffee, nature, sport, food, music)
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS splash_art text
  CHECK (splash_art IS NULL OR splash_art IN ('coffee', 'nature', 'sport', 'food', 'music'));
