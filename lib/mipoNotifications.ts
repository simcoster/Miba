import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false, // Silent by default; loud option for events can be added later
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Android channels - ensure notifications show when app is in background */
const MIPO_CHANNEL_ID = 'mipo-proximity';
const ACTIVITY_UPDATES_CHANNEL_ID = 'activity-updates';

export type PushRegistrationResult = {
  success: boolean;
  token: string | null;
  error: string | null;
};

/**
 * Register for push notifications and store token in profiles.push_token.
 * Call on app init or when user logs in.
 */
export async function registerForPushNotifications(userId: string): Promise<PushRegistrationResult> {
  if (Platform.OS === 'web') {
    console.log('[Push] Skipped on web');
    return { success: false, token: null, error: 'Web platform' };
  }

  try {
    if (Platform.OS === 'android') {
      // Delete existing channel so we can recreate with updated settings.
      // Android channels are immutable; old channel may have had different sound/importance.
      try {
        await Notifications.deleteNotificationChannelAsync(MIPO_CHANNEL_ID);
      } catch {
        // Channel may not exist yet
      }
      await Notifications.setNotificationChannelAsync(MIPO_CHANNEL_ID, {
        name: 'Mipo',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'match_playful.mp3',
      });
      await Notifications.setNotificationChannelAsync(ACTIVITY_UPDATES_CHANNEL_ID, {
        name: 'Events & Messages',
        importance: Notifications.AndroidImportance.LOW,
        sound: null,
      });
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[Push] Permission denied, status:', finalStatus);
      return { success: false, token: null, error: `Permission ${finalStatus}` };
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '2085bc90-aea9-4f54-be69-f93013f3cd39',
    });
    const token = tokenData.data;

    const { error } = await supabase.from('profiles').update({ push_token: token }).eq('id', userId);
    if (error) {
      console.error('[Push] Supabase update failed:', error.message);
      return { success: false, token, error: error.message };
    }

    console.log('[Push] Registered OK, token:', token?.slice(0, 30) + '...');
    return { success: true, token, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Push] Registration failed:', msg);
    return { success: false, token: null, error: msg };
  }
}
