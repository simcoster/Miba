import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { isPast } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Activity } from '@/lib/types';
import { enrichWithSeenStatus } from '@/lib/enrichWithSeenStatus';
import { ActivityCard } from '@/components/ActivityCard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import Colors from '@/constants/Colors';

type Filter = 'upcoming' | 'invited' | 'past' | 'declined';

type SeparatorItem = { __sep: true; key: string; label: string };
type ListItem = Activity | SeparatorItem;

const TABS: Array<{ id: Filter; label: string }> = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'invited', label: 'Invited' },
  { id: 'past', label: 'Past' },
  { id: 'declined', label: 'Declined' },
];

const INVITED_BLUE = '#3B82F6';

const EMPTY: Record<Filter, { emoji: string; title: string; subtitle: string }> = {
  upcoming: { emoji: '🌅', title: 'Nothing planned yet', subtitle: 'Post an activity to a Circle and see who joins!' },
  invited: { emoji: '📬', title: 'No pending invites', subtitle: "When someone invites you, it'll appear here." },
  past: { emoji: '📅', title: 'No past activities', subtitle: 'Your attended activities will appear here.' },
  declined: { emoji: '🙅', title: 'No declined events', subtitle: 'Events you declined will appear here.' },
};

export default function EventsScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [allActivities, setAllActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [error, setError] = useState<string | null>(null);
  const [invitedCount, setInvitedCount] = useState(0);

  const fetchActivities = useCallback(async () => {
    if (!user) return;
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('activities')
      .select(`
        *,
        creator:profiles!activities_created_by_fkey(id, full_name, avatar_url),
        rsvps(id, status, user_id, created_at, updated_at, profile:profiles(id, full_name, avatar_url))
      `)
      .eq('status', 'active')
      .order('activity_time', { ascending: true });

    if (fetchError) {
      console.error('[Events] error:', fetchError);
      setError(fetchError.message);
      return;
    }

    const raw = (data ?? []).map((a: any) => {
      const myRsvp = a.rsvps?.find((r: any) => r.user_id === user.id) ?? null;
      // Normalise creator's 'in' → 'hosting' so filtering/badges are consistent
      // regardless of whether the DB migration has been applied yet.
      const normalisedRsvp = (myRsvp && a.created_by === myRsvp.user_id && myRsvp.status === 'in')
        ? { ...myRsvp, status: 'hosting' }
        : myRsvp;
      return {
        ...a,
        my_rsvp: normalisedRsvp,
        going_count: a.rsvps?.filter((r: any) => r.status === 'in' || r.status === 'hosting').length ?? 0,
      };
    }) as Activity[];

    setInvitedCount(raw.filter(a => a.my_rsvp?.status === 'pending').length);

    const enriched = await enrichWithSeenStatus(raw, user.id);
    setAllActivities(enriched);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchActivities().finally(() => setLoading(false));
  }, [fetchActivities]);

  const skipFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocus.current) { skipFirstFocus.current = false; return; }
      if (!user) return;
      fetchActivities();
    }, [fetchActivities, user])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActivities();
    setRefreshing(false);
  }, [fetchActivities]);

  const getFilteredList = (): ListItem[] => {
    switch (filter) {
      case 'upcoming': {
        const future = (s: string) => !isPast(new Date(s));
        const going = allActivities.filter(a => future(a.activity_time) && a.my_rsvp?.status === 'in');
        const hosting = allActivities.filter(a => future(a.activity_time) && a.my_rsvp?.status === 'hosting');
        const maybe = allActivities.filter(a => future(a.activity_time) && a.my_rsvp?.status === 'maybe');

        const result: ListItem[] = [...going];
        if (hosting.length > 0) {
          if (result.length > 0) result.push({ __sep: true, key: 'hosting-sep', label: 'Hosting' });
          result.push(...hosting);
        }
        if (maybe.length > 0) {
          if (result.length > 0) result.push({ __sep: true, key: 'maybe-sep', label: 'Maybe' });
          result.push(...maybe);
        }
        return result;
      }
      case 'past':
        return [...allActivities]
          .reverse()
          .filter(a =>
            isPast(new Date(a.activity_time)) &&
            (a.my_rsvp?.status === 'in' || a.my_rsvp?.status === 'hosting' || a.my_rsvp?.status === 'maybe')
          );
      case 'invited':
        return allActivities.filter(a =>
          a.my_rsvp?.status === 'pending' && !isPast(new Date(a.activity_time))
        );
      case 'declined':
        return [...allActivities].reverse().filter(a => a.my_rsvp?.status === 'out');
    }
  };

  const listData = getFilteredList();

  const hour = new Date().getHours();
  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''} 👋`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.subtitle}>What are you doing today?</Text>
        </View>
        <TouchableOpacity style={styles.newButton} onPress={() => router.push('/(app)/activity/new')}>
          <Ionicons name="add" size={28} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.tabRowWrap}>
        <View style={styles.tabRow}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.id}
            style={[styles.filterTab, filter === tab.id && styles.filterTabActive]}
            onPress={() => setFilter(tab.id)}
          >
            <Text style={[styles.filterText, filter === tab.id && styles.filterTextActive]}>
              {tab.label}
            </Text>
            {tab.id === 'invited' && invitedCount > 0 && (
              <View style={[styles.badge, filter === tab.id && styles.badgeOnActive]}>
                <Text style={styles.badgeText}>{invitedCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
        </View>
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
            title="Couldn't load activities"
            subtitle={error}
            action={<Button label="Retry" onPress={onRefresh} />}
          />
        </ScrollView>
      ) : listData.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <EmptyState
            emoji={EMPTY[filter].emoji}
            title={EMPTY[filter].title}
            subtitle={EMPTY[filter].subtitle}
            action={filter === 'upcoming'
              ? <Button label="Post an activity" onPress={() => router.push('/(app)/activity/new')} />
              : undefined}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={item => ('__sep' in item ? item.key : item.id)}
          renderItem={({ item }) => {
            if ('__sep' in item) {
              return (
                <View style={styles.sectionSep}>
                  <View style={styles.sectionSepLine} />
                  <Text style={styles.sectionSepLabel}>{item.label}</Text>
                  <View style={styles.sectionSepLine} />
                </View>
              );
            }
            return <ActivityCard activity={item} />;
          }}
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
  greeting: { fontSize: 24, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  newButton: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center',
  },
  tabRowWrap: { paddingHorizontal: 20, marginBottom: 12 },
  tabRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  filterTab: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: Colors.borderLight,
  },
  filterTabActive: { backgroundColor: Colors.primary },
  filterText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  filterTextActive: { color: '#fff' },
  badge: {
    minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: INVITED_BLUE, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeOnActive: { backgroundColor: 'rgba(255,255,255,0.35)' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  emptyContainer: { flexGrow: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
  sectionSep: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 4, marginBottom: 12,
  },
  sectionSepLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionSepLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.textSecondary,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
});
