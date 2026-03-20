import { Platform } from 'react-native';
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import {
  getBackgroundPermissionsAsync,
  requestBackgroundPermissionsAsync,
  requestForegroundPermissionsAsync,
  startLocationUpdatesAsync,
  stopLocationUpdatesAsync,
} from 'expo-location';
import { supabase } from '@/lib/supabase';
import { MIPO_LOCATION_TASK_NAME, setMipoActiveUserId } from './mipoLocationTask';

export type LocationSubscription = {
  remove: () => Promise<void>;
};

export type MipoVisibleModePermissionResult = {
  ok: boolean;
  missingPrecise?: boolean;
  missingBackground?: boolean;
  message?: string;
};

/**
 * Check if user has all permissions required for Mipo visible mode:
 * - Android: Foreground + precise location only (foreground service handles background tracking)
 * - iOS: Background / "all the time" permission (required for background location)
 * Returns a result object with ok and optional details about what's missing.
 */
export async function checkMipoVisibleModePermissions(): Promise<MipoVisibleModePermissionResult> {
  console.log('[Mipo] checkMipoVisibleModePermissions called');
  // Request foreground first so we have permission to check
  const fg = await requestForegroundPermissionsAsync();
  console.log('[Mipo] requestForegroundPermissionsAsync result:', fg.status, 'android:', (fg as { android?: { accuracy?: string } }).android?.accuracy);
  if (fg.status !== 'granted') {
    return {
      ok: false,
      message: 'Mipo needs location access to notify you when friends are nearby. Please enable it in Settings.',
    };
  }

  if (Platform.OS === 'android') {
    const androidAccuracy = (fg as { android?: { accuracy?: string } }).android?.accuracy;
    if (androidAccuracy !== 'fine') {
      return {
        ok: false,
        missingPrecise: true,
        message: 'Mipo needs precise location to detect when you and a friend are nearby. Please enable "Precise" location for Miba in Settings > Apps > Miba > Permissions.',
      };
    }
    // Android: foreground + precise is enough. Foreground service handles background tracking.
    return { ok: true };
  }

  // iOS: need background permission for background location updates
  const iosAccuracy = (fg as { ios?: { accuracy?: string } }).ios?.accuracy;
  if (iosAccuracy === 'reduced') {
    return {
      ok: false,
      missingPrecise: true,
      message: 'Mipo needs precise location to detect when you and a friend are nearby. Please enable "Precise Location" for Miba in Settings > Privacy > Location Services > Miba.',
    };
  }

  const bg = await getBackgroundPermissionsAsync();
  const bgGranted = bg.status === 'granted' || (await requestBackgroundLocationPermission());
  if (!bgGranted) {
    return {
      ok: false,
      missingBackground: true,
      message: 'Mipo needs "Allow all the time" location access to notify you when friends are nearby while the app is in the background. Please enable it in Settings > Privacy > Location Services > Miba.',
    };
  }

  return { ok: true };
}

/**
 * Request foreground location permission. Returns true if granted.
 */
export async function requestLocationPermission(): Promise<boolean> {
  console.log('[Mipo] requestLocationPermission called');
  const { status } = await requestForegroundPermissionsAsync();
  console.log('[Mipo] requestForegroundPermissionsAsync result:', status);
  return status === 'granted';
}

/**
 * Request background location permission. Required for Mipo to work when app is in background.
 * Returns true if granted.
 */
export async function requestBackgroundLocationPermission(): Promise<boolean> {
  const { status } = await requestBackgroundPermissionsAsync();
  return status === 'granted';
}

/**
 * Check if location permission is granted (foreground).
 */
export async function hasLocationPermission(): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * Check if the Mipo location foreground service is still running.
 * TaskManager.getRegisteredTasksAsync() is unreliable when the service is killed
 * (e.g. user swiped notification) - the task may still appear registered.
 */
export async function isMipoLocationRunning(): Promise<boolean> {
  try {
    const tasks = await TaskManager.getRegisteredTasksAsync();
    return tasks.some((t) => t.taskName === MIPO_LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

/** Threshold: if no location update in this many ms, service likely stopped. Location updates every ~5s.
 * Must be generous: location can be delayed (indoors, pocket, battery saver). Too low = premature turn-off. */
const MIPO_HEARTBEAT_STALE_MS = 90_000;

/**
 * Check if the Mipo session's last location update is stale.
 * The background task updates mipo_visible_sessions every ~5s. If updated_at
 * is older than threshold, the service likely stopped (e.g. user swiped notification).
 */
export async function isMipoLocationHeartbeatStale(userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('mipo_visible_sessions')
      .select('updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data?.updated_at) {
      console.log('[Mipo] Heartbeat stale: no session or updated_at');
      return true;
    }
    const updatedAt = new Date(data.updated_at).getTime();
    const ageMs = Date.now() - updatedAt;
    const stale = ageMs > MIPO_HEARTBEAT_STALE_MS;
    if (stale) {
      console.log('[Mipo] Heartbeat stale: last update', Math.round(ageMs / 1000), 's ago (threshold', MIPO_HEARTBEAT_STALE_MS / 1000, 's)');
    }
    return stale;
  } catch (e) {
    console.error('[Mipo] isMipoLocationHeartbeatStale exception:', e);
    return true;
  }
}

export type MipoTurnOffReason = 'heartbeat_stale' | 'location_permission_revoked' | 'unknown';

export type TurnOffLocationResult = { turnedOffMipo: boolean; turnedOffLiveLocation: boolean };

/**
 * When location permission is denied: if user has Mipo visible or active join me live location
 * for the given activity, turn them off silently. Returns what was turned off
 * (caller should NOT prompt to enable location; caller should call setVisible(false) if turnedOffMipo).
 */
export async function turnOffLocationSharingIfActiveWhenPermissionDenied(
  userId: string,
  activityId?: string
): Promise<TurnOffLocationResult> {
  const { turnOffActiveLiveLocationIfForActivity } = await import('./liveLocationPost');
  let turnedOffMipo = false;
  let turnedOffLiveLocation = false;
  const { data: session } = await supabase
    .from('mipo_visible_sessions')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (session) {
    await turnOffMipoVisibleMode(userId, 'location_permission_revoked');
    turnedOffMipo = true;
  }
  if (activityId) {
    turnedOffLiveLocation = await turnOffActiveLiveLocationIfForActivity(activityId, userId);
  }
  return { turnedOffMipo, turnedOffLiveLocation };
}

/**
 * Turn off Mipo visible mode: stop location updates, clear active user, delete session.
 * Use when the foreground service was killed (e.g. user swiped notification).
 */
export async function turnOffMipoVisibleMode(userId: string, reason: MipoTurnOffReason = 'unknown'): Promise<void> {
  console.log('[Mipo] turnOffMipoVisibleMode — reason:', reason);
  try {
    await stopLocationUpdatesAsync(MIPO_LOCATION_TASK_NAME);
  } catch {
    // Service may already be stopped
  }
  await setMipoActiveUserId(null);
  const { data: session } = await supabase
    .from('mipo_visible_sessions')
    .select('join_me_activity_id')
    .eq('user_id', userId)
    .maybeSingle();
  const activityId = session?.join_me_activity_id ?? null;
  if (activityId) {
    console.log('[Mipo] turnOffMipoVisibleMode: session has join_me_activity_id', activityId);
  }
  // Delete session; DB trigger on_mipo_session_deleted_delete_join_me deletes the linked activity (bypasses RLS)
  const { error: sessionError } = await supabase.from('mipo_visible_sessions').delete().eq('user_id', userId);
  if (sessionError) {
    console.error('[Mipo] turnOffMipoVisibleMode: failed to delete session:', sessionError);
  } else {
    console.log('[Mipo] turnOffMipoVisibleMode: session deleted successfully');
    if (activityId) {
      const { data: stillExists } = await supabase.from('activities').select('id').eq('id', activityId).maybeSingle();
      if (stillExists) {
        console.error('[Mipo] turnOffMipoVisibleMode: join me activity was NOT deleted:', activityId);
      } else {
        console.log('[Mipo] turnOffMipoVisibleMode: join me activity deleted correctly:', activityId);
      }
    }
  }
}

/**
 * Start location updates and sync to mipo_visible_sessions.
 * - Android: Uses a foreground service (persistent notification) - no background permission needed.
 * - iOS: Uses background location - requires "Allow all the time" permission.
 * Caller must ensure user is authenticated and has an active session row.
 */
export async function startMipoLocationWatch(
  userId: string,
  onError?: (error: Error) => void
): Promise<LocationSubscription | null> {
  console.log('[Mipo] startMipoLocationWatch called for userId:', userId);
  const foregroundGranted = await requestLocationPermission();
  if (!foregroundGranted) {
    console.log('[Mipo] startMipoLocationWatch: permission denied');
    onError?.(new Error('Location permission denied'));
    return null;
  }

  if (Platform.OS === 'ios') {
    const { status: bgStatus } = await getBackgroundPermissionsAsync();
    const backgroundGranted = bgStatus === 'granted' || (await requestBackgroundLocationPermission());
    if (!backgroundGranted) {
      onError?.(new Error('Background location permission denied. Mipo needs "Allow all the time" to notify you when friends are nearby. Please enable it in Settings.'));
      return null;
    }
  }

  await setMipoActiveUserId(userId);
  console.log('[Mipo] startMipoLocationWatch: starting location updates');
  await startLocationUpdatesAsync(MIPO_LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 10,
    timeInterval: 5000,
    showsBackgroundLocationIndicator: true,
    ...(Platform.OS === 'android' && {
      foregroundService: {
        notificationTitle: 'Mipo visible mode',
        notificationBody: 'Miba is tracking your location to notify you when friends are nearby.',
        notificationColor: '#F97316',
      },
    }),
  });

  return {
    remove: async () => {
      await stopLocationUpdatesAsync(MIPO_LOCATION_TASK_NAME);
      await setMipoActiveUserId(null);
    },
  };
}
