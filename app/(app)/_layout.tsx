import { useEffect, useRef, useState } from 'react';
import { Tabs, useRouter, usePathname } from 'expo-router';
import { View, Text, StyleSheet, BackHandler, Platform, DeviceEventEmitter } from 'react-native';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { MipoProvider, useMipo } from '@/contexts/MipoContext';
import { useUpdatesCount } from '@/contexts/UpdatesCountContext';
import { TabHighlightProvider, useTabHighlight, type TabName } from '@/contexts/TabHighlightContext';
import { ContactImportModal } from '@/components/ContactImportModal';
import { hasOfferedImport } from '@/lib/contactImport';
import { useAuth } from '@/contexts/AuthContext';
import { LOCATION_PERMISSION_DENIED_EVENT } from '@/lib/locationPermissionDenied';

function LocationPermissionDeniedHandler() {
  const { setVisible } = useMipo();
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      LOCATION_PERMISSION_DENIED_EVENT,
      (payload: { source: 'mipo' | 'live_location' }) => {
        const isMipo = payload.source === 'mipo';
        Toast.show({
          type: 'info',
          text1: isMipo ? 'Mipo visible mode turned off' : 'Live location stopped',
          text2: 'Location access was denied. Enable it in Settings to use this feature again.',
          visibilityTime: 4000,
        });
        if (isMipo) setVisible(false, null);
      }
    );
    return () => sub.remove();
  }, [setVisible]);
  return null;
}

function TabIcon({ name, focused, label }: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  focused: boolean;
  label: string;
}) {
  return (
    <View style={styles.tabIconContainer}>
      <View>
        <Ionicons name={name} size={24} color={focused ? Colors.primary : Colors.textSecondary} />
      </View>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1} allowFontScaling={false}>{label}</Text>
    </View>
  );
}

function TabIconWithHighlight({ tabName, focused, children }: { tabName: TabName; focused: boolean; children: (focused: boolean) => React.ReactNode }) {
  const { effectiveTab } = useTabHighlight();
  const pathname = usePathname();
  // Infer fallback tab when effectiveTab is null — ensures one tab is always highlighted
  const fallbackTab: TabName | null =
    pathname?.includes('/activity/new') ? 'events'
    : pathname?.includes('/activity/') ? 'chats'  // board, chat, post-chat, event detail
    : pathname?.includes('/circle/') ? 'circles'
    : null;
  const resolvedTab = effectiveTab ?? fallbackTab;
  const effectiveFocused = focused || resolvedTab === tabName;
  return <>{children(effectiveFocused)}</>;
}

function UpdatesTabIcon({ focused }: { focused: boolean }) {
  const { count } = useUpdatesCount();
  return (
    <View style={styles.tabIconContainer}>
      <View style={styles.badgeIconWrapper}>
        <Ionicons name={focused ? 'notifications' : 'notifications-outline'} size={24} color={focused ? Colors.primary : Colors.textSecondary} />
        {count > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
          </View>
        )}
      </View>
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1} allowFontScaling={false}>Updates</Text>
    </View>
  );
}

function MipoTabIcon({ focused }: { focused: boolean }) {
  const { visibleState } = useMipo();
  const isActive = visibleState.isVisible;
  const color = isActive ? Colors.success : (focused ? Colors.primary : Colors.textSecondary);
  const iconName = (isActive || focused ? 'location' : 'location-outline') as React.ComponentProps<typeof Ionicons>['name'];

  return (
    <View style={styles.tabIconContainer}>
      <View>
        <Ionicons name={iconName} size={24} color={color} />
      </View>
      <Text style={[styles.tabLabel, (focused || isActive) && styles.tabLabelActive, isActive && styles.tabLabelMipoActive]} numberOfLines={1} allowFontScaling={false}>Mipo</Text>
    </View>
  );
}

function AndroidBackHandler() {
  const pathname = usePathname();
  const router = useRouter();
  const doubleBackToExitPressedRef = useRef(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const isRoot = !pathname?.includes('/activity/') && !pathname?.includes('/circle/');
    const isUpdates = !pathname || pathname === '/' || pathname === '/index';

    // Reset double-back state when navigating away from Updates
    if (!isUpdates) {
      doubleBackToExitPressedRef.current = false;
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    }

    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!isRoot) return false; // Let nested screens (activity, circle) handle back

      if (isUpdates) {
        if (doubleBackToExitPressedRef.current) {
          BackHandler.exitApp();
          return true;
        }
        doubleBackToExitPressedRef.current = true;
        Toast.show({
          type: 'info',
          text1: 'Press back again to exit',
          position: 'bottom',
          bottomOffset: 100,
        });
        exitTimerRef.current = setTimeout(() => {
          doubleBackToExitPressedRef.current = false;
          exitTimerRef.current = null;
        }, 1000);
        return true;
      }

      // On other root tabs: go to Updates (home)
      router.replace('/(app)');
      return true;
    });

    return () => {
      sub.remove();
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
      }
    };
  }, [pathname, router]);

  return null;
}

function NotificationHandler() {
  const router = useRouter();
  useEffect(() => {
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as { type?: string; activityId?: string };
      if (data?.type === 'mipo_proximity') {
        router.push('/(app)/mipo');
      } else if (data?.activityId && ['chat', 'new_post', 'new_comment', 'rsvp_host', 'new_invite', 'limited_reopened', 'event_cancelled', 'event_deleted', 'host_ping'].includes(data.type ?? '')) {
        if (data.type === 'chat') {
          router.push(`/(app)/activity/${data.activityId}/chat?fromTab=chats`);
        } else if (data.type === 'new_post' || data.type === 'new_comment') {
          router.push(`/(app)/activity/${data.activityId}/board?fromTab=chats`);
        } else {
          router.push(`/(app)/activity/${data.activityId}?fromTab=events`);
        }
      }
    };
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) {
        handleResponse(last);
      }
    });
    return () => sub.remove();
  }, [router]);
  return null;
}

function ContactImportGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!user) return;
    hasOfferedImport().then((offered) => {
      setChecked(true);
      if (!offered) setShowModal(true);
    });
  }, [user]);

  return (
    <>
      {children}
      {checked && <ContactImportModal visible={showModal} onDismiss={() => setShowModal(false)} />}
    </>
  );
}

function TabBarContent() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      backBehavior="history"
      screenOptions={{ headerShown: false, tabBarShowLabel: false, tabBarStyle: [styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }] }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIconWithHighlight tabName="index" focused={focused}>
              {(f) => <UpdatesTabIcon focused={f} />}
            </TabIconWithHighlight>
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIconWithHighlight tabName="events" focused={focused}>
              {(f) => <TabIcon name={f ? 'calendar' : 'calendar-outline'} focused={f} label="Events" />}
            </TabIconWithHighlight>
          ),
        }}
      />
      <Tabs.Screen
        name="circles"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIconWithHighlight tabName="circles" focused={focused}>
              {(f) => <TabIcon name={f ? 'people' : 'people-outline'} focused={f} label="Circles" />}
            </TabIconWithHighlight>
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIconWithHighlight tabName="chats" focused={focused}>
              {(f) => <TabIcon name={f ? 'chatbubbles' : 'chatbubbles-outline'} focused={f} label="Discussions" />}
            </TabIconWithHighlight>
          ),
        }}
      />
      <Tabs.Screen
        name="mipo"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIconWithHighlight tabName="mipo" focused={focused}>
              {(f) => <MipoTabIcon focused={f} />}
            </TabIconWithHighlight>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIconWithHighlight tabName="profile" focused={focused}>
              {(f) => <TabIcon name={f ? 'person' : 'person-outline'} focused={f} label="Profile" />}
            </TabIconWithHighlight>
          ),
        }}
      />
      <Tabs.Screen name="circle/new"              options={{ href: null }} />
      <Tabs.Screen name="circle/[id]/index"      options={{ href: null }} />
      <Tabs.Screen name="circle/[id]/invite"     options={{ href: null }} />
      <Tabs.Screen name="activity/new"                    options={{ href: null }} />
      <Tabs.Screen name="activity/[id]/index"            options={{ href: null }} />
      <Tabs.Screen name="activity/[id]/chat"             options={{ href: null }} />
      <Tabs.Screen name="activity/[id]/post-chat/[postId]" options={{ href: null }} />
      <Tabs.Screen name="activity/[id]/board"            options={{ href: null }} />
      <Tabs.Screen name="activity/[id]/edit-changes"     options={{ href: null }} />
    </Tabs>
  );
}

export default function AppLayout() {
  useEffect(() => {
    console.warn('[App] Main app layout mounted (post-login)');
  }, []);
  return (
    <MipoProvider>
    <LocationPermissionDeniedHandler />
    <ContactImportGate>
    <TabHighlightProvider>
    <NotificationHandler />
    <AndroidBackHandler />
    <TabBarContent />
    </TabHighlightProvider>
    </ContactImportGate>
    </MipoProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingTop: 4,
  },
  tabIconContainer: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 60 },
  badgeIconWrapper: { position: 'relative' as const },
  tabLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: '500' },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  tabLabelActive: { color: Colors.primary, fontWeight: '600' },
  tabLabelMipoActive: { color: Colors.success },
});
