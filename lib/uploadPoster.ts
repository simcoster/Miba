/**
 * Upload poster image to Supabase Storage (low resolution).
 * Requires a "posters" bucket in Supabase Storage (create in Dashboard if needed).
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '@/lib/supabase';

const BUCKET = 'posters';
const MAX_WIDTH = 800;
const COMPRESS = 0.6;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

/**
 * Resize and upload poster image. Returns public URL or null on failure.
 * Retries up to MAX_RETRIES on network errors (common on mobile).
 */
export async function uploadPosterImage(
  localUri: string,
  activityId: string
): Promise<string | null> {
  console.log('[uploadPoster] Starting upload for activity', activityId);
  let manipulated: Awaited<ReturnType<typeof ImageManipulator.manipulateAsync>>;
  try {
    manipulated = await ImageManipulator.manipulateAsync(
      localUri,
      [{ resize: { width: MAX_WIDTH } }],
      { compress: COMPRESS, format: ImageManipulator.SaveFormat.JPEG }
    );
  } catch (e) {
    console.warn('[uploadPoster] Resize error:', e);
    return null;
  }

  // Use ArrayBuffer instead of Blob — Blob can cause "Network request failed" in React Native/Expo Go
  const response = await fetch(manipulated.uri);
  const arrayBuffer = await response.arrayBuffer();
  const path = `${activityId}.jpg`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .upload(path, arrayBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        });

      if (error) {
        console.warn('[uploadPoster] Upload error:', error);
        return null;
      }

      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
      console.log('[uploadPoster] Upload success:', urlData.publicUrl?.slice(0, 60) + '...');
      return urlData.publicUrl;
    } catch (e: any) {
      const isNetworkError =
        e?.message?.includes('Network request failed') ||
        e?.message?.includes('Failed to fetch') ||
        e?.name === 'AbortError';
      if (isNetworkError && attempt < MAX_RETRIES) {
        console.warn(`[uploadPoster] Attempt ${attempt}/${MAX_RETRIES} failed, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.warn('[uploadPoster] Error:', e);
        return null;
      }
    }
  }
  return null;
}
