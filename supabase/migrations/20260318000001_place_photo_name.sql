-- Add place_photo_name for Google Places API photo (replaces splash_art when set)
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS place_photo_name text;

COMMENT ON COLUMN public.activities.place_photo_name IS 'Google Places API photo resource name (places/PLACE_ID/photos/PHOTO_ID). When set, used as event cover instead of splash_art.';
