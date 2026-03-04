import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** Android channel for Mipo proximity notifications - ensures they show when app is in background */
const MIPO_CHANNEL_ID = 'mipo-proximity';

/**
 * Register for push notifications and store token in profiles.push_token.
 * Call on app init or when user logs in.
 */
export async function registerForPushNotifications(userId: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(MIPO_CHANNEL_ID, {
      name: 'Mipo',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '2085bc90-aea9-4f54-be69-f93013f3cd39',
  });
  const token = tokenData.data;

  await supabase.from('profiles').update({ push_token: token }).eq('id', userId);
  return token;
}
