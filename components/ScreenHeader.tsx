import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  rightAction?: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    onPress: () => void;
    label?: string;
  };
};

export function ScreenHeader({ title, subtitle, showBack = false, rightAction }: ScreenHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.row}>
        {showBack && (
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </TouchableOpacity>
        )}
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {rightAction ? (
          <TouchableOpacity onPress={rightAction.onPress} style={styles.rightButton}>
            {rightAction.label
              ? <Text style={styles.rightButtonLabel}>{rightAction.label}</Text>
              : <Ionicons name={rightAction.icon} size={24} color={Colors.primary} />
            }
          </TouchableOpacity>
        ) : (
          <View style={styles.placeholder} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background, paddingBottom: 12, paddingHorizontal: 20,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  backButton: { width: 40, height: 40, alignItems: 'flex-start', justifyContent: 'center', marginRight: 4 },
  titleContainer: { flex: 1 },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  rightButton: { width: 44, height: 40, alignItems: 'flex-end', justifyContent: 'center' },
  rightButtonLabel: { fontSize: 16, fontWeight: '600', color: Colors.primary },
  placeholder: { width: 44 },
});
