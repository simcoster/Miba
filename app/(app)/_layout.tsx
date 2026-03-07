import { useEffect, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { MipoProvider, useMipo } from '@/contexts/MipoContext';
import { useUpdatesCount } from '@/contexts/UpdatesCountContext';
import { ContactImportModal } from '@/components/ContactImportModal';
import { hasOfferedImport } from '@/lib/contactImport';
import { useAuth } from '@/contexts/AuthContext';

function TabIcon({ name, focused, label }: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  focused: boolean;
  label: string;
}) {
  return (
    <View style={styles.tabIconContainer}>
      <Ionicons name={name} size={24} color={focused ? Colors.primary : Colors.textSecondary} />
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]} numberOfLines={1} allowFontScaling={false}>{label}</Text>
    </View>
  );
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
      <Ionicons name={iconName} size={24} color={color} />
      <Text style={[styles.tabLabel, (focused || isActive) && styles.tabLabelActive, isActive && styles.tabLabelMipoActive]} numberOfLines={1} allowFontScaling={false}>Mipo</Text>
    </View>
  );
}

function NotificationHandler() {
  const router = useRouter();
  useEffect(() => {
    const handleResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as { type?: string; activityId?: string };
      if (data?.type === 'mipo_proximity') {
        router.push('/(app)/mipo');
      } else if (data?.activityId && ['chat', 'rsvp_host', 'new_invite', 'limited_reopened', 'event_cancelled'].includes(data.type ?? '')) {
        if (data.type === 'chat') {
          router.push(`/(app)/activity/${data.activityId}/chat`);
        } else {
          router.push(`/(app)/activity/${data.activityId}`);
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

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  return (
    <MipoProvider>
    <ContactImportGate>
    <NotificationHandler />
    <Tabs
      backBehavior="history"
      screenOptions={{ headerShown: false, tabBarShowLabel: false, tabBarStyle: [styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }] }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <UpdatesTabIcon focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="events"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'calendar' : 'calendar-outline'} focused={focused} label="Events" />
          ),
        }}
      />
      <Tabs.Screen
        name="circles"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'people' : 'people-outline'} focused={focused} label="Circles" />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'person' : 'person-outline'} focused={focused} label="Profile" />
          ),
        }}
      />
      <Tabs.Screen
        name="mipo"
        options={{
          tabBarIcon: ({ focused }) => <MipoTabIcon focused={focused} />,
        }}
      />
      <Tabs.Screen name="circle/new"              options={{ href: null }} />
      <Tabs.Screen name="circle/[id]/index"      options={{ href: null }} />
      <Tabs.Screen name="circle/[id]/invite"     options={{ href: null }} />
      <Tabs.Screen name="activity/new"                    options={{ href: null }} />
      <Tabs.Screen name="activity/[id]/index"            options={{ href: null }} />
      <Tabs.Screen name="activity/[id]/chat"             options={{ href: null }} />
      <Tabs.Screen name="activity/[id]/edit-changes"     options={{ href: null }} />
    </Tabs>
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
