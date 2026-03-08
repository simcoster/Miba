import * as Linking from 'expo-linking';
import { Alert, Platform } from 'react-native';
import VersionCheck from 'react-native-version-check-expo';
import { supabase } from './supabase';

/**
 * Uses react-native-version-check (store API) for version comparison.
 * Fetches store URLs from Supabase (so they can be updated without a new build).
 * Fails silently if either check fails.
 */
export async function checkForStoreUpdate(): Promise<void> {
  try {
    const result = await VersionCheck.needUpdate({ ignoreErrors: true });
    if (!result?.isNeeded) return;

    // Fetch store URLs from Supabase (override provider URLs for TestFlight/internal)
    const { data: rows } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['store_url_ios', 'store_url_android']);

    const config = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
    const storeUrl =
      Platform.OS === 'ios'
        ? (config.store_url_ios ?? (await VersionCheck.getStoreUrl()))
        : (config.store_url_android ?? (await VersionCheck.getStoreUrl()));

    if (!storeUrl) return;

    Alert.alert(
      'Update Available',
      'A new version of Miba is available. Please update to get the latest features.',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Update', onPress: () => Linking.openURL(storeUrl) },
      ]
    );
  } catch {
    // Silently ignore — store API may fail (TestFlight, internal testing, etc.)
  }
}
