import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Activity } from '@/lib/types';
import { enrichWithSeenStatus } from '@/lib/enrichWithSeenStatus';
import { markUpdatesAsSeen } from '@/lib/markUpdatesSeen';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import Colors from '@/constants/Colors';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const RSVP_CHANGES_CUTOFF_DAYS = 7;

type UpdateItem =
  | { type: 'new_invite' }
  | { type: 'new_messages' }
  | { type: 'rsvp_changes'; count: number; bucketTime: number };

type EventUpdate = {
  activity: Activity;
  updates: UpdateItem[];
  latestTimestamp: number;
};

export default function UpdatesScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [eventUpdates, setEventUpdates] = useState<EventUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchUpdates = useCallback(async () => {
    if (!user) return;
    setError(null);

    // Fetch activities (creator or invitee) — same as Events tab
    const { data: activitiesData, error: fetchError } = await supabase
      .from('activities')
      .select(`
        *,
        creator:profiles!activities_created_by_fkey(id, full_name, avatar_url),
        rsvps(id, status, user_id, created_at, updated_at, profile:profiles(id, full_name, avatar_url))
      `)
      .eq('status', 'active')
      .order('activity_time', { ascending: true });

    if (fetchError) {
      console.error('[Updates] error:', fetchError);
      setError(fetchError.message);
      return;
    }

    // Also fetch pending invites directly from rsvps — ensures we never miss an invite
    const { data: pendingInvitesData } = await supabase
      .from('rsvps')
      .select(`
        id,
        activity_id,
        user_id,
        status,
        created_at,
        updated_at,
        profile:profiles(id, full_name, avatar_url),
        activity:activities(
          id,
          title,
          description,
          location,
          activity_time,
          status,
          created_by,
          creator:profiles!activities_created_by_fkey(id, full_name, avatar_url),
          rsvps(id, status, user_id, created_at, updated_at, profile:profiles(id, full_name, avatar_url))
        )
      `)
      .eq('user_id', user.id)
      .eq('status', 'pending');

    // Merge any activities from pending invites that might not be in the main query
    const existingIds = new Set((activitiesData ?? []).map((a: any) => a.id));
    const missingInviteActivities = (pendingInvitesData ?? [])
      .filter((r: any) => r.activity && !existingIds.has(r.activity.id))
      .map((r: any) => {
        const act = r.activity;
        const myRsvp = act.rsvps?.find((rv: any) => rv.user_id === user.id) ?? r;
        const normalisedRsvp = (myRsvp && act.created_by === myRsvp.user_id && myRsvp.status === 'in')
          ? { ...myRsvp, status: 'hosting' }
          : myRsvp;
        return {
          ...act,
          my_rsvp: normalisedRsvp,
          going_count: act.rsvps?.filter((rv: any) => rv.status === 'in' || rv.status === 'hosting').length ?? 0,
        };
      });

    const allActivitiesData = [
      ...(activitiesData ?? []),
      ...missingInviteActivities,
    ];

    const raw = allActivitiesData.map((a: any) => {
      const myRsvp = a.rsvps?.find((r: any) => r.user_id === user.id) ?? null;
      const normalisedRsvp = (myRsvp && a.created_by === myRsvp.user_id && myRsvp.status === 'in')
        ? { ...myRsvp, status: 'hosting' }
        : myRsvp;
      return {
        ...a,
        my_rsvp: normalisedRsvp,
        going_count: a.rsvps?.filter((r: any) => r.status === 'in' || r.status === 'hosting').length ?? 0,
      };
    }) as Activity[];

    const enriched = await enrichWithSeenStatus(raw, user.id);

    // Collect all activity IDs we need (enriched + any from pending invites that might not be in enriched)
    const pendingActivityIds = (pendingInvitesData ?? [])
      .map((r: any) => {
        const act = Array.isArray(r.activity) ? r.activity[0] : r.activity;
        return act?.id;
      })
      .filter(Boolean) as string[];
    const activityIds = [...new Set([...enriched.map(a => a.id), ...pendingActivityIds])];
    const rsvpSeenKeys = activityIds.map(id => `miba_rsvp_changes_seen_${id}`);
    const activitySeenKeys = activityIds.map(id => `miba_activity_last_seen_${id}`);
    const [rsvpSeenPairs, activitySeenPairs] = await Promise.all([
      AsyncStorage.multiGet(rsvpSeenKeys),
      AsyncStorage.multiGet(activitySeenKeys),
    ]);
    const rsvpSeenMap: Record<string, string | null> = {};
    rsvpSeenPairs.forEach(([key, value]) => {
      const actId = key.replace('miba_rsvp_changes_seen_', '');
      rsvpSeenMap[actId] = value;
    });
    const activityLastSeenMap: Record<string, string | null> = {};
    activitySeenPairs.forEach(([key, value]) => {
      const actId = key.replace('miba_activity_last_seen_', '');
      activityLastSeenMap[actId] = value;
    });

    // Fetch RSVP changes: rsvps where updated_at > created_at, user_id != me, recent
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RSVP_CHANGES_CUTOFF_DAYS);
    const cutoffIso = cutoff.toISOString();

    const { data: rsvpChanges } = await supabase
      .from('rsvps')
      .select('activity_id, updated_at, created_at')
      .in('activity_id', activityIds)
      .neq('user_id', user.id)
      .gt('updated_at', cutoffIso);

    // Group RSVP changes by activity and 30-min bucket (only if updated_at > lastSeen)
    const rsvpByActivity: Record<string, Record<number, number>> = {};
    (rsvpChanges ?? []).forEach((r: { activity_id: string; updated_at: string; created_at: string }) => {
      const updated = new Date(r.updated_at).getTime();
      const created = new Date(r.created_at).getTime();
      if (updated <= created) return; // no actual change
      const lastSeen = rsvpSeenMap[r.activity_id];
      if (lastSeen && updated <= new Date(lastSeen).getTime()) return; // already seen
      const bucket = Math.floor(updated / THIRTY_MINUTES_MS) * THIRTY_MINUTES_MS;
      if (!rsvpByActivity[r.activity_id]) rsvpByActivity[r.activity_id] = {};
      rsvpByActivity[r.activity_id][bucket] = (rsvpByActivity[r.activity_id][bucket] ?? 0) + 1;
    });

    const grouped: EventUpdate[] = [];
    const groupedIds = new Set<string>();

    // Process pending invites FIRST — ensures new invites always show (primary source)
    const pendingFromRsvps = (pendingInvitesData ?? []).filter((r: any) => r.activity);
    for (const r of pendingFromRsvps) {
      const act = Array.isArray(r.activity) ? r.activity[0] : r.activity;
      if (!act || groupedIds.has(act.id)) continue;
      if (isPast(new Date(act.activity_time))) continue; // skip past events
      const lastSeen = activityLastSeenMap[act.id];
      const inviteCreatedAt = (r as any).created_at;
      const inviteIsNew = lastSeen == null || lastSeen === '' || (inviteCreatedAt && new Date(inviteCreatedAt) > new Date(lastSeen));
      if (!inviteIsNew) continue;
      const activity = enriched.find((a: Activity) => a.id === act.id);
      const actToUse = (activity ?? {
        ...act,
        my_rsvp: act.rsvps?.find((rv: any) => rv.user_id === user.id) ?? r,
        going_count: act.rsvps?.filter((rv: any) => rv.status === 'in' || rv.status === 'hosting').length ?? 0,
      }) as Activity;
      const rawRsvp = r as { id: string; activity_id: string; created_at: string; updated_at: string; profile?: unknown };
      const myRsvp: Activity['my_rsvp'] = actToUse.my_rsvp ?? {
        id: rawRsvp.id,
        activity_id: rawRsvp.activity_id,
        user_id: user.id,
        status: 'pending',
        created_at: rawRsvp.created_at,
        updated_at: rawRsvp.updated_at ?? rawRsvp.created_at,
        profile: Array.isArray(rawRsvp.profile) ? rawRsvp.profile[0] : rawRsvp.profile,
      } as Activity['my_rsvp'];
      const normalisedRsvp = (myRsvp && act.created_by === myRsvp.user_id && myRsvp.status === 'in')
        ? { ...myRsvp, status: 'hosting' as const }
        : myRsvp;
      const finalAct: Activity = { ...actToUse, my_rsvp: normalisedRsvp };
      const t = finalAct.my_rsvp?.created_at ? new Date(finalAct.my_rsvp.created_at).getTime() : Date.now();
      grouped.push({ activity: finalAct, updates: [{ type: 'new_invite' }], latestTimestamp: t });
      groupedIds.add(act.id);
    }

    // Then process enriched activities for other updates (merge new_invite with other update types)
    for (const activity of enriched) {
      const updates: UpdateItem[] = [];
      let latestTimestamp = 0;

      // New invite: pending + (never seen OR invite arrived after last view)
      const lastSeen = activityLastSeenMap[activity.id];
      const inviteIsNew = lastSeen == null || lastSeen === '' || (activity.my_rsvp?.created_at && new Date(activity.my_rsvp.created_at) > new Date(lastSeen));
      if (activity.my_rsvp?.status === 'pending' && inviteIsNew && !isPast(new Date(activity.activity_time))) {
        updates.push({ type: 'new_invite' });
        const t = new Date(activity.my_rsvp.created_at).getTime();
        if (t > latestTimestamp) latestTimestamp = t;
      }

      // New chat messages
      if (activity.has_new_messages) {
        updates.push({ type: 'new_messages' });
        const msgTime = activity.latest_message_at ? new Date(activity.latest_message_at).getTime() : Date.now();
        latestTimestamp = Math.max(latestTimestamp, msgTime);
      }

      // RSVP changes (aggregated by 30 min)
      const buckets = rsvpByActivity[activity.id];
      if (buckets) {
        for (const [bucketStr, count] of Object.entries(buckets)) {
          const bucketTime = parseInt(bucketStr, 10);
          updates.push({ type: 'rsvp_changes', count, bucketTime });
          if (bucketTime > latestTimestamp) latestTimestamp = bucketTime;
        }
      }

      if (updates.length > 0) {
        const existing = grouped.find(g => g.activity.id === activity.id);
        if (existing) {
          // Merge other updates into existing entry; use enriched activity (has full data)
          existing.activity = activity;
          const existingTypes = new Set(existing.updates.map(u => u.type));
          for (const u of updates) {
            if (!existingTypes.has(u.type)) {
              existing.updates.push(u);
              existingTypes.add(u.type);
            }
          }
          existing.latestTimestamp = Math.max(existing.latestTimestamp, latestTimestamp);
        } else {
          grouped.push({ activity, updates, latestTimestamp });
        }
      }
    }
    grouped.sort((a, b) => b.latestTimestamp - a.latestTimestamp);
    setEventUpdates(grouped);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchUpdates().finally(() => setLoading(false));
  }, [fetchUpdates]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      fetchUpdates();
    }, [fetchUpdates, user])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUpdates();
    setRefreshing(false);
  }, [fetchUpdates]);

  const handleDismiss = useCallback(async (item: EventUpdate) => {
    await markUpdatesAsSeen(item.activity.id);
    setEventUpdates(prev => prev.filter(e => e.activity.id !== item.activity.id));
  }, []);

  const handleSeenAll = useCallback(async () => {
    await Promise.all(eventUpdates.map(item => markUpdatesAsSeen(item.activity.id)));
    setEventUpdates([]);
  }, [eventUpdates]);

  const handlePress = useCallback(async (item: EventUpdate) => {
    await markUpdatesAsSeen(item.activity.id);
    router.push(`/(app)/activity/${item.activity.id}?fromTab=updates`);
  }, [router]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isToday(d)) return `Today · ${format(d, 'h:mm a')}`;
    if (isTomorrow(d)) return `Tomorrow · ${format(d, 'h:mm a')}`;
    return format(d, 'EEE, MMM d · h:mm a');
  };

  const renderUpdateLabel = (item: UpdateItem) => {
    switch (item.type) {
      case 'new_invite':
        return (
          <View style={styles.updateChip}>
            <Ionicons name="mail-open-outline" size={14} color={Colors.primary} />
            <Text style={styles.updateChipText}>New invite</Text>
          </View>
        );
      case 'new_messages':
        return (
          <View style={styles.updateChip}>
            <Ionicons name="chatbubble-outline" size={14} color={Colors.primary} />
            <Text style={styles.updateChipText}>New messages</Text>
          </View>
        );
      case 'rsvp_changes':
        return (
          <View style={styles.updateChip}>
            <Ionicons name="people-outline" size={14} color={Colors.primary} />
            <Text style={styles.updateChipText}>
              {item.count} {item.count === 1 ? 'person' : 'people'} changed their RSVP
            </Text>
          </View>
        );
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Updates</Text>
        <TouchableOpacity style={styles.newButton} onPress={() => router.push('/(app)/activity/new')}>
          <Ionicons name="add" size={28} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><Text style={styles.loadingText}>Loading…</Text></View>
      ) : error ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <EmptyState
            emoji="⚠️"
            title="Couldn't load updates"
            subtitle={error}
            action={<Button label="Retry" onPress={onRefresh} />}
          />
        </ScrollView>
      ) : eventUpdates.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <EmptyState
            emoji="✨"
            title="You're all caught up"
            subtitle="New invites, messages, and RSVP changes will appear here."
            action={<Button label="Browse events" onPress={() => router.push('/events')} />}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={eventUpdates}
          keyExtractor={item => item.activity.id}
          ListHeaderComponent={
            eventUpdates.length > 0 ? (
              <TouchableOpacity style={styles.seenAllBar} onPress={handleSeenAll}>
                <Ionicons name="checkmark-done-outline" size={20} color="#fff" />
                <Text style={styles.seenAllBarText}>Seen all</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.swipeableWrap}>
              <Swipeable
                renderLeftActions={() => (
                  <TouchableOpacity
                    style={styles.dismissAction}
                    onPress={() => handleDismiss(item)}
                  >
                    <Ionicons name="checkmark-circle" size={28} color="#fff" />
                    <Text style={styles.dismissActionText}>Dismiss</Text>
                  </TouchableOpacity>
                )}
                renderRightActions={() => (
                  <TouchableOpacity
                    style={styles.dismissAction}
                    onPress={() => handleDismiss(item)}
                  >
                    <Ionicons name="checkmark-circle" size={28} color="#fff" />
                    <Text style={styles.dismissActionText}>Dismiss</Text>
                  </TouchableOpacity>
                )}
                onSwipeableOpen={() => {
                  handleDismiss(item);
                }}
                friction={2}
                leftThreshold={60}
                rightThreshold={60}
              >
              <TouchableOpacity
                style={styles.card}
                onPress={() => handlePress(item)}
                activeOpacity={0.85}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle} numberOfLines={2}>{item.activity.title}</Text>
                  <TouchableOpacity
                    style={styles.dismissButton}
                    onPress={(e) => { e.stopPropagation(); handleDismiss(item); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="checkmark-circle-outline" size={24} color={Colors.primary} />
                  </TouchableOpacity>
                  <View style={styles.avatarStack}>
                    {item.activity.rsvps
                      ?.filter(r => r.status === 'in' || r.status === 'hosting')
                      .slice(0, 3)
                      .map((rsvp, i) => (
                        <View key={rsvp.id} style={[styles.avatarWrapper, { marginLeft: i === 0 ? 0 : -8 }]}>
                          <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={24} />
                        </View>
                      ))}
                  </View>
                </View>
                <View style={styles.meta}>
                  <Ionicons name="time-outline" size={13} color={Colors.textSecondary} />
                  <Text style={styles.metaText}>{formatDate(item.activity.activity_time)}</Text>
                </View>
                <View style={styles.updatesRow}>
                  {item.updates.map((u, i) => (
                    <View key={i}>{renderUpdateLabel(u)}</View>
                  ))}
                </View>
              </TouchableOpacity>
            </Swipeable>
            </View>
          )}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12,
  },
  title: { fontSize: 24, fontWeight: '800', color: Colors.text },
  seenAllBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 12, paddingVertical: 12, borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  seenAllBarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  newButton: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  emptyContainer: { flexGrow: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 18, padding: 16,
    shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, flex: 1, marginRight: 8 },
  dismissButton: { padding: 4, marginLeft: 4 },
  avatarStack: { flexDirection: 'row' },
  avatarWrapper: { borderWidth: 2, borderColor: Colors.surface, borderRadius: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  metaText: { fontSize: 13, color: Colors.textSecondary },
  updatesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  updateChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.accentLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
  },
  updateChipText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  swipeableWrap: { marginBottom: 12 },
  dismissAction: {
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    borderRadius: 18,
    gap: 4,
  },
  dismissActionText: { fontSize: 11, fontWeight: '600', color: '#fff' },
});
