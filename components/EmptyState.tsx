import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';

type EmptyStateProps = {
  emoji?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
};

export function EmptyState({ emoji = '🤷', title, subtitle, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {action && <View style={styles.action}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, paddingVertical: 60,
  },
  emoji: { fontSize: 56, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 8 },
  subtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  action: { marginTop: 24, width: '100%' },
});
