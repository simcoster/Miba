import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import Colors from '@/constants/Colors';
import { Activity } from '@/lib/types';
import { Avatar } from './Avatar';

export function ActivityCard({ activity }: { activity: Activity }) {
  const router = useRouter();
  const activityDate = new Date(activity.activity_time);
  const past = isPast(activityDate);
  const goingCount = activity.going_count ?? activity.rsvps?.filter(r => r.status === 'in').length ?? 0;
  const myRsvp = activity.my_rsvp;

  const dateLabel = isToday(activityDate)
    ? `Today · ${format(activityDate, 'h:mm a')}`
    : isTomorrow(activityDate)
    ? `Tomorrow · ${format(activityDate, 'h:mm a')}`
    : format(activityDate, 'EEE, MMM d · h:mm a');

  return (
    <TouchableOpacity
      style={[styles.card, past && styles.cardPast]}
      onPress={() => router.push(`/(app)/activity/${activity.id}`)}
      activeOpacity={0.85}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {activity.status === 'cancelled' && (
            <View style={styles.cancelledBadge}>
              <Text style={styles.cancelledBadgeText}>Cancelled</Text>
            </View>
          )}
        </View>
        {myRsvp?.status === 'in' && (
          <View style={styles.goingBadge}>
            <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
            <Text style={styles.goingBadgeText}>You're in!</Text>
          </View>
        )}
      </View>

      <Text style={[styles.title, past && styles.titlePast]} numberOfLines={2}>
        {activity.title}
      </Text>

      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.metaText}>{dateLabel}</Text>
        </View>
        {activity.location && (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={14} color={Colors.textSecondary} />
            <Text style={styles.metaText} numberOfLines={1}>{activity.location}</Text>
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.avatarStack}>
          {activity.rsvps
            ?.filter(r => r.status === 'in')
            .slice(0, 4)
            .map((rsvp, i) => (
              <View key={rsvp.id} style={[styles.avatarWrapper, { left: i * 20 }]}>
                <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={28} />
              </View>
            ))}
        </View>
        <Text style={styles.goingCount}>
          {goingCount > 0 ? `${goingCount} ${goingCount === 1 ? 'person' : 'people'} going` : 'Be the first to join!'}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 16, marginBottom: 12,
    shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  cardPast: { opacity: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  cancelledBadge: {
    backgroundColor: Colors.dangerLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  cancelledBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.danger },
  goingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  goingBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.success },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 10, lineHeight: 24 },
  titlePast: { color: Colors.textSecondary },
  meta: { gap: 4, marginBottom: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 13, color: Colors.textSecondary, flex: 1 },
  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 10,
  },
  avatarStack: { flexDirection: 'row', height: 28, minWidth: 28, position: 'relative' },
  avatarWrapper: { position: 'absolute', borderWidth: 2, borderColor: Colors.surface, borderRadius: 14 },
  goingCount: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
});
