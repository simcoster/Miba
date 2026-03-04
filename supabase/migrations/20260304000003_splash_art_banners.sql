-- Update splash_art to use banner_1 through banner_12 (local images)
-- Migrate old preset values to null (they no longer exist)
UPDATE public.activities SET splash_art = NULL
WHERE splash_art IS NOT NULL
  AND splash_art NOT IN ('banner_1', 'banner_2', 'banner_3', 'banner_4', 'banner_5', 'banner_6', 'banner_7', 'banner_8', 'banner_9', 'banner_10', 'banner_11', 'banner_12');

-- Drop existing check constraint and add new one
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_splash_art_check;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_splash_art_check
  CHECK (splash_art IS NULL OR splash_art IN (
    'banner_1', 'banner_2', 'banner_3', 'banner_4', 'banner_5', 'banner_6',
    'banner_7', 'banner_8', 'banner_9', 'banner_10', 'banner_11', 'banner_12'
  ));
