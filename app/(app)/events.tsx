import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ScrollView, Alert,
  BackHandler, Platform, Modal, Pressable, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { useClearTabHighlightOnFocus } from '@/contexts/TabHighlightContext';
import { Ionicons } from '@expo/vector-icons';
import { format, isPast } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Activity } from '@/lib/types';
import { enrichWithSeenStatus } from '@/lib/enrichWithSeenStatus';
import { getHiddenActivityIds, toggleHidden } from '@/lib/hiddenActivities';
import { ActivityCard } from '@/components/ActivityCard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import { SplashArt } from '@/components/SplashArt';
import type { SplashPreset } from '@/lib/splashArt';
import Colors from '@/constants/Colors';

type PastActivity = { id: string; title: string; activity_time: string; description: string | null; location: string | null; splash_art: string | null };

function ClonePickerModal({ visible, onDismiss, userId }: { visible: boolean; onDismiss: () => void; userId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [pastEvents, setPastEvents] = useState<PastActivity[]>([]);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    Promise.all([
      supabase
        .from('activities')
        .select('id, title, activity_time, description, location, splash_art')
        .eq('created_by', userId)
        .lt('activity_time', new Date().toISOString())
        .order('activity_time', { ascending: false })
        .limit(25),
      supabase
        .from('mipo_dm_activities')
        .select('activity_id')
        .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`),
    ]).then(([activitiesRes, mipoDmsRes]) => {
      const mipoIds = new Set((mipoDmsRes.data ?? []).map((d: any) => d.activity_id));
      const items = ((activitiesRes.data ?? []) as PastActivity[])
        .filter(a => !mipoIds.has(a.id))
        .slice(0, 20);
      setPastEvents(items);
      setLoading(false);
    });
  }, [visible, userId]);

  const handleSelect = (event: PastActivity) => {
    onDismiss();
    const parts = [`clone=1`, `title=${encodeURIComponent(event.title)}`];
    if (event.description) parts.push(`description=${encodeURIComponent(event.description)}`);
    if (event.location) parts.push(`location=${encodeURIComponent(event.location)}`);
    if (event.splash_art) parts.push(`splashArt=${encodeURIComponent(event.splash_art)}`);
    router.push(`/(app)/activity/new?${parts.join('&')}` as any);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={cloneStyles.overlay} onPress={onDismiss}>
        <Pressable style={cloneStyles.card} onPress={() => {}}>
          <Text style={cloneStyles.title}>Clone past event</Text>
          {loading ? (
            <ActivityIndicator color={Colors.primary} style={{ marginVertical: 24 }} />
          ) : pastEvents.length === 0 ? (
            <Text style={cloneStyles.empty}>No past events to copy.</Text>
          ) : (
            <ScrollView style={cloneStyles.list} showsVerticalScrollIndicator={false}>
              {pastEvents.map(e => (
                <TouchableOpacity key={e.id} style={cloneStyles.row} onPress={() => handleSelect(e)}>
                  <View style={[cloneStyles.thumb, !e.splash_art && cloneStyles.thumbEmpty]}>
                    {e.splash_art && <SplashArt preset={e.splash_art as SplashPreset} height={44} opacity={1} />}
                  </View>
                  <View style={cloneStyles.rowInfo}>
                    <Text style={cloneStyles.rowTitle} numberOfLines={1}>{e.title}</Text>
                    <Text style={cloneStyles.rowDate}>{format(new Date(e.activity_time), 'MMM d, yyyy')}</Text>
                  </View>
                  <Ionicons name="copy-outline" size={18} color={Colors.primary} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <TouchableOpacity style={cloneStyles.cancelBtn} onPress={onDismiss}>
            <Text style={cloneStyles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const cloneStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, width: '100%', maxWidth: 360, maxHeight: '70%' },
  title: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 16 },
  list: { maxHeight: 320 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 12 },
  thumb: { width: 56, height: 40, borderRadius: 8, overflow: 'hidden' },
  thumbEmpty: { backgroundColor: Colors.borderLight },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: Colors.text },
  rowDate: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  empty: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', marginVertical: 24 },
  cancelBtn: { marginTop: 16, alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
});

type Filter = 'upcoming' | 'invited' | 'past' | 'declined';

type SeparatorItem = { __sep: true; key: string; label: string };
type ListItem = Activity | SeparatorItem;

const TABS: Array<{ id: Filter; label: string }> = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'invited', label: 'Invited' },
  { id: 'declined', label: 'Declined' },
  { id: 'past', label: 'Past' },
];

const INVITED_BLUE = '#3B82F6';

const EMPTY: Record<Filter, { emoji: string; title: string; subtitle: string }> = {
  upcoming: { emoji: '🌅', title: 'Nothing planned yet', subtitle: 'Post an event to a Circle and see who joins!' },
  invited: { emoji: '📬', title: 'No pending invites', subtitle: "When someone invites you, it'll appear here." },
  past: { emoji: '📅', title: 'No past events', subtitle: 'Your attended events will appear here.' },
  declined: { emoji: '🙅', title: 'No declined events', subtitle: 'Events you declined will appear here.' },
};

export default function EventsScreen() {
  useClearTabHighlightOnFocus();
  const { user, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tab } = useLocalSearchParams<{ tab?: string }>();

  const [allActivities, setAllActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [error, setError] = useState<string | null>(null);
  const [invitedCount, setInvitedCount] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [mipoDmActivityIds, setMipoDmActivityIds] = useState<Set<string>>(new Set());
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [showClonePicker, setShowClonePicker] = useState(false);

  const fetchActivities = useCallback(async () => {
    if (!user) return;
    setError(null);

    const { data: mipoDms } = await supabase
      .from('mipo_dm_activities')
      .select('activity_id')
      .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`);
    setMipoDmActivityIds(new Set((mipoDms ?? []).map((d: { activity_id: string }) => d.activity_id)));

    const { data, error: fetchError } = await supabase
      .from('activities')
      .select(`
        *,
        host:profiles!activities_created_by_fkey(id, full_name, avatar_url),
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
      return {
        ...a,
        my_rsvp: myRsvp,
        going_count: a.rsvps?.filter((r: any) => r.status === 'in').length ?? 0,
      };
    }) as Activity[];

    setInvitedCount(raw.filter(a => a.my_rsvp?.status === 'pending' && !isPast(new Date(a.activity_time))).length);

    const enriched = await enrichWithSeenStatus(raw, user.id);
    setAllActivities(enriched);
  }, [user]);

  useEffect(() => {
    if (tab === 'upcoming') setFilter('upcoming');
  }, [tab]);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchActivities().finally(() => setLoading(false));
  }, [fetchActivities]);

  const loadHiddenIds = useCallback(async () => {
    const ids = await getHiddenActivityIds();
    setHiddenIds(ids);
  }, []);

  useEffect(() => {
    loadHiddenIds();
  }, [loadHiddenIds]);

  // Android back button: exit app when on events tab (root screen)
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, []);

  const skipFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (tab === 'upcoming') setFilter('upcoming');
      if (skipFirstFocus.current) { skipFirstFocus.current = false; return; }
      if (!user) return;
      fetchActivities();
      loadHiddenIds();
    }, [fetchActivities, loadHiddenIds, user, tab])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActivities();
    setRefreshing(false);
  }, [fetchActivities]);

  const activitiesToShow = showHidden
    ? allActivities
    : allActivities.filter(a => !hiddenIds.has(a.id));

  const getFilteredList = (activities: Activity[]): ListItem[] => {
    switch (filter) {
      case 'upcoming': {
        const future = (s: string) => !isPast(new Date(s));
        const isHost = (a: Activity) => a.created_by === user?.id;
        // Limited section: open limited events (not closed), future, user marked in or maybe (not pending)
        const limited = activities.filter(a =>
          future(a.activity_time) && a.is_limited && !a.limited_closed_at &&
          (a.my_rsvp?.status === 'in' || a.my_rsvp?.status === 'maybe')
        );
        // Non-limited events only (limited go in Limited section)
        const hosting = activities.filter(a =>
          future(a.activity_time) && !a.is_limited && isHost(a) &&
          (a.my_rsvp?.status === 'in' || a.my_rsvp?.status === 'maybe')
        );
        const going = activities.filter(a =>
          future(a.activity_time) && !a.is_limited && a.my_rsvp?.status === 'in' && !isHost(a)
        );
        const maybe = activities.filter(a =>
          future(a.activity_time) && !a.is_limited && a.my_rsvp?.status === 'maybe' && !isHost(a)
        );

        const result: ListItem[] = [];
        if (limited.length > 0) {
          result.push({ __sep: true, key: 'limited-sep', label: 'Limited' });
          result.push(...limited);
        }
        if (hosting.length > 0) {
          if (result.length > 0) result.push({ __sep: true, key: 'hosting-sep', label: 'Hosting' });
          result.push(...hosting);
        }
        if (going.length > 0) {
          if (result.length > 0) result.push({ __sep: true, key: 'going-sep', label: "You're in" });
          result.push(...going);
        }
        if (maybe.length > 0) {
          if (result.length > 0) result.push({ __sep: true, key: 'maybe-sep', label: 'Maybe' });
          result.push(...maybe);
        }
        return result;
      }
      case 'past':
        return [...activities]
          .reverse()
          .filter(a =>
            !mipoDmActivityIds.has(a.id) &&
            ((isPast(new Date(a.activity_time)) &&
              (a.my_rsvp?.status === 'in' || a.my_rsvp?.status === 'maybe' || a.my_rsvp?.status === 'pending')) ||
            (a.is_limited && a.limited_closed_at && (a.created_by === user?.id || a.my_rsvp?.status === 'in')))
          );
      case 'invited':
        return activities.filter(a =>
          a.my_rsvp?.status === 'pending' && !isPast(new Date(a.activity_time))
        );
      case 'declined':
        return [...activities].reverse().filter(a => a.my_rsvp?.status === 'out');
    }
  };

  const listData = getFilteredList(activitiesToShow);

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
        <TouchableOpacity style={styles.newButton} onPress={() => setShowAddDropdown(v => !v)}>
          <Ionicons name="add" size={28} color={Colors.primary} />
        </TouchableOpacity>
        <Modal visible={showAddDropdown} transparent animationType="none">
          <Pressable style={[styles.dropdownBackdrop, { paddingTop: insets.top + 80 }]} onPress={() => setShowAddDropdown(false)}>
            <View style={styles.addDropdown}>
              <TouchableOpacity
                style={styles.addDropdownRow}
                onPress={() => { setShowAddDropdown(false); router.push('/(app)/activity/new'); }}
              >
                <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                <Text style={styles.addDropdownText}>New Event</Text>
              </TouchableOpacity>
              <View style={styles.addDropdownDivider} />
              <TouchableOpacity
                style={styles.addDropdownRow}
                onPress={() => { setShowAddDropdown(false); setShowClonePicker(true); }}
              >
                <Ionicons name="copy-outline" size={18} color={Colors.primary} />
                <Text style={styles.addDropdownText}>Clone Past Event</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>
        {user && (
          <ClonePickerModal
            visible={showClonePicker}
            onDismiss={() => setShowClonePicker(false)}
            userId={user.id}
          />
        )}
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

      <View style={styles.contentArea}>
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
              ? <Button label="Post an event" onPress={() => router.push('/(app)/activity/new')} />
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
            const isHost = item.created_by === user?.id;
            const canDelete = isHost && (filter === 'upcoming' || filter === 'past');
            const itemHidden = hiddenIds.has(item.id);
            const handleHideUnhide = async () => {
              const nowHidden = await toggleHidden(item.id);
              setHiddenIds(prev => {
                const next = new Set(prev);
                if (nowHidden) next.add(item.id);
                else next.delete(item.id);
                return next;
              });
            };
            return (
              <ActivityCard
                activity={item}
                fromTab={filter}
                isHidden={itemHidden}
                onHide={handleHideUnhide}
                onUnhide={handleHideUnhide}
                onDelete={canDelete ? async () => {
                  const { error } = await supabase.from('activities').update({ status: 'cancelled' }).eq('id', item.id);
                  if (!error) fetchActivities();
                  else Alert.alert('Error', 'Could not delete event.');
                } : undefined}
              />
            );
          }}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}
      </View>

      <View style={styles.showHiddenBar}>
        <TouchableOpacity
          style={[styles.showHiddenBtn, showHidden && styles.showHiddenBtnActive]}
          onPress={() => setShowHidden(prev => !prev)}
        >
          <Ionicons
            name={showHidden ? 'eye-outline' : 'eye-off-outline'}
            size={18}
            color={showHidden ? '#2563EB' : Colors.textSecondary}
          />
          <Text style={[styles.showHiddenText, showHidden && styles.showHiddenTextActive]}>
            Show hidden
          </Text>
        </TouchableOpacity>
      </View>
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
  dropdownBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'flex-end',
    paddingRight: 20,
  },
  addDropdown: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 6,
    minWidth: 190,
    overflow: 'hidden',
  },
  addDropdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  addDropdownText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  addDropdownDivider: { height: 1, backgroundColor: Colors.borderLight },
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
  contentArea: { flex: 1 },
  showHiddenBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  showHiddenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    backgroundColor: Colors.borderLight,
  },
  showHiddenBtnActive: { backgroundColor: '#E0EFFE' },
  showHiddenText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  showHiddenTextActive: { color: '#2563EB' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  emptyContainer: { flexGrow: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 160 },
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
