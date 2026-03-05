import * as Location from 'expo-location';
import {
  getBackgroundPermissionsAsync,
  requestBackgroundPermissionsAsync,
  requestForegroundPermissionsAsync,
  startLocationUpdatesAsync,
  stopLocationUpdatesAsync,
} from 'expo-location';
import { MIPO_LOCATION_TASK_NAME, setMipoActiveUserId } from './mipoLocationTask';

export type LocationSubscription = {
  remove: () => Promise<void>;
};

/**
 * Request foreground location permission. Returns true if granted.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await requestForegroundPermissionsAsync();
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
 * Start background location updates and sync to mipo_visible_sessions.
 * Works when app is in foreground AND background.
 * Caller must ensure user is authenticated and has an active session row.
 */
export async function startMipoLocationWatch(
  userId: string,
  onError?: (error: Error) => void
): Promise<LocationSubscription | null> {
  const foregroundGranted = await requestLocationPermission();
  if (!foregroundGranted) {
    onError?.(new Error('Location permission denied'));
    return null;
  }

  // Require background location - "Allow all the time" on Android
  const { status: bgStatus } = await getBackgroundPermissionsAsync();
  const backgroundGranted = bgStatus === 'granted' || (await requestBackgroundLocationPermission());
  if (!backgroundGranted) {
    onError?.(new Error('Background location permission denied. Mipo needs "Allow all the time" (or "Allow while using app" + background) to notify you when friends are nearby. Please enable it in Settings.'));
    return null;
  }

  await setMipoActiveUserId(userId);
  await startLocationUpdatesAsync(MIPO_LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 10,
    timeInterval: 5000,
    showsBackgroundLocationIndicator: true,
  });

  return {
    remove: async () => {
      await stopLocationUpdatesAsync(MIPO_LOCATION_TASK_NAME);
      await setMipoActiveUserId(null);
    },
  };
}
