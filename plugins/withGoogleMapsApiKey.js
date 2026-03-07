const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Adds com.google.android.geo.API_KEY to AndroidManifest for react-native-maps.
 * Set EXPO_PUBLIC_GOOGLE_PLACES_API_KEY in .env (used for both Places autocomplete and Maps).
 */
function withGoogleMapsApiKey(config) {
  return withAndroidManifest(config, async (config) => {
    const apiKey = config.extra?.googleMapsApiKey || process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';
    if (!apiKey.trim()) {
      console.warn('[withGoogleMapsApiKey] No API key found. Set EXPO_PUBLIC_GOOGLE_PLACES_API_KEY');
      return config;
    }

    const manifest = config.modResults;
    const application = manifest.application?.[0];
    if (!application) return config;

    if (!application['meta-data']) {
      application['meta-data'] = [];
    }

    // Remove existing entry if present
    application['meta-data'] = application['meta-data'].filter(
      (m) => m.$?.['android:name'] !== 'com.google.android.geo.API_KEY'
    );

    application['meta-data'].push({
      $: {
        'android:name': 'com.google.android.geo.API_KEY',
        'android:value': apiKey.trim(),
      },
    });

    return config;
  });
}

module.exports = withGoogleMapsApiKey;
