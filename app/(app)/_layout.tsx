import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { MipoProvider, useMipo } from '@/contexts/MipoContext';

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

function MipoTabIcon({ focused }: { focused: boolean }) {
  const { visibleState } = useMipo();
  const isActive = visibleState.isVisible;
  const color = isActive ? Colors.success : (focused ? Colors.primary : Colors.textSecondary);
  const iconName = (isActive || focused ? 'radar' : 'radar-outline') as React.ComponentProps<typeof Ionicons>['name'];
  return (
    <View style={styles.tabIconContainer}>
      <Ionicons name={iconName} size={24} color={color} />
      <Text style={[styles.tabLabel, (focused || isActive) && styles.tabLabelActive, isActive && styles.tabLabelMipoActive]} numberOfLines={1} allowFontScaling={false}>Mipo</Text>
    </View>
  );
}

export default function AppLayout() {
  const insets = useSafeAreaInsets();
  return (
    <MipoProvider>
    <Tabs
      backBehavior="history"
      screenOptions={{ headerShown: false, tabBarShowLabel: false, tabBarStyle: [styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }] }}
    >
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'notifications' : 'notifications-outline'} focused={focused} label="Updates" />
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
    </MipoProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
    paddingTop: 4,
  },
  tabIconContainer: { alignItems: 'center', justifyContent: 'center', gap: 2, minWidth: 60 },
  tabLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: '500' },
  tabLabelActive: { color: Colors.primary, fontWeight: '600' },
  tabLabelMipoActive: { color: Colors.success },
});
