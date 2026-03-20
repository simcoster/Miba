/**
 * Background location task for Mipo visible mode.
 * Must be imported early (e.g. in app/_layout.tsx) so the task is registered before use.
 */
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocationObject } from 'expo-location';
import { supabase } from '@/lib/supabase';
import { isLocationPermissionError, emitLocationPermissionDenied } from '@/lib/locationPermissionDenied';

export const MIPO_LOCATION_TASK_NAME = 'mipo-background-location';
const MIPO_ACTIVE_USER_KEY = 'mipo_active_user_id';

export async function setMipoActiveUserId(userId: string | null): Promise<void> {
  if (userId) {
    await AsyncStorage.setItem(MIPO_ACTIVE_USER_KEY, userId);
  } else {
    await AsyncStorage.removeItem(MIPO_ACTIVE_USER_KEY);
  }
}

TaskManager.defineTask<{ locations: LocationObject[] }>(MIPO_LOCATION_TASK_NAME, async ({ data, error }) => {
  if (__DEV__ && !error && data?.locations?.length) {
    console.log('[Mipo] Task received location update');
  }
  if (error) {
    console.warn('[Mipo] Background location task error:', error.message, '| full:', JSON.stringify(error));
    const userId = await AsyncStorage.getItem(MIPO_ACTIVE_USER_KEY);
    try {
      await Location.stopLocationUpdatesAsync(MIPO_LOCATION_TASK_NAME);
    } catch (e) {
      console.warn('[Mipo] stopLocationUpdatesAsync failed:', e);
    }
    await setMipoActiveUserId(null);
    if (userId) {
      await supabase.from('mipo_visible_sessions').delete().eq('user_id', userId);
    }
    if (isLocationPermissionError(error)) {
      console.log('[Mipo] Emitting permission-denied (error matched permission/accuracy pattern)');
      emitLocationPermissionDenied('mipo');
    } else {
      console.log('[Mipo] Stopped due to error (not permission pattern) — prevents repeated retries');
    }
    return;
  }
  if (!data?.locations?.length) return;

  const userId = await AsyncStorage.getItem(MIPO_ACTIVE_USER_KEY);
  if (!userId) return;

  const { latitude, longitude } = data.locations[data.locations.length - 1].coords;
  const { error: updateError } = await supabase
    .from('mipo_visible_sessions')
    .update({
      lat: latitude,
      lng: longitude,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (updateError) {
    console.warn('[Mipo] Background location update error:', updateError.message);
  }
});
