import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { Circle } from '@/lib/types';

export function CircleCard({ circle }: { circle: Circle }) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/(app)/circle/${circle.id}`)}
      activeOpacity={0.85}
    >
      <View style={styles.emojiContainer}>
        <Text style={styles.emoji}>{circle.emoji}</Text>
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>{circle.name}</Text>
        {circle.description && (
          <Text style={styles.description} numberOfLines={1}>{circle.description}</Text>
        )}
        {circle.is_admin && (
          <View style={styles.meta}>
            <Ionicons name="shield-checkmark-outline" size={13} color={Colors.primary} />
            <Text style={[styles.metaText, { color: Colors.primary }]}>Admin</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.border} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', gap: 14,
    shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  emojiContainer: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center',
  },
  emoji: { fontSize: 28 },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '700', color: Colors.text },
  description: { fontSize: 13, color: Colors.textSecondary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  metaText: { fontSize: 12, color: Colors.textSecondary },
});
