import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ScrollView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useClearTabHighlightOnFocus } from '@/contexts/TabHighlightContext';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isTomorrow } from 'date-fns';
import { useAuth } from '@/contexts/AuthContext';
import { useUpdatesCount } from '@/contexts/UpdatesCountContext';
import { fetchUpdates, type UpdateEntry, type UpdateItem } from '@/lib/fetchUpdates';
import { markUpdatesAsSeen } from '@/lib/markUpdatesSeen';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { SplashArt } from '@/components/SplashArt';
import { getActivityCoverProps, hasActivityCover } from '@/lib/activityCover';
import { isJoinMeNow } from '@/lib/types';
import Colors from '@/constants/Colors';

const isHebrew = (s: string) => /[\u0590-\u05FF]/.test(s);

export default function UpdatesScreen() {
  useClearTabHighlightOnFocus();
  const { user } = useAuth();
  const { refresh } = useUpdatesCount();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [updates, setUpdates] = useState<UpdateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUpdates = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const allEntries = await fetchUpdates(user.id);
      setUpdates(allEntries);
      await refresh();
    } catch (e) {
      console.error('[Updates] error:', e);
      setError(e instanceof Error ? e.message : 'Failed to load updates');
    }
  }, [user, refresh]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    loadUpdates().finally(() => setLoading(false));
  }, [loadUpdates]);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      loadUpdates();
    }, [loadUpdates, user])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadUpdates();
    setRefreshing(false);
  }, [loadUpdates]);

  const handleDismiss = useCallback(async (entry: UpdateEntry) => {
    if (entry.kind === 'event') {
      await markUpdatesAsSeen(entry.data.activity.id);
    } else {
      await AsyncStorage.setItem(`miba_friend_joined_seen_${entry.data.id}`, new Date().toISOString());
    }
    setUpdates(prev => prev.filter(e => {
      if (e.kind === 'event' && entry.kind === 'event') return e.data.activity.id !== entry.data.activity.id;
      if (e.kind === 'friend_joined' && entry.kind === 'friend_joined') return e.data.id !== entry.data.id;
      return true;
    }));
    await refresh();
  }, [refresh]);

  const handleSeenAll = useCallback(async () => {
    await Promise.all(updates.map(entry => {
      if (entry.kind === 'event') return markUpdatesAsSeen(entry.data.activity.id);
      return AsyncStorage.setItem(`miba_friend_joined_seen_${entry.data.id}`, new Date().toISOString());
    }));
    setUpdates([]);
    await refresh();
  }, [updates, refresh]);

  const handlePress = useCallback(async (entry: UpdateEntry) => {
    if (entry.kind === 'event') {
      await markUpdatesAsSeen(entry.data.activity.id);
      await refresh();
      router.push(`/(app)/activity/${entry.data.activity.id}?fromTab=updates`);
    } else {
      await AsyncStorage.setItem(`miba_friend_joined_seen_${entry.data.id}`, new Date().toISOString());
      setUpdates(prev => prev.filter(e => !(e.kind === 'friend_joined' && e.data.id === entry.data.id)));
      await refresh();
      router.push('/(app)/circles');
    }
  }, [router, refresh]);

  const formatActivityDate = (activity: { activity_time: string; is_join_me?: boolean }) => {
    if (isJoinMeNow(activity)) return 'Now';
    const d = new Date(activity.activity_time);
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
      case 'limited_reopened':
        return (
          <View style={styles.updateChip}>
            <Ionicons name="refresh-outline" size={14} color={Colors.primary} />
            <Text style={styles.updateChipText}>Spots available!</Text>
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
      ) : updates.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <EmptyState
            emoji="✨"
            title="You're all caught up"
            subtitle="New invites, messages, RSVP changes, and friends joining will appear here."
            action={<Button label="Browse events" onPress={() => router.push('/events')} />}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={updates}
          keyExtractor={item => item.kind === 'event' ? item.data.activity.id : item.data.id}
          ListHeaderComponent={
            updates.length > 0 ? (
              <TouchableOpacity style={styles.seenAllBar} onPress={handleSeenAll}>
                <Ionicons name="checkmark-done-outline" size={20} color="#fff" />
                <Text style={styles.seenAllBarText}>Seen all</Text>
              </TouchableOpacity>
            ) : null
          }
          renderItem={({ item }) => (
            item.kind === 'friend_joined' ? (
              <View style={styles.swipeableWrap}>
                <Swipeable
                  renderLeftActions={() => (
                    <TouchableOpacity style={styles.dismissAction} onPress={() => handleDismiss(item)}>
                      <Ionicons name="checkmark-circle" size={28} color="#fff" />
                      <Text style={styles.dismissActionText}>Dismiss</Text>
                    </TouchableOpacity>
                  )}
                  renderRightActions={() => (
                    <TouchableOpacity style={styles.dismissAction} onPress={() => handleDismiss(item)}>
                      <Ionicons name="checkmark-circle" size={28} color="#fff" />
                      <Text style={styles.dismissActionText}>Dismiss</Text>
                    </TouchableOpacity>
                  )}
                  onSwipeableOpen={() => handleDismiss(item)}
                  friction={2}
                  leftThreshold={60}
                  rightThreshold={60}
                >
                  <TouchableOpacity style={styles.card} onPress={() => handlePress(item)} activeOpacity={0.85}>
                    <View style={styles.cardContent}>
                      <View style={styles.cardHeader}>
                        <View style={styles.friendJoinedRow}>
                          <Avatar uri={item.data.new_user?.avatar_url} name={item.data.new_user?.full_name} size={48} />
                          <View style={styles.friendJoinedInfo}>
                            <Text style={styles.cardTitle}>
                              {item.data.contact_name || item.data.new_user?.full_name || 'Someone'} joined Miba!
                            </Text>
                            <View style={styles.updateChip}>
                              <Ionicons name="person-add-outline" size={14} color={Colors.primary} />
                              <Text style={styles.updateChipText}>Add to circles</Text>
                            </View>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={styles.dismissButton}
                          onPress={(e) => { e.stopPropagation(); handleDismiss(item); }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="checkmark-circle-outline" size={24} color={Colors.primary} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </TouchableOpacity>
                </Swipeable>
              </View>
            ) : (
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
                <View style={[styles.cardContent, hasActivityCover(item.data.activity) && styles.cardContentWithSplash]}>
                <View style={[styles.cardHeaderWrapper, hasActivityCover(item.data.activity) && styles.cardHeaderWithSplash]}>
                  {getActivityCoverProps(item.data.activity) && (
                    <View style={styles.cardSplashBackground}>
                      <SplashArt {...getActivityCoverProps(item.data.activity)!} height={90} opacity={0.8} resizeMode="cover" />
                    </View>
                  )}
                <View style={[styles.cardHeader, hasActivityCover(item.data.activity) && styles.cardHeaderOverlay]}>
                  <Text style={[styles.cardTitle, isHebrew(item.data.activity.title) && styles.titleRtl]} numberOfLines={2}>{item.data.activity.title}</Text>
                  <TouchableOpacity
                    style={styles.dismissButton}
                    onPress={(e) => { e.stopPropagation(); handleDismiss(item); }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="checkmark-circle-outline" size={24} color={Colors.primary} />
                  </TouchableOpacity>
                  <View style={styles.avatarStack}>
                    {item.data.activity.rsvps
                      ?.filter(r => r.status === 'in')
                      .slice(0, 3)
                      .map((rsvp, i) => (
                        <View key={rsvp.id} style={[styles.avatarWrapper, { marginLeft: i === 0 ? 0 : -8 }]}>
                          <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={24} />
                        </View>
                      ))}
                  </View>
                </View>
                </View>
                <View style={styles.meta}>
                  <Ionicons name="time-outline" size={13} color={Colors.textSecondary} />
                  <Text style={styles.metaText}>{formatActivityDate(item.data.activity)}</Text>
                </View>
                <View style={styles.updatesRow}>
                  {item.data.updates.map((u, i) => (
                    <View key={i}>{renderUpdateLabel(u)}</View>
                  ))}
                </View>
                </View>
              </TouchableOpacity>
            </Swipeable>
            </View>
          )
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  emptyContainer: { flexGrow: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
  card: {
    backgroundColor: Colors.surface, borderRadius: 18, overflow: 'hidden',
    shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  cardContent: { padding: 16 },
  cardContentWithSplash: {},
  cardHeaderWrapper: { position: 'relative' as const },
  cardHeaderWithSplash: { marginHorizontal: -16, marginTop: -16, minHeight: 90 },
  cardSplashBackground: { position: 'absolute' as const, top: 0, left: 0, right: 0, overflow: 'hidden', borderTopLeftRadius: 17, borderTopRightRadius: 17 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  cardHeaderOverlay: { padding: 16, paddingTop: 16, marginHorizontal: -16, marginTop: -16 },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, flex: 1, marginRight: 8 },
  titleRtl: { textAlign: 'right' },
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
  friendJoinedRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  friendJoinedInfo: { flex: 1 },
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
