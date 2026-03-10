import { Platform } from 'react-native';
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
  // Request foreground first so we have permission to check
  const fg = await requestForegroundPermissionsAsync();
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
 * Start location updates and sync to mipo_visible_sessions.
 * - Android: Uses a foreground service (persistent notification) - no background permission needed.
 * - iOS: Uses background location - requires "Allow all the time" permission.
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

  if (Platform.OS === 'ios') {
    const { status: bgStatus } = await getBackgroundPermissionsAsync();
    const backgroundGranted = bgStatus === 'granted' || (await requestBackgroundLocationPermission());
    if (!backgroundGranted) {
      onError?.(new Error('Background location permission denied. Mipo needs "Allow all the time" to notify you when friends are nearby. Please enable it in Settings.'));
      return null;
    }
  }

  await setMipoActiveUserId(userId);
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
