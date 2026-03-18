import React, { useRef } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { TouchableOpacity } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import Colors from '@/constants/Colors';
import { Activity, RsvpStatus, isJoinMeNow } from '@/lib/types';
import { Avatar } from './Avatar';
import { LocationDisplay } from './LocationDisplay';
import { SplashArt } from './SplashArt';
import { getActivityCoverProps, hasActivityCover } from '@/lib/activityCover';

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
const HIDDEN_CONFIG: RsvpConfig = { iconName: 'eye-off-outline', iconColor: Colors.textSecondary, bg: Colors.borderLight, label: 'Hidden', textColor: Colors.textSecondary };

const isHebrew = (s: string) => /[\u0590-\u05FF]/.test(s);

type EventsFilter = 'upcoming' | 'invited' | 'past' | 'declined';

const HIDE_ACTION_BG = '#6B7280';
const UNHIDE_ACTION_BG = Colors.success;

export function ActivityCard({
  activity,
  fromTab,
  onDelete,
  isDeleting,
  isHidden,
  onHide,
  onUnhide,
  visitedDetails,
}: {
  activity: Activity;
  fromTab?: EventsFilter;
  onDelete?: () => void;
  isDeleting?: boolean;
  isHidden?: boolean;
  onHide?: () => void;
  onUnhide?: () => void;
  /** True when user has visited the activity details page (hides New badge) */
  visitedDetails?: boolean;
}) {
  const router = useRouter();
  const activityDate = new Date(activity.activity_time);
  const past = isPast(activityDate);
  const goingCount = activity.going_count ?? activity.rsvps?.filter(r => r.status === 'in').length ?? 0;
  const myRsvp = activity.my_rsvp;
  const isPending = myRsvp?.status === 'pending';
  const isHost = activity.created_by === myRsvp?.user_id;
  // Host: show both "Hosting" and RSVP status (You're in!, Maybe, etc.); non-host: just RSVP status
  const hostingConfig = isHost ? HOSTING_CONFIG : null;
  const rsvpStatus = myRsvp?.status;
  const rsvpConfig = rsvpStatus ? RSVP_CONFIG[rsvpStatus as RsvpStatus] : null;

  const dateLabel = isJoinMeNow(activity)
    ? 'Now'
    : isToday(activityDate)
    ? `Today · ${format(activityDate, 'h:mm a')}`
    : isTomorrow(activityDate)
    ? `Tomorrow · ${format(activityDate, 'h:mm a')}`
    : format(activityDate, 'EEE, MMM d · h:mm a');

  const href = fromTab ? `/(app)/activity/${activity.id}?fromTab=${fromTab}` : `/(app)/activity/${activity.id}`;

  const handleDeletePress = () => {
    Alert.alert('Delete event', 'This will permanently delete the event and all its discussions, location chats, and live location sessions. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          swipeableRef.current?.reset();
          onDelete?.();
        },
      },
    ]);
  };

  const cardContent = (
    <TouchableOpacity
      style={[
        styles.card,
        past && fromTab === 'past' && styles.cardPast,
        isPending && !past && styles.cardPending,
        isDeleting && styles.cardDeleting,
      ]}
      onPress={isDeleting ? undefined : () => router.push(href as any)}
      activeOpacity={0.85}
      disabled={isDeleting}
    >
      <View style={styles.cardContent}>
      {getActivityCoverProps(activity) ? (
        <View style={styles.splashBlockWrapper}>
          <View style={styles.splashBlock}>
            <SplashArt {...getActivityCoverProps(activity)!} height={90} opacity={0.5} resizeMode="cover" />
          </View>
          <View style={styles.badgesOverlay}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {activity.status === 'cancelled' && (
            <View style={styles.cancelledBadge}>
              <Text style={styles.cancelledBadgeText}>Cancelled</Text>
            </View>
          )}
          {isHidden && (
            <View style={[styles.rsvpBadge, { backgroundColor: HIDDEN_CONFIG.bg }]}>
              <Ionicons name={HIDDEN_CONFIG.iconName} size={13} color={HIDDEN_CONFIG.iconColor} />
              <Text style={[styles.rsvpBadgeText, { color: HIDDEN_CONFIG.textColor }]}>
                {HIDDEN_CONFIG.label}
              </Text>
            </View>
          )}
          {activity.is_new && !visitedDetails && !(isHost && myRsvp?.status === 'in') && (
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>New</Text>
            </View>
          )}
        </View>

        <View style={styles.headerRight}>
          {activity.has_new_messages && <View style={styles.newMsgDot} />}
          {past && fromTab === 'upcoming' && (
            <View style={[styles.rsvpBadge, { backgroundColor: Colors.borderLight }]}>
              <Text style={[styles.rsvpBadgeText, { color: Colors.textSecondary }]}>Started</Text>
            </View>
          )}
          {hostingConfig && (
            <View style={[styles.rsvpBadge, { backgroundColor: hostingConfig.bg }]}>
              <Ionicons name={hostingConfig.iconName} size={13} color={hostingConfig.iconColor} />
              <Text style={[styles.rsvpBadgeText, { color: hostingConfig.textColor }]}>
                {hostingConfig.label}
              </Text>
            </View>
          )}
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
          </View>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {activity.status === 'cancelled' && (
              <View style={styles.cancelledBadge}>
                <Text style={styles.cancelledBadgeText}>Cancelled</Text>
              </View>
            )}
            {isHidden && (
              <View style={[styles.rsvpBadge, { backgroundColor: HIDDEN_CONFIG.bg }]}>
                <Ionicons name={HIDDEN_CONFIG.iconName} size={13} color={HIDDEN_CONFIG.iconColor} />
                <Text style={[styles.rsvpBadgeText, { color: HIDDEN_CONFIG.textColor }]}>
                  {HIDDEN_CONFIG.label}
                </Text>
              </View>
            )}
            {activity.is_new && !visitedDetails && !(isHost && myRsvp?.status === 'in') && (
              <View style={styles.newBadge}>
                <Text style={styles.newBadgeText}>New</Text>
              </View>
            )}
          </View>
          <View style={styles.headerRight}>
            {activity.has_new_messages && <View style={styles.newMsgDot} />}
            {past && fromTab === 'upcoming' && (
              <View style={[styles.rsvpBadge, { backgroundColor: Colors.borderLight }]}>
                <Text style={[styles.rsvpBadgeText, { color: Colors.textSecondary }]}>Started</Text>
              </View>
            )}
            {hostingConfig && (
              <View style={[styles.rsvpBadge, { backgroundColor: hostingConfig.bg }]}>
                <Ionicons name={hostingConfig.iconName} size={13} color={hostingConfig.iconColor} />
                <Text style={[styles.rsvpBadgeText, { color: hostingConfig.textColor }]}>
                  {hostingConfig.label}
                </Text>
              </View>
            )}
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
      )}
      <View style={styles.titleRow}>
        <View style={styles.titleContent}>
      <Text style={[styles.title, past && fromTab === 'past' && styles.titlePast, isHebrew(activity.title) && styles.titleRtl]} numberOfLines={1} ellipsizeMode="tail">
        {activity.title}
      </Text>
        </View>
      </View>

      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={14} color={Colors.textSecondary} />
          <Text style={styles.metaText}>{dateLabel}</Text>
        </View>
        {activity.is_limited && activity.max_participants != null && (
          <View style={styles.metaRow}>
            <Ionicons name="people-outline" size={14} color={Colors.primary} />
            <Text style={[styles.metaText, { color: Colors.primary, fontWeight: '600' }]}>Limited, max {activity.max_participants}</Text>
          </View>
        )}
        {activity.location && (
          <LocationDisplay location={activity.location} variant="card" hideMapsButton />
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
          {goingCount > 0 ? `${goingCount} ${goingCount === 1 ? 'person' : 'people'} in` : 'Be the first to join!'}
        </Text>
      </View>
      {isDeleting && (
        <View style={styles.deletingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.deletingText}>Deleting…</Text>
        </View>
      )}
      </View>
    </TouchableOpacity>
  );

  const hasHideUnhide = onHide || onUnhide;
  const hasDelete = onDelete && isHost;
  const needsSwipeable = hasDelete || hasHideUnhide;
  const swipeableRef = useRef<SwipeableMethods>(null);
  const triggeredBySwipeRef = useRef(false);

  if (needsSwipeable) {
    return (
      <ReanimatedSwipeable
        ref={swipeableRef}
        onSwipeableClose={() => { triggeredBySwipeRef.current = false; }}
        renderLeftActions={
          hasDelete
            ? () => (
                <TouchableOpacity style={styles.deleteAction} onPress={handleDeletePress}>
                  <Ionicons name="trash-outline" size={24} color="#fff" />
                  <Text style={styles.deleteActionText}>Delete</Text>
                </TouchableOpacity>
              )
            : undefined
        }
        renderRightActions={
          hasHideUnhide
            ? (_, __, swipeableMethods) => (
                <TouchableOpacity
                  style={[styles.hideAction, isHidden && styles.unhideAction]}
                  onPress={() => {
                    if (!triggeredBySwipeRef.current) {
                      (isHidden ? onUnhide : onHide)?.();
                    }
                    swipeableMethods?.reset();
                  }}
                >
                  <Ionicons
                    name={isHidden ? 'eye-outline' : 'eye-off-outline'}
                    size={24}
                    color="#fff"
                  />
                  <Text style={styles.hideActionText}>{isHidden ? 'Unhide' : 'Hide'}</Text>
                </TouchableOpacity>
              )
            : undefined
        }
        friction={2}
        leftThreshold={60}
        rightThreshold={60}
        onSwipeableOpen={hasHideUnhide ? (direction) => {
          // Only auto hide/unhide when swiping left (revealing hide button), not when swiping right (revealing delete)
          if (direction !== SwipeDirection.LEFT) return;
          triggeredBySwipeRef.current = true;
          (isHidden ? onUnhide : onHide)?.();
          swipeableRef.current?.reset();
        } : undefined}
      >
        <View style={styles.swipeableContent}>
          {cardContent}
        </View>
      </ReanimatedSwipeable>
    );
  }

  return cardContent;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface, borderRadius: 18, marginBottom: 12, overflow: 'hidden',
    shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  cardContent: { padding: 16 },
  splashBlockWrapper: { position: 'relative' as const, marginHorizontal: -16, marginTop: -16, marginBottom: 12 },
  splashBlock: { overflow: 'hidden', borderTopLeftRadius: 17, borderTopRightRadius: 17 },
  badgesOverlay: { position: 'absolute' as const, top: 0, left: 0, right: 0, padding: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  titleContent: { flex: 1, minWidth: 0 },
  cardPast: { opacity: 0.6 },
  cardDeleting: { opacity: 0.5 },
  cardPending: { borderWidth: 2, borderColor: INVITED_BLUE },
  deletingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  deletingText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
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
  title: { fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 10, lineHeight: 36 },
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
  swipeableContent: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    overflow: 'hidden',
  },
  deleteAction: {
    backgroundColor: Colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
    borderRadius: 18,
    marginRight: 12,
  },
  deleteActionText: { fontSize: 14, fontWeight: '600', color: '#fff', marginTop: 4 },
  hideAction: {
    backgroundColor: HIDE_ACTION_BG,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    height: '100%',
    borderRadius: 18,
    marginLeft: 12,
  },
  unhideAction: { backgroundColor: UNHIDE_ACTION_BG },
  hideActionText: { fontSize: 14, fontWeight: '600', color: '#fff', marginTop: 4 },
});
