import React from 'react';
import { View, Text, TouchableOpacity, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/Colors';

type RightAction = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  label?: string;
  badge?: boolean;
  /** When true, shows spinner and disables press */
  loading?: boolean;
};

type RightActionPeek = {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPressIn: () => void;
  onPressOut: () => void;
};

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  /** Override the back button behaviour. Defaults to router.back(). */
  onBack?: () => void;
  /** When provided, the title becomes tappable and calls this on press. */
  onTitlePress?: () => void;
  /** Single right action (legacy). Use rightActions for multiple. */
  rightAction?: RightAction;
  /** Multiple right actions rendered left-to-right. Takes precedence over rightAction. */
  rightActions?: RightAction[];
  /** Peek button: shows on press-in, hides on press-out (e.g. for hold-to-preview). */
  rightActionPeek?: RightActionPeek;
};

export function ScreenHeader({ title, subtitle, showBack = false, onBack, onTitlePress, rightAction, rightActions, rightActionPeek }: ScreenHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const actions = rightActions ?? (rightAction ? [rightAction] : []);
  const hasRightContent = actions.length > 0 || rightActionPeek;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.row}>
        {showBack && (
          <TouchableOpacity onPress={onBack ?? (() => router.back())} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color={Colors.text} />
          </TouchableOpacity>
        )}
        <View style={styles.titleContainer}>
          {onTitlePress ? (
            <TouchableOpacity onPress={onTitlePress} activeOpacity={0.7} style={styles.titleTouchable}>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.title} numberOfLines={1}>{title}</Text>
              {subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
            </>
          )}
        </View>
        {hasRightContent ? (
          <View style={styles.rightActions}>
            {actions.map((a, i) => (
              <TouchableOpacity
                key={i}
                onPress={a.loading ? undefined : a.onPress}
                disabled={a.loading}
                style={styles.rightButton}
              >
                {a.label
                  ? <Text style={styles.rightButtonLabel}>{a.label}</Text>
                  : a.loading ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <View>
                      <Ionicons name={a.icon} size={24} color={Colors.primary} />
                      {a.badge && <View style={styles.badge} />}
                    </View>
                  )
                }
              </TouchableOpacity>
            ))}
            {rightActionPeek && (
              <Pressable
                style={styles.rightButton}
                onPressIn={rightActionPeek.onPressIn}
                onPressOut={rightActionPeek.onPressOut}
                accessibilityLabel="Peek at event details"
              >
                <Ionicons name={rightActionPeek.icon} size={24} color={Colors.primary} />
              </Pressable>
            )}
          </View>
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
  titleTouchable: { alignSelf: 'flex-start' },
  title: { fontSize: 22, fontWeight: '700', color: Colors.text },
  subtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
  rightActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rightButton: { width: 44, height: 40, alignItems: 'flex-end', justifyContent: 'center' },
  rightButtonLabel: { fontSize: 16, fontWeight: '600', color: Colors.primary },
  placeholder: { width: 44 },
  badge: {
    position: 'absolute', top: -1, right: -1,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: Colors.danger,
    borderWidth: 1.5, borderColor: Colors.background,
  },
});
