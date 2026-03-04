import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, Alert, ActivityIndicator, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, addMinutes, subMinutes } from 'date-fns';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMipo } from '@/contexts/MipoContext';
import { Circle, Profile } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import {
  requestLocationPermission,
  startMipoLocationWatch,
  type LocationSubscription,
} from '@/lib/mipoLocation';
import { registerForPushNotifications } from '@/lib/mipoNotifications';
import Colors from '@/constants/Colors';

type ProximityEventWithProfile = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
  other_profile: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
};

type TimerOption = '10min' | '1hour' | 'unlimited';

const VISIBLE_MODE_TEXT = 'Visible mode means: if another user also turned on visible mode AND you both selected each other on the Mipo page AND you move within 100 meters of each other, you would both get a notification on this page and on your phone.';

export default function MipoScreen() {
  const { user } = useAuth();
  const { visibleState, setVisible, refreshVisibleState } = useMipo();
  const insets = useSafeAreaInsets();

  const [view, setView] = useState<'selection' | 'setup' | 'active'>('selection');
  const [circles, setCircles] = useState<Circle[]>([]);
  const [expandedCircleIds, setExpandedCircleIds] = useState<Set<string>>(new Set());
  const [selectedPool, setSelectedPool] = useState<Map<string, Pick<Profile, 'id' | 'full_name' | 'avatar_url'>>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [timerOption, setTimerOption] = useState<TimerOption>('1hour');
  const [loading, setLoading] = useState(false);
  const [locationSub, setLocationSub] = useState<LocationSubscription | null>(null);
  const [nearbyEvents, setNearbyEvents] = useState<ProximityEventWithProfile[]>([]);
  const expiryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnOffRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (!user) return;
    supabase
      .from('circles')
      .select('id, name, emoji, description, created_by, created_at')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setCircles((data ?? []) as Circle[]));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('mipo_selections')
      .select('selected_user_id, profile:profiles!selected_user_id(id, full_name, avatar_url)')
      .eq('user_id', user.id)
      .then(({ data }) => {
        const pool = new Map<string, Pick<Profile, 'id' | 'full_name' | 'avatar_url'>>();
        (data ?? []).forEach((row: any) => {
          if (row.profile) pool.set(row.selected_user_id, row.profile);
        });
        setSelectedPool(pool);
      });
  }, [user]);

  useEffect(() => {
    if (user) registerForPushNotifications(user.id).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const cutoff = subMinutes(new Date(), 30).toISOString();
    const fetchNearby = async () => {
      const { data } = await supabase
        .from('mipo_proximity_events')
        .select(`
          id, user_a_id, user_b_id, created_at,
          user_a:profiles!user_a_id(id, full_name, avatar_url),
          user_b:profiles!user_b_id(id, full_name, avatar_url)
        `)
        .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(20);
      const events: ProximityEventWithProfile[] = (data ?? []).map((row: any) => {
        const otherId = row.user_a_id === user.id ? row.user_b_id : row.user_a_id;
        const otherProfile = row.user_a_id === user.id ? row.user_b : row.user_a;
        return { id: row.id, user_a_id: row.user_a_id, user_b_id: row.user_b_id, created_at: row.created_at, other_profile: otherProfile };
      });
      setNearbyEvents(events);
    };
    fetchNearby();
    const channel = supabase.channel('mipo_proximity').on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'mipo_proximity_events' },
      () => fetchNearby()
    ).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  useEffect(() => {
    if (visibleState.isVisible) {
      setView('active');
    } else if (view === 'active') {
      setView('selection');
    }
  }, [visibleState.isVisible]);

  const toggleCircle = useCallback(async (circle: Circle) => {
    if (!user) return;
    if (expandedCircleIds.has(circle.id)) {
      setExpandedCircleIds(prev => { const s = new Set(prev); s.delete(circle.id); return s; });
      return;
    }
    const { data, error } = await supabase
      .from('circle_members')
      .select('user_id, profile:profiles(id, full_name, avatar_url)')
      .eq('circle_id', circle.id)
      .neq('user_id', user.id);
    if (error) { Alert.alert('Error', 'Could not load circle members.'); return; }
    setExpandedCircleIds(prev => new Set(prev).add(circle.id));
    setSelectedPool(prev => {
      const next = new Map(prev);
      (data ?? []).forEach((m: { user_id: string; profile?: Profile }) => {
        if (m.profile) next.set(m.user_id, m.profile);
      });
      return next;
    });
  }, [user, expandedCircleIds]);

  const removeFromPool = useCallback((userId: string) => {
    setSelectedPool(prev => { const next = new Map(prev); next.delete(userId); return next; });
  }, []);

  const handleSearch = useCallback(async (text: string) => {
    setSearchQuery(text);
    if (text.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, username')
      .or(`full_name.ilike.%${text.trim()}%,username.ilike.%${text.trim()}%`)
      .neq('id', user!.id)
      .limit(20);
    setSearchResults((data ?? []) as Profile[]);
    setSearching(false);
  }, [user]);

  const addFromSearch = useCallback((profile: Profile) => {
    setSelectedPool(prev => new Map(prev).set(profile.id, profile));
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  const saveSelections = useCallback(async () => {
    if (!user) return;
    const userIds = [...selectedPool.keys()];
    await supabase.from('mipo_selections').delete().eq('user_id', user.id);
    if (userIds.length > 0) {
      await supabase.from('mipo_selections').insert(
        userIds.map(selected_user_id => ({ user_id: user.id, selected_user_id }))
      );
    }
  }, [user, selectedPool]);

  const handleMakeMeVisible = useCallback(async () => {
    await saveSelections();
    setView('setup');
  }, [saveSelections]);

  const handleTurnOnVisible = useCallback(async () => {
    if (!user) return;
    const granted = await requestLocationPermission();
    if (!granted) {
      Alert.alert('Location required', 'Mipo needs location access to notify you when friends are nearby. Please enable it in Settings.');
      return;
    }
    setLoading(true);
    try {
      await Location.enableNetworkProviderAsync().catch(() => {});
      let loc: Location.LocationObject | null = null;
      try {
        loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          maxWait: 20000,
        });
      } catch {
        loc = await Location.getLastKnownPositionAsync();
      }
      if (!loc) {
        throw new Error('Could not get your location. Make sure GPS and location services are on, then try again. Moving outdoors or waiting a few seconds can help.');
      }
      const { coords } = loc;
      const now = new Date();
      const expiresAt = timerOption === '10min' ? addMinutes(now, 10)
        : timerOption === '1hour' ? addMinutes(now, 60)
        : null;

      const { error } = await supabase.from('mipo_visible_sessions').upsert(
        {
          user_id: user.id,
          lat: coords.latitude,
          lng: coords.longitude,
          started_at: now.toISOString(),
          expires_at: expiresAt?.toISOString() ?? null,
          updated_at: now.toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;

      const sub = await startMipoLocationWatch(user.id);
      if (sub) setLocationSub(sub);

      setVisible(true, expiresAt);
      setView('active');

      if (expiresAt) {
        expiryIntervalRef.current = setInterval(() => {
          if (new Date() >= expiresAt) {
            turnOffRef.current();
          }
        }, 30000);
      }
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user, timerOption, setVisible]);

  const handleTurnOffVisible = useCallback(async () => {
    if (!user) return;
    if (expiryIntervalRef.current) {
      clearInterval(expiryIntervalRef.current);
      expiryIntervalRef.current = null;
    }
    setLocationSub(prev => { prev?.remove(); return null; });
    await supabase.from('mipo_visible_sessions').delete().eq('user_id', user.id);
    setVisible(false, null);
    setView('selection');
    refreshVisibleState();
  }, [user, setVisible, refreshVisibleState]);

  turnOffRef.current = handleTurnOffVisible;

  const selectedList = [...selectedPool.values()];

  if (view === 'setup') {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Make me visible</Text>
          <Text style={styles.explanation}>{VISIBLE_MODE_TEXT}</Text>
          <View style={styles.timerSection}>
            <Text style={styles.label}>How long?</Text>
            <View style={styles.timerRow}>
              {(['10min', '1hour', 'unlimited'] as const).map(opt => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.timerChip, timerOption === opt && styles.timerChipActive]}
                  onPress={() => setTimerOption(opt)}
                >
                  <Text style={[styles.timerChipText, timerOption === opt && styles.timerChipTextActive]}>
                    {opt === '10min' ? '10 mins' : opt === '1hour' ? '1 hour' : 'No limit'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <Image source={require('@/assets/images/radar.gif')} style={styles.radarGif} resizeMode="contain" />
          <Button label="Turn on visible mode" onPress={handleTurnOnVisible} loading={loading} />
          <TouchableOpacity style={styles.backLink} onPress={() => setView('selection')}>
            <Text style={styles.backLinkText}>Back to selection</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (view === 'active') {
    const expiresLabel = visibleState.expiresAt
      ? `Visible until ${format(visibleState.expiresAt, 'HH:mm')}`
      : 'No time limit — turn off when done';
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>You're visible</Text>
          <Text style={styles.explanation}>{VISIBLE_MODE_TEXT}</Text>
          <Text style={styles.expiresLabel}>{expiresLabel}</Text>
          {nearbyEvents.length > 0 && (
            <View style={styles.nearbySection}>
              <Text style={styles.nearbyTitle}>Nearby now</Text>
              {nearbyEvents.map(e => (
                <View key={e.id} style={styles.nearbyRow}>
                  <Avatar uri={e.other_profile?.avatar_url} name={e.other_profile?.full_name} size={40} />
                  <View style={styles.nearbyInfo}>
                    <Text style={styles.nearbyName}>{e.other_profile?.full_name ?? 'Someone'}</Text>
                    <Text style={styles.nearbyTime}>{format(new Date(e.created_at), 'HH:mm')}</Text>
                  </View>
                  <Ionicons name="location" size={20} color={Colors.success} />
                </View>
              ))}
            </View>
          )}
          <Image source={require('@/assets/images/radar.gif')} style={styles.radarGif} resizeMode="contain" />
          <Button label="Turn off visible mode" onPress={handleTurnOffVisible} variant="danger" />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Mipo</Text>
        <Text style={styles.subtitle}>Select who can see you when you're nearby</Text>

        {nearbyEvents.length > 0 && (
          <View style={styles.nearbySection}>
            <Text style={styles.nearbyTitle}>Nearby now</Text>
            {nearbyEvents.map(e => (
              <View key={e.id} style={styles.nearbyRow}>
                <Avatar uri={e.other_profile?.avatar_url} name={e.other_profile?.full_name} size={40} />
                <View style={styles.nearbyInfo}>
                  <Text style={styles.nearbyName}>{e.other_profile?.full_name ?? 'Someone'}</Text>
                  <Text style={styles.nearbyTime}>{format(new Date(e.created_at), 'HH:mm')}</Text>
                </View>
                <Ionicons name="location" size={20} color={Colors.success} />
              </View>
            ))}
          </View>
        )}

        {circles.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>Select via Circle</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {circles.map(c => {
                const expanded = expandedCircleIds.has(c.id);
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.chip, expanded && styles.chipSelected]}
                    onPress={() => toggleCircle(c)}
                  >
                    <Text style={styles.chipEmoji}>{c.emoji}</Text>
                    <Text style={[styles.chipName, expanded && styles.chipNameSelected]}>{c.name}</Text>
                    {expanded && <Ionicons name="checkmark" size={14} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>Search individuals</Text>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleSearch}
              placeholder="Search by name or username…"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={Colors.primary} />}
            {searchQuery.length > 0 && !searching && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map(p => {
                const already = selectedPool.has(p.id);
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.searchRow}
                    onPress={() => !already && addFromSearch(p)}
                    disabled={already}
                  >
                    <Avatar uri={p.avatar_url} name={p.full_name} size={36} />
                    <View style={styles.searchInfo}>
                      <Text style={styles.searchName}>{p.full_name ?? 'Unknown'}</Text>
                      {p.username && <Text style={styles.searchUsername}>@{p.username}</Text>}
                    </View>
                    {already ? <Ionicons name="checkmark-circle" size={22} color={Colors.success} /> : <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {selectedList.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>Selected ({selectedList.length})</Text>
            <View style={styles.invitePool}>
              {selectedList.map(p => (
                <View key={p.id} style={styles.inviteChip}>
                  <Avatar uri={p.avatar_url} name={p.full_name} size={28} />
                  <Text style={styles.inviteChipName} numberOfLines={1}>{p.full_name?.split(' ')[0] ?? '?'}</Text>
                  <TouchableOpacity onPress={() => removeFromPool(p.id)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                    <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}

        <Button label="Make me visible" onPress={handleMakeMeVisible} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 24, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, marginBottom: 24 },
  explanation: { fontSize: 15, color: Colors.text, lineHeight: 22, marginBottom: 20 },
  expiresLabel: { fontSize: 14, color: Colors.success, fontWeight: '600', marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  section: { marginBottom: 22 },
  timerSection: { marginBottom: 20 },
  timerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  timerChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8 },
  timerChipActive: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  timerChipText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  timerChipTextActive: { color: Colors.primary },
  radarGif: { width: 200, height: 200, alignSelf: 'center', marginVertical: 24 },
  backLink: { marginTop: 16, alignSelf: 'center' },
  backLinkText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  chipEmoji: { fontSize: 16 },
  chipName: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  chipNameSelected: { color: Colors.primaryDark },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, fontSize: 16, color: Colors.text, paddingVertical: 12 },
  searchResults: { marginTop: 6, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  searchInfo: { flex: 1 },
  searchName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  searchUsername: { fontSize: 13, color: Colors.textSecondary },
  invitePool: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inviteChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.accentLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 130 },
  inviteChipName: { fontSize: 13, fontWeight: '600', color: Colors.primaryDark, flex: 1 },
  nearbySection: { backgroundColor: Colors.successLight, borderRadius: 14, padding: 14, marginBottom: 20 },
  nearbyTitle: { fontSize: 14, fontWeight: '700', color: Colors.success, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  nearbyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(34,197,94,0.2)' },
  nearbyInfo: { flex: 1 },
  nearbyName: { fontSize: 16, fontWeight: '600', color: Colors.text },
  nearbyTime: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});
