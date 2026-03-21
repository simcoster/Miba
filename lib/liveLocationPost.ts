/**
 * Live location post: foreground service for sharing location in a post's chat.
 * Mirrors mipoLocation.ts but updates chat_location_shares instead of mipo_visible_sessions.
 */
import { Platform } from 'react-native';
import * as Location from 'expo-location';

const LOCATION_RETRY_DELAY_MS = 3000;

/**
 * Phase 1: Fire getLastKnownPositionAsync and getCurrentPositionAsync(Low) in parallel.
 * Whichever returns first → place the pin and continue with Low.
 * If both fail (e.g. location just re-enabled, GPS warming up), retry Low after a delay.
 * Phase 2: When Low has returned, call getCurrentPositionAsync(High). When High returns, hot-swap (onHighAccuracy).
 */
export async function getLocationQuickThenAccurate(
  onHighAccuracy: (loc: Location.LocationObject) => void | Promise<void>
): Promise<Location.LocationObject | null> {
  const lastKnownP = Location.getLastKnownPositionAsync();
  let lowP = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });

  // Phase 1: first of lastKnown or Low → place pin; retry Low if both fail (only for transient errors)
  let resolved = false;
  let lowSettled = false;
  let lowResult: Location.LocationObject | null = null;
  let lowError: string | null = null;

  const tryResolve = (resolve: (loc: Location.LocationObject | null) => void, loc: Location.LocationObject | null) => {
    if (resolved) return;
    if (loc) {
      resolved = true;
      resolve(loc);
    }
  };

  const isTransientLocationError = (msg: string) =>
    msg.includes('unavailable') || msg.includes('timeout') || msg.includes('timed out');

  const first = await new Promise<Location.LocationObject | null>((resolve) => {
    lastKnownP.then((loc) => {
      console.log('[LiveLocation] getLastKnownPositionAsync returned', loc ? 'ok' : 'null');
      tryResolve(resolve, loc);
    }).catch((e) => {
      console.log('[LiveLocation] getLastKnownPositionAsync failed', (e as Error).message);
    });

    const handleLowResult = (loc: Location.LocationObject | null, err?: string) => {
      lowSettled = true;
      lowResult = loc;
      if (err) lowError = err;
      if (loc) {
        console.log('[LiveLocation] getCurrentPositionAsync(Low) returned');
        tryResolve(resolve, loc);
      }
    };

    lowP.then((loc) => handleLowResult(loc)).catch((e) => {
      const msg = (e as Error).message;
      console.log('[LiveLocation] getCurrentPositionAsync(Low) failed', msg);
      handleLowResult(null, msg);
    });

    lastKnownP.finally(() => {
      if (resolved) return;
      if (lowSettled && !lowResult && lowError && !isTransientLocationError(lowError)) {
        resolved = true;
        resolve(null);
      }
    });

    // Retry Low only for transient errors (e.g. GPS warming up). Skip retry for "device settings" etc.
    const retryTimeout = setTimeout(async () => {
      if (resolved) return;
      if (!lowSettled) return; // Low still pending, wait for it
      if (lowResult) return; // Low succeeded
      if (lowError && !isTransientLocationError(lowError)) {
        resolved = true;
        resolve(null);
        return;
      }
      console.log('[LiveLocation] Retrying getCurrentPositionAsync(Low) after', LOCATION_RETRY_DELAY_MS, 'ms');
      try {
        lowP = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        const loc = await lowP;
        console.log('[LiveLocation] getCurrentPositionAsync(Low) retry returned');
        tryResolve(resolve, loc);
      } catch (e) {
        console.log('[LiveLocation] getCurrentPositionAsync(Low) retry failed', (e as Error).message);
      }
    }, LOCATION_RETRY_DELAY_MS);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearTimeout(retryTimeout);
        resolve(null);
      }
    }, 20000);
  });

  if (!first) return null;

  // Phase 2: wait for Low (or retry), then call High and hot-swap when it returns
  (async () => {
    try {
      await lowP;
      console.log('[LiveLocation] Low done, now calling High');
      const highLoc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      console.log('[LiveLocation] getCurrentPositionAsync(High) returned');
      if (highLoc) onHighAccuracy(highLoc);
    } catch (e) {
      console.log('[LiveLocation] High failed', (e as Error).message);
    }
  })();

  return first;
}

import { addMinutes } from 'date-fns';
import {
  getBackgroundPermissionsAsync,
  getForegroundPermissionsAsync,
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
import {
  requestBackgroundLocationPermission,
  checkMipoVisibleModePermissions,
  turnOffLocationSharingIfActiveWhenPermissionDenied,
  requestLocationPermission,
} from './mipoLocation';

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
  let { status } = await getForegroundPermissionsAsync();
  if (status !== 'granted') {
    const req = await requestForegroundPermissionsAsync();
    status = req.status;
    console.log('[LiveLocationPost] requestForegroundPermissionsAsync result:', status);
  }
  const foregroundGranted = status === 'granted';
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
 * Stop live location post sharing: stop task, delete creator row.
 * @param closeChat - If true (default), sets chat_closed_at. If false, keeps chat open (e.g. when location failed but user may re-enable).
 */
export async function turnOffLiveLocationPost(
  postId: string,
  userId: string,
  closeChat: boolean = true
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
  if (closeChat) {
    await supabase.from('posts').update({ chat_closed_at: new Date().toISOString() }).eq('id', postId);
  }
}

/**
 * Create live location post and start sharing. For join me: pass isJoinMe=true (never expires).
 * Returns postId or null. Caller should navigate to post-chat on success.
 * For join me: if a live location post already exists, returns its id (join me has only 1).
 */
export async function createAndStartLiveLocationForActivity(
  activityId: string,
  userId: string,
  isJoinMe: boolean,
  minutes: number | null,
  options?: { setVisible?: (v: boolean, expiresAt: Date | null) => void }
): Promise<string | null> {
  if (isJoinMe) {
    const { data: existing } = await supabase
      .from('posts')
      .select('id')
      .eq('activity_id', activityId)
      .eq('post_type', 'live_location')
      .is('chat_closed_at', null)
      .maybeSingle();
    if (existing) return existing.id;
  }
  const permResult = await checkMipoVisibleModePermissions();
  if (!permResult.ok) {
    const { turnedOffMipo, turnedOffLiveLocation } = await turnOffLocationSharingIfActiveWhenPermissionDenied(userId, activityId);
    if (turnedOffMipo && options?.setVisible) options.setVisible(false, null);
    return null;
  }
  await Location.enableNetworkProviderAsync().catch(() => {});
  let postIdForUpdate: string | null = null;
  const loc = await getLocationQuickThenAccurate((highLoc) => {
    if (postIdForUpdate) {
      supabase
        .from('chat_location_shares')
        .update({
          lat: highLoc.coords.latitude,
          lng: highLoc.coords.longitude,
          updated_at: new Date().toISOString(),
        })
        .eq('post_id', postIdForUpdate)
        .eq('user_id', userId);
    }
  });
  if (!loc) return null;
  const now = new Date();
  const expiresAt = isJoinMe || minutes === null ? null : addMinutes(now, minutes);
  const { data: post, error: postError } = await supabase
    .from('posts')
    .insert({
      activity_id: activityId,
      user_id: userId,
      content: 'Live Location',
      post_type: 'live_location',
      creator_expires_at: expiresAt?.toISOString() ?? null,
    })
    .select('id')
    .single();
  if (postError || !post) return null;
  postIdForUpdate = post.id;
  const { error: shareError } = await supabase.from('chat_location_shares').insert({
    activity_id: activityId,
    post_id: post.id,
    user_id: userId,
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    updated_at: now.toISOString(),
    expires_at: expiresAt?.toISOString() ?? null,
  });
  if (shareError) {
    await supabase.from('posts').delete().eq('id', post.id);
    return null;
  }
  const sub = await startLiveLocationPostWatch(post.id, userId, expiresAt, activityId);
  if (!sub) {
    await supabase.from('chat_location_shares').delete().eq('post_id', post.id).eq('user_id', userId);
    await supabase.from('posts').delete().eq('id', post.id);
    return null;
  }
  return post.id;
}

/**
 * Start sharing location in an existing live location chat (add user's pin).
 * Same as post-chat's "Share location" - inserts row, chat's poll will update it.
 * Returns true on success.
 */
export async function startSharingLocationInChat(
  postId: string,
  activityId: string,
  userId: string
): Promise<boolean> {
  const granted = await requestLocationPermission();
  if (!granted) return false;
  const loc = await getLocationQuickThenAccurate((highLoc) => {
    supabase
      .from('chat_location_shares')
      .update({
        lat: highLoc.coords.latitude,
        lng: highLoc.coords.longitude,
        updated_at: new Date().toISOString(),
      })
      .eq('post_id', postId)
      .eq('user_id', userId);
  });
  if (!loc) return false;
  const { error } = await supabase.from('chat_location_shares').insert({
    activity_id: activityId,
    post_id: postId,
    user_id: userId,
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    updated_at: new Date().toISOString(),
  });
  return !error;
}
