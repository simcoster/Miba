import { ExpoConfig, ConfigContext } from 'expo/config';

const pkg = require('./package.json');
const version = pkg.version as string;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Miba',
  slug: 'miba',
  owner: 'simcoster',
  plugins: [
    ...(config.plugins ?? []),
    './plugins/withGoogleMapsApiKey.js',
    './plugins/withAndroidReleaseSigning.js',
    '@react-native-firebase/app',
    '@react-native-firebase/crashlytics',
    [
      'expo-location',
      {
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/images/icon.png',
        color: '#F97316',
        defaultChannel: 'activity-updates',
        sounds: ['./assets/sounds/match_playful.mp3'],
      },
    ],
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          buildToolsVersion: '35.0.0',
        },
        ios: {
          useFrameworks: 'static',
          buildReactNativeFromSource: true,
        },
      },
    ],
  ],
  ios: {
    ...(config.ios ?? {}),
    // EAS Build: add GOOGLE_SERVICES_PLIST env var (file type). Local: use ./GoogleService-Info.plist
    googleServicesFile: process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Miba uses your location for Mipo visible mode so you can be notified when you and a friend are nearby.',
      NSLocationAlwaysAndWhenInUseUsageDescription: 'Miba uses your location for Mipo visible mode so you can be notified when you and a friend are nearby.',
    },
  },
  android: {
    ...config.android,
    permissions: ['ACCESS_FINE_LOCATION'],
    // EAS Build: use GOOGLE_SERVICES_JSON env var (file type). Local: use ./google-services.json
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
    // Maps SDK needs key in manifest at build time. Use GOOGLE_MAPS_API_KEY or EXPO_PUBLIC_GOOGLE_PLACES_API_KEY in EAS.
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '',
      },
    },
  },
  updates: {
    url: `https://u.expo.dev/${config.extra?.eas?.projectId ?? '2085bc90-aea9-4f54-be69-f93013f3cd39'}`,
    fallbackToCacheTimeout: 0,
  },
  version,
  runtimeVersion: version,
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://qfdxnpryufkgdstergej.supabase.co',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZHhucHJ5dWZrZ2RzdGVyZ2VqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzE0MzEsImV4cCI6MjA4Nzk0NzQzMX0.dVnuYQgYaTwFm0p7ndDYTVA6Cifx1Awo1GXuUbO_J7E',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '',
    eas: {
      projectId: '2085bc90-aea9-4f54-be69-f93013f3cd39',
    },
  },
});
