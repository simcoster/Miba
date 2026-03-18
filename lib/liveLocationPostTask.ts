/**
 * Background location task for live location post sharing.
 * Updates chat_location_shares for the creator's post.
 * Must be imported early (e.g. in app/_layout.tsx) so the task is registered before use.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationObject } from 'expo-location';
import { supabase } from '@/lib/supabase';

export const LIVE_LOCATION_POST_TASK_NAME = 'live-location-post-background';
const LIVE_LOCATION_POST_ID_KEY = 'live_location_post_id';
const LIVE_LOCATION_USER_ID_KEY = 'live_location_user_id';
const LIVE_LOCATION_EXPIRES_AT_KEY = 'live_location_expires_at';

export async function setLiveLocationPostActive(
  postId: string,
  userId: string,
  expiresAt: string | null
): Promise<void> {
  await AsyncStorage.setItem(LIVE_LOCATION_POST_ID_KEY, postId);
  await AsyncStorage.setItem(LIVE_LOCATION_USER_ID_KEY, userId);
  if (expiresAt) {
    await AsyncStorage.setItem(LIVE_LOCATION_EXPIRES_AT_KEY, expiresAt);
  } else {
    await AsyncStorage.removeItem(LIVE_LOCATION_EXPIRES_AT_KEY);
  }
}

export async function clearLiveLocationPostActive(): Promise<void> {
  await AsyncStorage.multiRemove([
    LIVE_LOCATION_POST_ID_KEY,
    LIVE_LOCATION_USER_ID_KEY,
    LIVE_LOCATION_EXPIRES_AT_KEY,
  ]);
}

export async function getLiveLocationPostActive(): Promise<{
  postId: string;
  userId: string;
  expiresAt: string | null;
} | null> {
  const [postId, userId] = await Promise.all([
    AsyncStorage.getItem(LIVE_LOCATION_POST_ID_KEY),
    AsyncStorage.getItem(LIVE_LOCATION_USER_ID_KEY),
  ]);
  if (!postId || !userId) return null;
  const expiresAt = await AsyncStorage.getItem(LIVE_LOCATION_EXPIRES_AT_KEY);
  return { postId, userId, expiresAt };
}

TaskManager.defineTask<{ locations: LocationObject[] }>(
  LIVE_LOCATION_POST_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      console.warn('[LiveLocationPost] Background location task error:', error.message);
      return;
    }
    if (!data?.locations?.length) return;

    const stored = await getLiveLocationPostActive();
    if (!stored) return;

    const { postId, userId, expiresAt } = stored;
    if (expiresAt && new Date(expiresAt) <= new Date()) {
      await supabase.from('posts').update({ chat_closed_at: new Date().toISOString() }).eq('id', postId);
      await clearLiveLocationPostActive();
      try {
        await Location.stopLocationUpdatesAsync(LIVE_LOCATION_POST_TASK_NAME);
      } catch {
        // Already stopped
      }
      return;
    }

    const { latitude, longitude } = data.locations[data.locations.length - 1].coords;
    const { error: updateError } = await supabase
      .from('chat_location_shares')
      .update({
        lat: latitude,
        lng: longitude,
        updated_at: new Date().toISOString(),
      })
      .eq('post_id', postId)
      .eq('user_id', userId);

    if (updateError) {
      console.warn('[LiveLocationPost] Background location update error:', updateError.message);
    }
  }
);
