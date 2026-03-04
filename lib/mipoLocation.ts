import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';

export type LocationSubscription = {
  remove: () => void;
};

/**
 * Request location permission. Returns true if granted.
 */
export async function requestLocationPermission(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * Check if location permission is granted.
 */
export async function hasLocationPermission(): Promise<boolean> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === 'granted';
}

/**
 * Start watching position and upserting to mipo_visible_sessions.
 * Caller must ensure user is authenticated and has an active session row.
 */
export async function startMipoLocationWatch(
  userId: string,
  onError?: (error: Error) => void
): Promise<LocationSubscription | null> {
  const granted = await requestLocationPermission();
  if (!granted) {
    onError?.(new Error('Location permission denied'));
    return null;
  }

  const subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      distanceInterval: 10,
      timeInterval: 5000,
    },
    async (location) => {
      const { coords } = location;
      const { error } = await supabase
        .from('mipo_visible_sessions')
        .update({
          lat: coords.latitude,
          lng: coords.longitude,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      if (error) {
        console.warn('[Mipo] Location upsert error:', error);
        onError?.(new Error(error.message));
      }
    }
  );

  return subscription;
}
