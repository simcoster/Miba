/**
 * Android floating chat bubble for Mipo DMs.
 * Shows a draggable bubble that, when tapped, opens the chat via deep link.
 * Android only; no-op on other platforms.
 * Lazy-loads the native module to avoid crashing in Expo Go.
 */

import { Platform, Linking, Alert, Dimensions } from 'react-native';

let ExpoFloatingBubble: { addListener: (e: string, cb: (d: unknown) => void) => { remove: () => void }; canDrawOverlays: () => Promise<boolean>; requestOverlayPermission: () => void; showBubble: (opts: object) => void; hideBubble: () => void } | null = null;
try {
  ExpoFloatingBubble = require('expo-floating-bubble').default;
} catch {
  // Expo Go or missing native module — bubble not available
}

const BUBBLE_COLOR = 0xfff97316; // Colors.primary (orange) in ARGB

let currentActivityId: string | null = null;
let tapSubscription: { remove: () => void } | null = null;
let hiddenSubscription: { remove: () => void } | null = null;

function setupListeners() {
  if (!ExpoFloatingBubble || tapSubscription) return;
  tapSubscription = ExpoFloatingBubble.addListener('onBubbleTapped', () => {
    console.log('[chatBubble] onBubbleTapped, currentActivityId:', currentActivityId);
    if (currentActivityId) {
      Linking.openURL(`miba://activity/${currentActivityId}/chat?fromTab=mipo`);
    }
  });
  hiddenSubscription = ExpoFloatingBubble!.addListener('onBubbleHidden', () => {
    console.log('[chatBubble] onBubbleHidden');
    currentActivityId = null;
  });
  ExpoFloatingBubble!.addListener('onBubbleShown', (e: { success?: boolean; reason?: string }) => {
    console.log('[chatBubble] onBubbleShown:', e);
    if (e.success === false && e.reason) {
      Alert.alert('Chat bubble unavailable', e.reason);
    }
  });
}

export async function canShowChatBubble(): Promise<boolean> {
  if (Platform.OS !== 'android' || !ExpoFloatingBubble) return false;
  try {
    return await ExpoFloatingBubble.canDrawOverlays();
  } catch {
    return false;
  }
}

export function requestChatBubblePermission(): void {
  if (Platform.OS !== 'android' || !ExpoFloatingBubble) return;
  ExpoFloatingBubble.requestOverlayPermission();
}

export async function showChatBubble(activityId: string, avatarUrl?: string | null): Promise<boolean> {
  console.log('[chatBubble] showChatBubble called, activityId:', activityId, 'Platform:', Platform.OS, 'module:', !!ExpoFloatingBubble);
  if (Platform.OS !== 'android' || !ExpoFloatingBubble) {
    console.log('[chatBubble] early return: not android or no module');
    return false;
  }
  try {
    const hasPermission = await ExpoFloatingBubble.canDrawOverlays();
    console.log('[chatBubble] canDrawOverlays:', hasPermission);
    if (!hasPermission) {
      Alert.alert(
        'Permission required',
        'Enable "Display over other apps" to use the chat bubble. You can turn it off anytime in Settings.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => ExpoFloatingBubble!.requestOverlayPermission() },
        ]
      );
      return false;
    }
    setupListeners();
    currentActivityId = activityId;

    // Position on right side, vertically centered (bubble is ~60dp = ~180px)
    const { width: screenW, height: screenH } = Dimensions.get('window');
    const bubbleSize = 60 * (Platform.OS === 'android' ? 3 : 2); // rough px
    const initialX = Math.max(20, screenW - bubbleSize - 40);
    const initialY = Math.max(100, screenH / 2 - bubbleSize / 2);

    // Use avatar URL if it's http/https (Supabase storage); file:// can fail on Android 10+
    const iconUri = avatarUrl && (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://'))
      ? avatarUrl
      : undefined;

    const opts = {
      ...(iconUri && { iconUri }),
      bubbleColor: BUBBLE_COLOR,
      initialX,
      initialY,
    };
    console.log('[chatBubble] calling showBubble with:', opts);
    ExpoFloatingBubble!.showBubble(opts);
    console.log('[chatBubble] showBubble called, returning true');
    return true;
  } catch (e) {
    console.warn('[chatBubble] showBubble error:', e);
    return false;
  }
}

export function hideChatBubble(): void {
  if (Platform.OS !== 'android' || !ExpoFloatingBubble) return;
  try {
    ExpoFloatingBubble.hideBubble();
    currentActivityId = null;
  } catch (e) {
    console.warn('[chatBubble] hideBubble error:', e);
  }
}

export function isChatBubbleActive(): boolean {
  return currentActivityId !== null;
}

export function getActiveChatActivityId(): string | null {
  return currentActivityId;
}

/** True when the native bubble module is available (dev build on Android). False in Expo Go. */
export function isChatBubbleAvailable(): boolean {
  return Platform.OS === 'android' && ExpoFloatingBubble !== null;
}
