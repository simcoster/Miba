const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * Adds com.google.android.geo.API_KEY to AndroidManifest for react-native-maps.
 * Set GOOGLE_MAPS_API_KEY or EXPO_PUBLIC_GOOGLE_PLACES_API_KEY in .env
 */
function withGoogleMapsApiKey(config) {
  return withAndroidManifest(config, async (config) => {
    const apiKey = config.extra?.googleMapsApiKey || process.env.GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';
    if (!apiKey.trim()) {
      console.warn('[withGoogleMapsApiKey] No API key found. Set GOOGLE_MAPS_API_KEY or EXPO_PUBLIC_GOOGLE_PLACES_API_KEY');
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
