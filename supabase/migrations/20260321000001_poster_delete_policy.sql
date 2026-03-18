-- Allow activity creators to delete their poster from storage when deleting an activity.
-- Poster path is {activity_id}.jpg in the posters bucket.
CREATE POLICY "Creators can delete own activity posters"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'posters'
    AND EXISTS (
      SELECT 1 FROM public.activities a
      WHERE a.id::text = split_part(name, '.', 1)
      AND a.created_by = auth.uid()
    )
  );
