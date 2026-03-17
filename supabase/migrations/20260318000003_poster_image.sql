-- Poster image for events created from poster (From Poster AI feature)
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS poster_image_url text;

COMMENT ON COLUMN public.activities.poster_image_url IS 'Supabase Storage URL of the original poster image (low res), when event was created from poster.';

-- Create posters storage bucket (create via Dashboard if this fails)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'posters',
  'posters',
  true,
  524288,
  '{"image/jpeg","image/png","image/webp"}'
)
ON CONFLICT (id) DO NOTHING;

-- RLS: authenticated users can upload
CREATE POLICY "Users can upload posters"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'posters');

-- RLS: anyone can read (public bucket)
CREATE POLICY "Public read posters"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'posters');
