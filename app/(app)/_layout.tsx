import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';

function TabIcon({ name, focused, label }: {
  name: React.ComponentProps<typeof Ionicons>['name'];
  focused: boolean;
  label: string;
}) {
  return (
    <View style={styles.tabIconContainer}>
      <Ionicons name={name} size={24} color={focused ? Colors.primary : Colors.textSecondary} />
      <Text style={[styles.tabLabel, focused && styles.tabLabelActive]}>{label}</Text>
    </View>
  );
}

export default function AppLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarShowLabel: false, tabBarStyle: styles.tabBar }}>
      <Tabs.Screen
        name="index"
        options={{
          tabBarIcon: ({ focused }) => (
            <TabIcon name={focused ? 'home' : 'home-outline'} focused={focused} label="Home" />
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
      <Tabs.Screen name="circle/new"              options={{ href: null }} />
      <Tabs.Screen name="circle/[id]/index"      options={{ href: null }} />
      <Tabs.Screen name="circle/[id]/invite"     options={{ href: null }} />
      <Tabs.Screen name="activity/new"           options={{ href: null }} />
      <Tabs.Screen name="activity/[id]"          options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.border,
    height: 70, paddingBottom: 8, paddingTop: 4,
  },
  tabIconContainer: { alignItems: 'center', justifyContent: 'center', gap: 2 },
  tabLabel: { fontSize: 10, color: Colors.textSecondary, fontWeight: '500' },
  tabLabelActive: { color: Colors.primary, fontWeight: '600' },
});
