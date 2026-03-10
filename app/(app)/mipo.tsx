import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable,
  TouchableOpacity, Alert, ActivityIndicator, Image, Modal, useWindowDimensions,
  Platform, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ScrollView, GestureHandlerRootView } from 'react-native-gesture-handler';
import { ZoomableImage } from '@/components/ZoomableImage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { format, addMinutes } from 'date-fns';
import * as Location from 'expo-location';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useMipo, type ProximityEventWithProfile } from '@/contexts/MipoContext';
import { Circle, Profile } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import {
  checkMipoVisibleModePermissions,
  requestBackgroundLocationPermission,
  startMipoLocationWatch,
  type LocationSubscription,
} from '@/lib/mipoLocation';
import Colors from '@/constants/Colors';

type TimerOption = '10min' | '1hour' | 'unlimited';

type DistanceOption = '500m' | '3km' | '10km' | 'custom';

const DISTANCE_PRESETS: { value: DistanceOption; meters: number; label: string }[] = [
  { value: '500m', meters: 500, label: '500m (5 min walk)' },
  { value: '3km', meters: 3000, label: '3km (same neighborhood)' },
  { value: '10km', meters: 10000, label: '10km (same city)' },
  { value: 'custom', meters: 0, label: 'Custom' },
];

const CUSTOM_DISTANCE_MIN = 100;
const CUSTOM_DISTANCE_MAX = 50000;

const MIPO_COMIC = require('@/assets/images/Mipo-comic.png');
const MIPO_PERMISSIONS_HOWTO = require('@/assets/images/Mipo-permissions-howto.jpeg');

const HowItWorksButton = ({ onPress }: { onPress: () => void }) => (
  <TouchableOpacity style={styles.howItWorksBtn} onPress={onPress} activeOpacity={0.7}>
    <Ionicons name="help-circle-outline" size={20} color={Colors.primary} />
    <Text style={styles.howItWorksCaption}>how it works</Text>
  </TouchableOpacity>
);

export default function MipoScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();

  const comicSource = Image.resolveAssetSource(MIPO_COMIC);
  const comicMaxWidth = Math.round(screenWidth - 80);
  const comicAspectRatio = comicSource?.height && comicSource?.width
    ? comicSource.height / comicSource.width
    : 1.4;
  const comicHeight = Math.round(comicMaxWidth * comicAspectRatio);

  const [view, setView] = useState<'selection' | 'active'>('selection');
  const [circles, setCircles] = useState<Circle[]>([]);
  const [expandedCircleIds, setExpandedCircleIds] = useState<Set<string>>(new Set());
  const [circleMembersMap, setCircleMembersMap] = useState<Map<string, Set<string>>>(new Map());
  const [individuallyAddedUserIds, setIndividuallyAddedUserIds] = useState<Set<string>>(new Set());
  const [selectedPool, setSelectedPool] = useState<Map<string, Pick<Profile, 'id' | 'full_name' | 'avatar_url'>>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [timerOption, setTimerOption] = useState<TimerOption>('1hour');
  const [distanceOption, setDistanceOption] = useState<DistanceOption>('500m');
  const [customDistanceM, setCustomDistanceM] = useState<string>('2000');
  const [loading, setLoading] = useState(false);
  const [locationSub, setLocationSub] = useState<LocationSubscription | null>(null);
  const { visibleState, setVisible, refreshVisibleState, nearbyEvents, refreshNearby } = useMipo();
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [comicScale, setComicScale] = useState(1);
  const [permissionErrorModal, setPermissionErrorModal] = useState<{ visible: boolean; title: string; message: string; missingBackground?: boolean }>({ visible: false, title: '', message: '' });
  const [unreadByEventId, setUnreadByEventId] = useState<Map<string, boolean>>(new Map());
  const expiryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnOffRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const getProximityDistanceM = useCallback((): number => {
    if (distanceOption === 'custom') {
      const n = parseInt(customDistanceM, 10);
      if (isNaN(n)) return 500;
      return Math.max(CUSTOM_DISTANCE_MIN, Math.min(CUSTOM_DISTANCE_MAX, n));
    }
    const preset = DISTANCE_PRESETS.find(p => p.value === distanceOption);
    return preset?.meters ?? 500;
  }, [distanceOption, customDistanceM]);

  const fetchCircles = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('circles')
      .select('id, name, emoji, created_by, created_at')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });
    setCircles((data ?? []) as Circle[]);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchCircles();
  }, [fetchCircles]);

  const skipFirstCirclesFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirstCirclesFocus.current) {
        skipFirstCirclesFocus.current = false;
        return;
      }
      if (!user) return;
      fetchCircles();
    }, [fetchCircles, user])
  );

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
    if (visibleState.isVisible) {
      setView('active');
    } else if (view === 'active') {
      setView('selection');
    }
  }, [visibleState.isVisible]);

  // Load proximity_distance_m from session when in active view (e.g. returning to screen)
  useEffect(() => {
    if (!user || !visibleState.isVisible) return;
    supabase
      .from('mipo_visible_sessions')
      .select('proximity_distance_m')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data?.proximity_distance_m) {
          const m = data.proximity_distance_m as number;
          const preset = DISTANCE_PRESETS.find(p => p.meters === m);
          if (preset) {
            setDistanceOption(preset.value);
          } else {
            setDistanceOption('custom');
            setCustomDistanceM(String(m));
          }
        }
      });
  }, [user, visibleState.isVisible]);


  const toggleCircle = useCallback(async (circle: Circle) => {
    if (!user) return;
    if (expandedCircleIds.has(circle.id)) {
      const membersOfCircle = circleMembersMap.get(circle.id);
      setExpandedCircleIds(prev => { const s = new Set(prev); s.delete(circle.id); return s; });
      setCircleMembersMap(prev => { const m = new Map(prev); m.delete(circle.id); return m; });
      if (membersOfCircle && membersOfCircle.size > 0) {
        const otherExpandedIds = new Set(expandedCircleIds);
        otherExpandedIds.delete(circle.id);
        const inOtherCircle = new Set<string>();
        otherExpandedIds.forEach(cid => {
          circleMembersMap.get(cid)?.forEach(uid => inOtherCircle.add(uid));
        });
        setSelectedPool(prev => {
          const next = new Map(prev);
          membersOfCircle.forEach(uid => {
            if (!individuallyAddedUserIds.has(uid) && !inOtherCircle.has(uid)) {
              next.delete(uid);
            }
          });
          return next;
        });
      }
      return;
    }
    const { data, error } = await supabase
      .from('circle_members')
      .select('user_id, profile:profiles!user_id(id, full_name, avatar_url)')
      .eq('circle_id', circle.id)
      .neq('user_id', user.id);
    if (error) { Alert.alert('Error', 'Could not load circle members.'); return; }
    const memberIds = new Set((data ?? []).map((m: { user_id: string }) => m.user_id));
    setExpandedCircleIds(prev => new Set(prev).add(circle.id));
    setCircleMembersMap(prev => new Map(prev).set(circle.id, memberIds));
    setSelectedPool(prev => {
      const next = new Map(prev);
      (data ?? []).forEach((m: { user_id: string; profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | Pick<Profile, 'id' | 'full_name' | 'avatar_url'>[] }) => {
        const profile = Array.isArray(m.profile) ? m.profile[0] : m.profile;
        if (profile) next.set(m.user_id, profile);
      });
      return next;
    });
  }, [user, expandedCircleIds, circleMembersMap, individuallyAddedUserIds]);

  const removeFromPool = useCallback((userId: string) => {
    setSelectedPool(prev => { const next = new Map(prev); next.delete(userId); return next; });
    setIndividuallyAddedUserIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
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
    const list = (data ?? []) as Profile[];
    setSearchResults(list);
    setSearching(false);
  }, [user]);

  const addFromSearch = useCallback((profile: Profile) => {
    setSelectedPool(prev => new Map(prev).set(profile.id, profile));
    setIndividuallyAddedUserIds(prev => new Set(prev).add(profile.id));
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

  // Persist selection changes when editing while in visible mode
  useEffect(() => {
    if (view === 'active' && user) {
      saveSelections();
    }
  }, [view, selectedPool, user, saveSelections]);

  const handleTurnOnVisible = useCallback(async () => {
    await saveSelections();
    if (!user) return;
    const permResult = await checkMipoVisibleModePermissions();
    if (!permResult.ok) {
      const title = permResult.missingPrecise
        ? 'Precise location required'
        : permResult.missingBackground
          ? 'Background location required'
          : 'Location required';
      setPermissionErrorModal({
        visible: true,
        title,
        message: permResult.message ?? 'Mipo needs location permissions to work. Please enable them in Settings.',
        missingBackground: permResult.missingBackground,
      });
      return;
    }
    setLoading(true);
    try {
      await Location.enableNetworkProviderAsync().catch(() => {});
      let loc: Location.LocationObject | null = null;
      try {
        loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
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

      const proximityDistanceM = getProximityDistanceM();
      const { error } = await supabase.from('mipo_visible_sessions').upsert(
        {
          user_id: user.id,
          lat: coords.latitude,
          lng: coords.longitude,
          proximity_distance_m: proximityDistanceM,
          started_at: now.toISOString(),
          expires_at: expiresAt?.toISOString() ?? null,
          updated_at: now.toISOString(),
        },
        { onConflict: 'user_id' }
      );
      if (error) throw error;

      const sub = await startMipoLocationWatch(user.id);
      if (!sub) {
        await supabase.from('mipo_visible_sessions').delete().eq('user_id', user.id);
        setPermissionErrorModal({
          visible: true,
          title: 'Location required',
          message: Platform.OS === 'ios'
            ? 'Mipo needs "Allow all the time" location access to notify you when friends are nearby. Please enable it in Settings > Privacy > Location Services > Miba.'
            : 'Could not start location tracking. Please check that location permissions are enabled in Settings.',
          missingBackground: Platform.OS === 'ios',
        });
        return;
      }
      setLocationSub(sub);

      // One immediate location poll after turning on - triggers proximity check right away
      // (background task may not fire for several seconds)
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        .then((loc) =>
          supabase.from('mipo_visible_sessions').update({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            updated_at: new Date().toISOString(),
          }).eq('user_id', user.id)
        )
        .catch(() => {});

      setVisible(true, expiresAt);
      setView('active');
      refreshNearby();

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
  }, [user, timerOption, getProximityDistanceM, setVisible, saveSelections, refreshNearby]);

  const handleTurnOffVisible = useCallback(async () => {
    if (!user) return;
    if (expiryIntervalRef.current) {
      clearInterval(expiryIntervalRef.current);
      expiryIntervalRef.current = null;
    }
    const sub = locationSub;
    setLocationSub(null);
    if (sub) await sub.remove();
    await supabase.from('mipo_visible_sessions').delete().eq('user_id', user.id);
    setVisible(false, null);
    setView('selection');
    refreshVisibleState();
  }, [user, locationSub, setVisible, refreshVisibleState]);

  turnOffRef.current = handleTurnOffVisible;

  const updateSessionDistance = useCallback((meters: number) => {
    if (!user || !visibleState.isVisible) return;
    supabase
      .from('mipo_visible_sessions')
      .update({ proximity_distance_m: meters, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .then(() => {});
  }, [user, visibleState.isVisible]);

  // Re-request background permission when showing the "allow all the time" error modal
  useEffect(() => {
    if (permissionErrorModal.visible && permissionErrorModal.missingBackground) {
      if (Platform.OS === 'android') {
        // On Android, requestBackgroundPermissionsAsync often doesn't open settings reliably.
        // Linking.openSettings() opens the app's settings page where the user can set "Allow all the time".
        Linking.openSettings();
      } else {
        requestBackgroundLocationPermission();
      }
    }
  }, [permissionErrorModal.visible, permissionErrorModal.missingBackground]);

  const checkMipoUnread = useCallback(async () => {
    if (!user || nearbyEvents.length === 0) {
      setUnreadByEventId(new Map());
      return;
    }
    const pairs = nearbyEvents.map(e => {
      const [a, b] = e.user_a_id < e.user_b_id ? [e.user_a_id, e.user_b_id] : [e.user_b_id, e.user_a_id];
      return { eventId: e.id, userA: a, userB: b };
    });
    const next = new Map<string, boolean>();
    await Promise.all(
      pairs.map(async ({ eventId, userA, userB }) => {
        const { data: dm } = await supabase
          .from('mipo_dm_activities')
          .select('activity_id')
          .eq('user_a_id', userA)
          .eq('user_b_id', userB)
          .maybeSingle();
        const activityId = dm?.activity_id;
        if (!activityId) return;
        try {
          const stored = await AsyncStorage.getItem(`miba_chat_last_read_${activityId}`);
          const since = stored ?? '1970-01-01T00:00:00Z';
          const { count } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('activity_id', activityId)
            .neq('user_id', user.id)
            .gt('created_at', since);
          next.set(eventId, (count ?? 0) > 0);
        } catch {}
      })
    );
    setUnreadByEventId(prev => {
      const m = new Map(prev);
      next.forEach((v, k) => m.set(k, v));
      return m;
    });
  }, [user, nearbyEvents]);

  useFocusEffect(useCallback(() => { checkMipoUnread(); }, [checkMipoUnread]));

  const filteredNearbyEvents = nearbyEvents;

  const openMipoChat = useCallback(async (e: ProximityEventWithProfile) => {
    if (!user) return;
    const otherId = e.user_a_id === user.id ? e.user_b_id : e.user_a_id;
    const otherName = e.other_profile?.full_name ?? 'Someone';
    const [userA, userB] = user.id < otherId ? [user.id, otherId] : [otherId, user.id];

    const { data: existing } = await supabase
      .from('mipo_dm_activities')
      .select('activity_id')
      .eq('user_a_id', userA)
      .eq('user_b_id', userB)
      .single();

    if (existing?.activity_id) {
      router.push(`/(app)/activity/${existing.activity_id}/chat`);
      return;
    }

    const activityId = Crypto.randomUUID();
    const now = new Date();
    const { error: actErr } = await supabase.from('activities').insert({
      id: activityId,
      created_by: user.id,
      title: `Chat with ${otherName}`,
      description: 'Quick chat from Mipo',
      activity_time: now.toISOString(),
    });
    if (actErr) {
      Alert.alert('Error', actErr.message ?? 'Could not create chat.');
      return;
    }

    const { error: rsvpErr } = await supabase.from('rsvps').insert([
      { activity_id: activityId, user_id: user.id, status: 'in' },
      { activity_id: activityId, user_id: otherId, status: 'in' },
    ]);
    if (rsvpErr) {
      Alert.alert('Error', rsvpErr.message ?? 'Could not add chat members.');
      return;
    }

    await supabase.from('mipo_dm_activities').insert({
      user_a_id: userA,
      user_b_id: userB,
      activity_id: activityId,
    });

    router.push(`/(app)/activity/${activityId}/chat`);
  }, [user, router]);

  const selectedList = [...selectedPool.values()];

  if (view === 'active') {
    const visibleUntilLabel = visibleState.expiresAt
      ? `You're visible until ${format(visibleState.expiresAt, 'HH:mm')}`
      : 'You\'re visible — no time limit';
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: 20 }]} showsVerticalScrollIndicator={false}>
          <Text style={styles.title}>Mipo</Text>
          <HowItWorksButton onPress={() => { setComicScale(1); setShowHowItWorks(true); }} />
          {filteredNearbyEvents.length > 0 && (
            <View style={styles.nearbySection}>
              <Text style={styles.nearbyTitle}>Nearby now</Text>
              {filteredNearbyEvents.map(e => (
                <View key={e.id} style={styles.nearbyRow}>
                  <Avatar uri={e.other_profile?.avatar_url} name={e.other_profile?.full_name} size={40} />
                  <View style={styles.nearbyInfo}>
                    <Text style={styles.nearbyName}>{e.other_profile?.full_name ?? 'Someone'}</Text>
                    <Text style={styles.nearbyTime}>{format(new Date(e.created_at), 'HH:mm')}</Text>
                  </View>
                  <TouchableOpacity onPress={() => openMipoChat(e)} style={styles.nearbyChatBtn}>
                    <View>
                      <Ionicons name="chatbubble-outline" size={22} color={Colors.primary} />
                      {unreadByEventId.get(e.id) && <View style={styles.chatBadge} />}
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.label}>Notify when within</Text>
            <View style={styles.timerRow}>
              {DISTANCE_PRESETS.map(p => (
                <TouchableOpacity
                  key={p.value}
                  style={[styles.timerChip, distanceOption === p.value && styles.timerChipActive]}
                  onPress={() => {
                    setDistanceOption(p.value);
                    if (p.value !== 'custom') updateSessionDistance(p.meters);
                  }}
                >
                  <Text style={[styles.timerChipText, distanceOption === p.value && styles.timerChipTextActive]}>
                    {p.value === 'custom' ? 'Custom' : p.value}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {distanceOption === 'custom' && (
              <View style={[styles.searchBox, { marginTop: 8 }]}>
                <TextInput
                  style={styles.searchInput}
                  value={customDistanceM}
                  onChangeText={setCustomDistanceM}
                  onBlur={() => updateSessionDistance(getProximityDistanceM())}
                  placeholder={`${CUSTOM_DISTANCE_MIN}–${CUSTOM_DISTANCE_MAX} m`}
                  placeholderTextColor={Colors.textSecondary}
                  keyboardType="number-pad"
                />
                <Text style={styles.sublabel}>meters</Text>
              </View>
            )}
            <Text style={[styles.sublabel, { marginTop: 4 }]}>
              {distanceOption === '500m' && '5 min walk'}
              {distanceOption === '3km' && 'Same neighborhood'}
              {distanceOption === '10km' && 'Same city'}
              {distanceOption === 'custom' && `${getProximityDistanceM()}m`}
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.label}>Who can see you (edit anytime)</Text>
            <Text style={styles.sublabel}>Select via circle</Text>
            {circles.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
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
            )}
            <Text style={styles.sublabel}>Select by name</Text>
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
            {selectedList.length > 0 && (
              <>
                <Text style={styles.sublabel}>Selected</Text>
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
              </>
            )}
          </View>
        </ScrollView>
        <View style={[styles.mipoFooter, { paddingBottom: insets.bottom + 8 }]}>
          <Text style={styles.youreVisibleLabel}>{visibleUntilLabel}</Text>
          <View style={[styles.buttonWithRadar, { marginTop: 12 }]}>
            <Button label="Turn off visible mode" onPress={handleTurnOffVisible} variant="danger" fullWidth={false} style={styles.buttonWithRadarBtn} />
            <Image source={require('@/assets/images/radar.gif')} style={styles.radarGifSmall} resizeMode="contain" />
          </View>
        </View>
        <Modal visible={showHowItWorks} transparent animationType="fade">
          <GestureHandlerRootView style={{ flex: 1 }}>
            <View style={styles.modalOverlay}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowHowItWorks(false)} />
              <View style={[styles.modalContent, { width: Math.min(400, screenWidth - 40) }]}>
                <TouchableOpacity style={styles.modalClose} onPress={() => setShowHowItWorks(false)}>
                  <Ionicons name="close" size={28} color={Colors.text} />
                </TouchableOpacity>
                <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false} scrollEnabled={comicScale <= 1}>
                  <ZoomableImage source={MIPO_COMIC} style={{ width: comicMaxWidth, height: comicHeight }} onScaleChange={setComicScale} />
                </ScrollView>
              </View>
            </View>
          </GestureHandlerRootView>
        </Modal>
        <Modal visible={permissionErrorModal.visible} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setPermissionErrorModal(p => ({ ...p, visible: false }))} />
            <View style={[styles.modalContent, styles.permissionModalContent, { width: Math.min(400, screenWidth - 40) }]}>
              <TouchableOpacity style={styles.modalClose} onPress={() => setPermissionErrorModal(p => ({ ...p, visible: false }))}>
                <Ionicons name="close" size={28} color={Colors.text} />
              </TouchableOpacity>
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.permissionModalScrollContent} showsVerticalScrollIndicator={false}>
                <Image source={MIPO_PERMISSIONS_HOWTO} style={styles.permissionHowtoImage} resizeMode="contain" />
                <Text style={styles.permissionModalTitle}>{permissionErrorModal.title}</Text>
                <Text style={styles.permissionModalMessage}>{permissionErrorModal.message}</Text>
              </ScrollView>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingBottom: 20 }]} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Mipo</Text>
        <HowItWorksButton onPress={() => { setComicScale(1); setShowHowItWorks(true); }} />

        {filteredNearbyEvents.length > 0 && visibleState.isVisible && (
          <View style={styles.nearbySection}>
            <Text style={styles.nearbyTitle}>Nearby now</Text>
            {filteredNearbyEvents.map(e => (
              <View key={e.id} style={styles.nearbyRow}>
                <Avatar uri={e.other_profile?.avatar_url} name={e.other_profile?.full_name} size={40} />
                <View style={styles.nearbyInfo}>
                  <Text style={styles.nearbyName}>{e.other_profile?.full_name ?? 'Someone'}</Text>
                  <Text style={styles.nearbyTime}>{format(new Date(e.created_at), 'HH:mm')}</Text>
                </View>
                <TouchableOpacity onPress={() => openMipoChat(e)} style={styles.nearbyChatBtn}>
                  <View>
                    <Ionicons name="chatbubble-outline" size={22} color={Colors.primary} />
                    {unreadByEventId.get(e.id) && <View style={styles.chatBadge} />}
                  </View>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

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

        <View style={styles.section}>
          <Text style={styles.label}>Notify when within</Text>
          <View style={styles.timerRow}>
            {DISTANCE_PRESETS.map(p => (
              <TouchableOpacity
                key={p.value}
                style={[styles.timerChip, distanceOption === p.value && styles.timerChipActive]}
                onPress={() => setDistanceOption(p.value)}
              >
                <Text style={[styles.timerChipText, distanceOption === p.value && styles.timerChipTextActive]}>
                  {p.value === 'custom' ? 'Custom' : p.value}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
            {distanceOption === 'custom' && (
              <View style={[styles.searchBox, { marginTop: 8 }]}>
                <TextInput
                  style={styles.searchInput}
                  value={customDistanceM}
                  onChangeText={setCustomDistanceM}
                  placeholder={`${CUSTOM_DISTANCE_MIN}–${CUSTOM_DISTANCE_MAX} m`}
                  placeholderTextColor={Colors.textSecondary}
                  keyboardType="number-pad"
                />
                <Text style={[styles.sublabel, { marginLeft: 4 }]}>m</Text>
              </View>
            )}
          <Text style={[styles.sublabel, { marginTop: 4 }]}>
            {distanceOption === '500m' && '5 min walk'}
            {distanceOption === '3km' && 'Same neighborhood'}
            {distanceOption === '10km' && 'Same city'}
            {distanceOption === 'custom' && `${getProximityDistanceM()}m`}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Who can see you (edit anytime)</Text>
          <Text style={styles.sublabel}>Select via circle</Text>
          {circles.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
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
          )}
          <Text style={styles.sublabel}>Select by name</Text>
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
          {selectedList.length > 0 && (
            <>
              <Text style={styles.sublabel}>Selected</Text>
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
            </>
          )}
        </View>
      </ScrollView>
      <View style={[styles.mipoFooter, { paddingBottom: insets.bottom + 8 }]}>
        <View style={[styles.buttonWithRadar, { marginTop: 0 }]}>
          <Button label="Turn on visible mode" onPress={handleTurnOnVisible} loading={loading} disabled={selectedList.length === 0} fullWidth={false} style={styles.buttonWithRadarBtn} />
          <Image source={require('@/assets/images/radar.gif')} style={styles.radarGifSmall} resizeMode="contain" />
        </View>
      </View>
      <Modal visible={showHowItWorks} transparent animationType="fade">
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowHowItWorks(false)} />
            <View style={[styles.modalContent, { width: Math.min(400, screenWidth - 40) }]}>
              <TouchableOpacity style={styles.modalClose} onPress={() => setShowHowItWorks(false)}>
                <Ionicons name="close" size={28} color={Colors.text} />
              </TouchableOpacity>
              <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false} scrollEnabled={comicScale <= 1}>
                <ZoomableImage source={MIPO_COMIC} style={{ width: comicMaxWidth, height: comicHeight }} onScaleChange={setComicScale} />
              </ScrollView>
            </View>
          </View>
        </GestureHandlerRootView>
      </Modal>
      <Modal visible={permissionErrorModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPermissionErrorModal(p => ({ ...p, visible: false }))} />
          <View style={[styles.modalContent, styles.permissionModalContent, { width: Math.min(400, screenWidth - 40) }]}>
            <TouchableOpacity style={styles.modalClose} onPress={() => setPermissionErrorModal(p => ({ ...p, visible: false }))}>
              <Ionicons name="close" size={28} color={Colors.text} />
            </TouchableOpacity>
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.permissionModalScrollContent} showsVerticalScrollIndicator={false}>
              <Image source={MIPO_PERMISSIONS_HOWTO} style={styles.permissionHowtoImage} resizeMode="contain" />
              <Text style={styles.permissionModalTitle}>{permissionErrorModal.title}</Text>
              <Text style={styles.permissionModalMessage}>{permissionErrorModal.message}</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 20 },
  title: { fontSize: 24, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  subtitle: { fontSize: 15, color: Colors.textSecondary, marginBottom: 24 },
  howItWorksBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  howItWorksCaption: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    maxWidth: 400,
    maxHeight: '90%',
    overflow: 'hidden',
  },
  modalClose: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    padding: 4,
    backgroundColor: Colors.surface,
    borderRadius: 20,
  },
  permissionModalContent: { maxHeight: '85%' },
  permissionModalScrollContent: { padding: 20, paddingTop: 56, alignItems: 'center' },
  permissionHowtoImage: { width: '100%', height: 220, marginBottom: 16 },
  permissionModalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  permissionModalMessage: { fontSize: 15, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  modalScroll: { maxHeight: '100%' },
  modalScrollContent: { padding: 20, paddingTop: 56, alignItems: 'center' },
  youreVisibleLabel: { fontSize: 18, color: Colors.success, fontWeight: '600', marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  sublabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 10 },
  section: { marginBottom: 22 },
  timerSection: { marginBottom: 20 },
  timerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  timerChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8 },
  timerChipActive: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  timerChipText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  timerChipTextActive: { color: Colors.primary },
  mipoFooter: {
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  buttonWithRadar: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
  buttonWithRadarBtn: { flex: 1 },
  radarGifSmall: { width: 50, height: 50 },
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
  nearbyChatBtn: { padding: 4 },
  chatBadge: {
    position: 'absolute', top: -2, right: -2,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.danger,
    borderWidth: 1.5, borderColor: Colors.successLight,
  },
  nearbyInfo: { flex: 1 },
  nearbyName: { fontSize: 16, fontWeight: '600', color: Colors.text },
  nearbyTime: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});
