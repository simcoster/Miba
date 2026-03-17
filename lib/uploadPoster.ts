/**
 * Upload poster image to Supabase Storage (low resolution).
 * Requires a "posters" bucket in Supabase Storage (create in Dashboard if needed).
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';

const BUCKET = 'posters';
const MAX_WIDTH = 800;
const COMPRESS = 0.6;

/**
 * Resize and upload poster image. Returns public URL or null on failure.
 */
export async function uploadPosterImage(
  localUri: string,
  activityId: string
): Promise<string | null> {
  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: MAX_WIDTH } }],
      { compress: COMPRESS, format: ImageManipulator.SaveFormat.JPEG }
    );

    const response = await fetch(manipulated.uri);
    const blob = await response.blob();

    const path = `${activityId}.jpg`;

    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      console.warn('[uploadPoster] Upload error:', error);
      return null;
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (e) {
    console.warn('[uploadPoster] Error:', e);
    return null;
  }
}
