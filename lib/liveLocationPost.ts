/**
 * Live location post: foreground service for sharing location in a post's chat.
 * Mirrors mipoLocation.ts but updates chat_location_shares instead of mipo_visible_sessions.
 */
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import {
  getBackgroundPermissionsAsync,
  requestForegroundPermissionsAsync,
  startLocationUpdatesAsync,
  stopLocationUpdatesAsync,
} from 'expo-location';
import { supabase } from '@/lib/supabase';
import {
  LIVE_LOCATION_POST_TASK_NAME,
  setLiveLocationPostActive,
  clearLiveLocationPostActive,
  getLiveLocationPostActive,
} from './liveLocationPostTask';
import { requestBackgroundLocationPermission } from './mipoLocation';

export type LiveLocationPostSubscription = {
  remove: () => Promise<void>;
};

/**
 * Start location updates for a live location post. Updates chat_location_shares.
 * Caller must have already inserted the creator row into chat_location_shares.
 */
export async function startLiveLocationPostWatch(
  postId: string,
  userId: string,
  expiresAt: Date | null,
  activityId: string,
  onError?: (error: Error) => void
): Promise<LiveLocationPostSubscription | null> {
  console.log('[LiveLocationPost] startLiveLocationPostWatch called for postId:', postId);
  const { status } = await requestForegroundPermissionsAsync();
  const foregroundGranted = status === 'granted';
  console.log('[LiveLocationPost] requestForegroundPermissionsAsync result:', status);
  if (!foregroundGranted) {
    onError?.(new Error('Location permission denied'));
    return null;
  }

  if (Platform.OS === 'ios') {
    const { status: bgStatus } = await getBackgroundPermissionsAsync();
    const backgroundGranted =
      bgStatus === 'granted' || (await requestBackgroundLocationPermission());
    if (!backgroundGranted) {
      onError?.(
        new Error(
          'Background location permission denied. Live location needs "Allow all the time" to share while the app is in the background. Please enable it in Settings.'
        )
      );
      return null;
    }
  }

  await setLiveLocationPostActive(postId, userId, expiresAt?.toISOString() ?? null);
  try {
    console.log('[LiveLocationPost] calling startLocationUpdatesAsync');
    await startLocationUpdatesAsync(LIVE_LOCATION_POST_TASK_NAME, {
      accuracy: Location.Accuracy.High,
      distanceInterval: 10,
      timeInterval: 5000,
      showsBackgroundLocationIndicator: true,
      ...(Platform.OS === 'android' && {
        foregroundService: {
          notificationTitle: 'Live location',
          notificationBody: 'Sharing your location with the event.',
          notificationColor: '#F97316',
        },
      }),
    });
    console.log('[LiveLocationPost] startLocationUpdatesAsync succeeded');
  } catch (e) {
    console.warn('[LiveLocationPost] startLocationUpdatesAsync failed:', (e as Error).message, '| full:', e);
    await clearLiveLocationPostActive();
    return null;
  }

  return {
    remove: async () => {
      await stopLocationUpdatesAsync(LIVE_LOCATION_POST_TASK_NAME);
      await clearLiveLocationPostActive();
    },
  };
}

/**
 * If the user has any active live location share, turn it off.
 * Returns true if we turned it off. Use when permission is denied and we need to clean up.
 */
export async function turnOffActiveLiveLocationIfAny(userId: string): Promise<boolean> {
  const active = await getLiveLocationPostActive();
  if (!active || active.userId !== userId) return false;
  await turnOffLiveLocationPost(active.postId, userId);
  return true;
}

/**
 * If the user has an active live location share for the given activity, turn it off.
 * Returns true if we turned it off.
 */
export async function turnOffActiveLiveLocationIfForActivity(
  activityId: string,
  userId: string
): Promise<boolean> {
  const active = await getLiveLocationPostActive();
  if (!active) return false;
  const { data: post } = await supabase
    .from('posts')
    .select('activity_id')
    .eq('id', active.postId)
    .maybeSingle();
  if (!post || post.activity_id !== activityId) return false;
  await turnOffLiveLocationPost(active.postId, userId);
  return true;
}

/**
 * Stop live location post sharing: stop task, delete creator row, close chat.
 */
export async function turnOffLiveLocationPost(
  postId: string,
  userId: string
): Promise<void> {
  try {
    await stopLocationUpdatesAsync(LIVE_LOCATION_POST_TASK_NAME);
  } catch {
    // Service may already be stopped
  }
  await clearLiveLocationPostActive();
  await supabase
    .from('chat_location_shares')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  await supabase.from('posts').update({ chat_closed_at: new Date().toISOString() }).eq('id', postId);
}
