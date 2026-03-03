import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Miba',
  slug: 'miba',
  owner: 'simcoster',
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://qfdxnpryufkgdstergej.supabase.co',
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZHhucHJ5dWZrZ2RzdGVyZ2VqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzE0MzEsImV4cCI6MjA4Nzk0NzQzMX0.dVnuYQgYaTwFm0p7ndDYTVA6Cifx1Awo1GXuUbO_J7E',
    eas: {
      projectId: '2085bc90-aea9-4f54-be69-f93013f3cd39',
    },
  },
});
