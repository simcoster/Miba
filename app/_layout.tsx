import '@/lib/mipoLocationTask'; // Register background location task early
import '@/lib/liveLocationPostTask'; // Register live location post task early
import { installGlobalErrorHandler } from '@/lib/reportError';
installGlobalErrorHandler();

// Log when bundle loads (helps trace OAuth redirect — Metro may disconnect when app is backgrounded)
if (__DEV__) {
  const loadTime = new Date().toISOString();
  console.warn('[App] Bundle loaded at', loadTime);
}
import { checkForStoreUpdate, checkForOTAUpdate } from '@/lib/versionCheck';
import { ensureBannersCached } from '@/lib/bannerCache';
import { deleteOldActivitiesForUser } from '@/lib/deleteOldActivities';
import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import Toast from 'react-native-toast-message';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { UpdatesCountProvider } from '@/contexts/UpdatesCountContext';

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    console.log('[Layout:Auth] effect', { loading, hasSession: !!session, segments: segments.join('/') });
    if (loading) return;
    SplashScreen.hideAsync();
    const inAuthGroup = segments[0] === '(auth)';
    if (!session && !inAuthGroup) {
      console.log('[Layout:Auth] No session, redirecting to login');
      router.replace('/(auth)/login');
    } else if (session && inAuthGroup) {
      console.warn('[Layout:Auth] Post-login redirect to app');
      router.replace('/(app)');
    }
  }, [session, loading, segments]);

  // Failsafe: hide splash after 8s if auth init hangs (e.g. no network, Supabase slow)
  useEffect(() => {
    const t = setTimeout(() => SplashScreen.hideAsync(), 8000);
    return () => clearTimeout(t);
  }, []);

  // Check for store update (Supabase: latest_version, store URLs) — runs after a short delay
  useEffect(() => {
    const t = setTimeout(() => checkForStoreUpdate(), 3000);
    return () => clearTimeout(t);
  }, []);

  // Check for OTA update on load — fetches and reloads if new update available
  useEffect(() => {
    const t = setTimeout(() => checkForOTAUpdate(), 2000);
    return () => clearTimeout(t);
  }, []);

  // Fetch banners from Supabase and cache locally on first load
  useEffect(() => {
    ensureBannersCached();
  }, []);

  // Delete user's activities older than 30 days (runs in background when logged in)
  useEffect(() => {
    if (!session?.user?.id) return;
    const t = setTimeout(() => deleteOldActivitiesForUser(session.user.id), 5000);
    return () => clearTimeout(t);
  }, [session?.user?.id]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.flex}>
      <SafeAreaProvider>
        <AuthProvider>
          <UpdatesCountProvider>
            <StatusBar style="dark" />
            <RootLayoutNav />
            <Toast />
          </UpdatesCountProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
