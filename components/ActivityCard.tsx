import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import Colors from '@/constants/Colors';
import { Activity, RsvpStatus } from '@/lib/types';
import { Avatar } from './Avatar';
import { LocationDisplay } from './LocationDisplay';

const INVITED_BLUE = '#3B82F6';
const INVITED_BLUE_LIGHT = '#EFF6FF';

type RsvpConfig = {
  iconName: React.ComponentProps<typeof Ionicons>['name'];
  iconColor: string;
  bg: string;
  label: string;
  textColor: string;
};

const RSVP_CONFIG: Record<RsvpStatus, RsvpConfig> = {
  in: { iconName: 'checkmark-circle', iconColor: Colors.success, bg: Colors.successLight, label: "You're in!", textColor: Colors.success },
  maybe: { iconName: 'help-circle', iconColor: Colors.warning, bg: Colors.warningLight, label: 'Maybe', textColor: Colors.warning },
  out: { iconName: 'close-circle', iconColor: Colors.danger, bg: Colors.dangerLight, label: "Can't go", textColor: Colors.danger },
  pending: { iconName: 'mail-open-outline', iconColor: INVITED_BLUE, bg: INVITED_BLUE_LIGHT, label: 'Invited', textColor: INVITED_BLUE },
};
const HOSTING_CONFIG: RsvpConfig = { iconName: 'star', iconColor: Colors.primary, bg: Colors.accentLight, label: 'Hosting', textColor: Colors.primary };

const isHebrew = (s: string) => /[\u0590-\u05FF]/.test(s);

type EventsFilter = 'upcoming' | 'invited' | 'past' | 'declined';

export function ActivityCard({ activity, fromTab }: { activity: Activity; fromTab?: EventsFilter }) {
  const router = useRouter();
  const activityDate = new Date(activity.activity_time);
  const past = isPast(activityDate);
  const goingCount = activity.going_count ?? activity.rsvps?.filter(r => r.status === 'in').length ?? 0;
  const myRsvp = activity.my_rsvp;
  const isPending = myRsvp?.status === 'pending';
  const isHost = activity.created_by === myRsvp?.user_id;
  // Host who is going shows "Hosting" badge; others use their RSVP status
  const displayStatus = (isHost && myRsvp?.status === 'in') ? 'hosting' : myRsvp?.status;
  const rsvpConfig = displayStatus ? (RSVP_CONFIG[displayStatus as RsvpStatus] ?? (displayStatus === 'hosting' ? HOSTING_CONFIG : null)) : null;

  const dateLabel = isToday(activityDate)
    ? `Today · ${format(activityDate, 'h:mm a')}`
    : isTomorrow(activityDate)
    ? `Tomorrow · ${format(activityDate, 'h:mm a')}`
    : format(activityDate, 'EEE, MMM d · h:mm a');

  const href = fromTab ? `/(app)/activity/${activity.id}?fromTab=${fromTab}` : `/(app)/activity/${activity.id}`;

  return (
    <TouchableOpacity
      style={[styles.card, past && styles.cardPast, isPending && !past && styles.cardPending]}
      onPress={() => router.push(href as any)}
      activeOpacity={0.85}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {activity.status === 'cancelled' && (
            <View style={styles.cancelledBadge}>
              <Text style={styles.cancelledBadgeText}>Cancelled</Text>
            </View>
          )}
          {activity.is_new && !(isHost && myRsvp?.status === 'in') && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>New</Text>
            </View>
          )}
        </View>

        <View style={styles.headerRight}>
          {activity.has_new_messages && <View style={styles.newMsgDot} />}
          {rsvpConfig && (
            <View style={[styles.rsvpBadge, { backgroundColor: rsvpConfig.bg }]}>
              <Ionicons name={rsvpConfig.iconName} size={13} color={rsvpConfig.iconColor} />
              <Text style={[styles.rsvpBadgeText, { color: rsvpConfig.textColor }]}>
                {rsvpConfig.label}
              </Text>
            </View>
          )}
        </View>
      </View>

      <Text style={[styles.title, past && styles.titlePast, isHebrew(activity.title) && styles.titleRtl]} numberOfLines={2}>
        {activity.title}
      </Text>

      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.metaText}>{dateLabel}</Text>
        </View>
        {activity.location && (
          <LocationDisplay location={activity.location} variant="card" />
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
  cardPending: { borderWidth: 2, borderColor: INVITED_BLUE },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cancelledBadge: {
    backgroundColor: Colors.dangerLight, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  cancelledBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.danger },
  newBadge: {
    backgroundColor: INVITED_BLUE, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20,
  },
  newBadgeText: { fontSize: 10, fontWeight: '700', color: '#fff', letterSpacing: 0.3 },
  newMsgDot: {
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  rsvpBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  rsvpBadgeText: { fontSize: 11, fontWeight: '600' },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 10, lineHeight: 24 },
  titlePast: { color: Colors.textSecondary },
  titleRtl: { textAlign: 'right' },
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
