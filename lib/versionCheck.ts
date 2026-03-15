import * as Application from 'expo-application';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import { Alert, Platform } from 'react-native';
import { supabase } from './supabase';

/**
 * Checks for OTA updates on app load. If a new update is available, fetches and reloads immediately.
 * Fails silently in development or when expo-updates is disabled.
 */
export async function checkForOTAUpdate(): Promise<void> {
  try {
    if (!Updates.isEnabled) return;
    const result = await Updates.fetchUpdateAsync();
    if (result.isNew && !result.isRollBackToEmbedded) {
      await Updates.reloadAsync();
    }
  } catch {
    // Silently ignore — dev mode, network error, or expo-updates disabled
  }
}

/**
 * Checks Supabase app_config for min_build_number and store URLs.
 * Shows update alert if app build number is below min_build_number.
 * Expo/EAS manages build numbers (autoIncrement); update min_build_number when you release.
 * Fails silently on error.
 */
export async function checkForStoreUpdate(): Promise<void> {
  try {
    const { data: rows } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['min_build_number', 'store_url_ios', 'store_url_android']);

    const config = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
    const minBuildStr = config.min_build_number;
    if (!minBuildStr) return;

    const minBuild = parseInt(minBuildStr, 10);
    if (isNaN(minBuild)) return;

    const currentBuildStr = Application.nativeBuildVersion ?? '0';
    const currentBuild = parseInt(currentBuildStr, 10) || 0;
    if (currentBuild >= minBuild) return;

    const storeUrl =
      Platform.OS === 'ios'
        ? config.store_url_ios
        : config.store_url_android;
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
    // Silently ignore — network/config may be unavailable
  }
}
