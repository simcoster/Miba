import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator, Linking, Modal, Pressable, Dimensions,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, addHours } from 'date-fns';
import * as Crypto from 'expo-crypto';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Circle, Profile } from '@/lib/types';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { LocationAutocomplete } from '@/components/LocationAutocomplete';
import { parseLocation, buildLocationWithPlace } from '@/lib/locationUtils';
import { SPLASH_PRESETS, type SplashPreset } from '@/lib/splashArt';
import { SplashArt } from '@/components/SplashArt';
import Colors from '@/constants/Colors';

export default function NewActivityScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const {
    clone,
    cloneFrom,
    title: paramTitle,
    description: paramDescription,
    location: paramLocation,
    splashArt: paramSplashArt,
  } = useLocalSearchParams<{
    clone?: string;
    cloneFrom?: string;
    title?: string;
    description?: string;
    location?: string;
    splashArt?: string;
  }>();

  const isClone = clone === '1';

  const [title, setTitle] = useState(paramTitle ?? '');
  const [description, setDescription] = useState(paramDescription ?? '');
  const [location, setLocation] = useState(paramLocation ?? '');
  const [splashArt, setSplashArt] = useState<SplashPreset>(
    (paramSplashArt as SplashPreset) || SPLASH_PRESETS[0].id
  );

  // When cloning: always apply the cloned event's fields, replacing any current values
  useEffect(() => {
    if (!isClone) return;
    if (paramTitle != null) setTitle(paramTitle);
    if (paramDescription != null) setDescription(paramDescription);
    if (paramLocation != null) setLocation(paramLocation);
    if (paramSplashArt != null) setSplashArt(paramSplashArt as SplashPreset);
    if (paramDescription) setShowDetailsInput(true);
  }, [isClone, paramTitle, paramDescription, paramLocation, paramSplashArt]);

  // When cloning: fetch and apply the invitee list from the source activity
  useEffect(() => {
    if (!isClone || !cloneFrom || !user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('rsvps')
        .select('user_id, profile:profiles(id, full_name, avatar_url)')
        .eq('activity_id', cloneFrom)
        .neq('user_id', user.id);
      if (cancelled) return;
      const profiles = new Map<string, Pick<Profile, 'id' | 'full_name' | 'avatar_url'>>();
      (data ?? []).forEach((r: any) => {
        const p = Array.isArray(r.profile) ? r.profile?.[0] : r.profile;
        if (p && r.user_id !== user.id) profiles.set(r.user_id, p);
      });
      setInvitePool(profiles);
      setIndividuallyAddedUserIds(new Set(profiles.keys()));
      setExpandedCircleIds(new Set());
      setCircleMembersMap(new Map());
    })();
    return () => { cancelled = true; };
  }, [isClone, cloneFrom, user]);

  // When navigating to New Event with no params: reset to defaults (empty name, empty invitees)
  useEffect(() => {
    const hasParams = isClone || cloneFrom || paramTitle || paramDescription || paramLocation || paramSplashArt;
    if (!hasParams) {
      setTitle('');
      setDescription('');
      setLocation('');
      setSplashArt(SPLASH_PRESETS[0].id);
      setShowDetailsInput(false);
      setInvitePool(new Map());
      setExpandedCircleIds(new Set());
      setCircleMembersMap(new Map());
      setIndividuallyAddedUserIds(new Set());
      setSearchQuery('');
      setSearchResults([]);
    }
  }, [isClone, paramTitle, paramDescription, paramLocation, paramSplashArt]);
  const [showSplashPicker, setShowSplashPicker] = useState(false);
  const [showDetailsInput, setShowDetailsInput] = useState(!!paramDescription);
  const [isLimited, setIsLimited] = useState(false);
  const [maxParticipants, setMaxParticipants] = useState<number>(1);
  const [activityTime, setActivityTime] = useState<Date>(addHours(new Date(), 1));
  const [timeHighlight, setTimeHighlight] = useState(false);
  const [showExcludeBubble, setShowExcludeBubble] = useState(false);
  const [showLimitedBubble, setShowLimitedBubble] = useState(false);
  const [bubblePosition, setBubblePosition] = useState<{ x: number; y: number } | null>(null);
  const excludeIconRef = useRef<View>(null);
  const limitedIconRef = useRef<View>(null);
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  // Circles for quick-add
  const [circles, setCircles] = useState<Circle[]>([]);
  // Track which circle IDs have been expanded into the invite pool
  const [expandedCircleIds, setExpandedCircleIds] = useState<Set<string>>(new Set());
  // Map circleId -> Set of userIds (for removing on unselect)
  const [circleMembersMap, setCircleMembersMap] = useState<Map<string, Set<string>>>(new Map());
  // Users added individually via search (keep when unselecting circle)
  const [individuallyAddedUserIds, setIndividuallyAddedUserIds] = useState<Set<string>>(new Set());

  // Invite pool: map of userId → profile
  const [invitePool, setInvitePool] = useState<Map<string, Pick<Profile, 'id' | 'full_name' | 'avatar_url'>>>(new Map());

  // Individual search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  // Exclude (host only, create only)
  const [showExclude, setShowExclude] = useState(false);
  const [excludeUserIds, setExcludeUserIds] = useState<Set<string>>(new Set());
  const [excludeUserProfiles, setExcludeUserProfiles] = useState<Map<string, Pick<Profile, 'id' | 'full_name' | 'avatar_url'>>>(new Map());
  const [excludeCircleIds, setExcludeCircleIds] = useState<Set<string>>(new Set());
  const [excludeQuery, setExcludeQuery] = useState('');
  const [excludeResults, setExcludeResults] = useState<Profile[]>([]);
  const [excludeSearching, setExcludeSearching] = useState(false);

  const fetchCircles = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('circles')
      .select('id, name, emoji, description, created_by, created_at')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });
    setCircles((data ?? []) as Circle[]);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchCircles();
  }, [fetchCircles]);

  // Highlight the date/time buttons when cloning (don't auto-open the picker)
  useEffect(() => {
    if (!isClone) return;
    const t = setTimeout(() => {
      setTimeHighlight(true);
      setTimeout(() => setTimeHighlight(false), 3000);
    }, 300);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skipFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocus.current) {
        skipFirstFocus.current = false;
        return;
      }
      if (!user) return;
      fetchCircles();
    }, [fetchCircles, user])
  );

  // Expand or collapse a circle's members into/from the invite pool
  const toggleCircle = async (circle: Circle) => {
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
        setInvitePool(prev => {
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
      .select('user_id, profile:profiles(id, full_name, avatar_url)')
      .eq('circle_id', circle.id)
      .neq('user_id', user!.id);

    if (error) { Alert.alert('Error', 'Could not load circle members.'); return; }

    const memberIds = new Set<string>((data ?? []).map((m: { user_id: string }) => m.user_id));

    // Compute excluded set (may be stale in closure, so compute fresh)
    const excluded = new Set(excludeUserIds);
    if (excludeCircleIds.size > 0) {
      const { data: cmData } = await supabase.from('circle_members').select('user_id').in('circle_id', [...excludeCircleIds]);
      (cmData ?? []).forEach((m: { user_id: string }) => excluded.add(m.user_id));
    }

    setExpandedCircleIds(prev => new Set(prev).add(circle.id));
    setCircleMembersMap(prev => new Map(prev).set(circle.id, memberIds));
    setInvitePool(prev => {
      const next = new Map(prev);
      (data ?? []).forEach((m: any) => {
        if (m.profile && !excluded.has(m.user_id)) next.set(m.user_id, m.profile);
      });
      return next;
    });
  };

  const removeFromPool = (userId: string) => {
    setInvitePool(prev => { const next = new Map(prev); next.delete(userId); return next; });
    setIndividuallyAddedUserIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (text.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const excluded = new Set(excludeUserIds);
    if (excludeCircleIds.size > 0) {
      const { data: cmData } = await supabase.from('circle_members').select('user_id').in('circle_id', [...excludeCircleIds]);
      (cmData ?? []).forEach((m: { user_id: string }) => excluded.add(m.user_id));
    }
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, username')
      .or(`full_name.ilike.%${text.trim()}%,username.ilike.%${text.trim()}%`)
      .neq('id', user!.id)
      .limit(20);
    const filtered = ((data ?? []) as Profile[]).filter(p => !excluded.has(p.id));
    setSearchResults(filtered);
    setSearching(false);
  };

  const addFromSearch = (profile: Profile) => {
    if (excludeUserIds.has(profile.id)) return;
    setInvitePool(prev => new Map(prev).set(profile.id, profile));
    setIndividuallyAddedUserIds(prev => new Set(prev).add(profile.id));
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleExcludeSearch = async (text: string) => {
    setExcludeQuery(text);
    if (text.trim().length < 2) { setExcludeResults([]); return; }
    setExcludeSearching(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, username')
      .or(`full_name.ilike.%${text.trim()}%,username.ilike.%${text.trim()}%`)
      .neq('id', user!.id)
      .limit(20);
    const filtered = ((data ?? []) as Profile[]).filter(p => !excludeUserIds.has(p.id));
    setExcludeResults(filtered);
    setExcludeSearching(false);
  };

  const addExclusionUser = (profile: Profile) => {
    setExcludeUserIds(prev => new Set(prev).add(profile.id));
    setExcludeUserProfiles(prev => new Map(prev).set(profile.id, profile));
    setInvitePool(prev => { const next = new Map(prev); next.delete(profile.id); return next; });
    setIndividuallyAddedUserIds(prev => { const s = new Set(prev); s.delete(profile.id); return s; });
    setExcludeQuery('');
    setExcludeResults([]);
  };

  const addExclusionCircle = async (circle: Circle) => {
    setExcludeCircleIds(prev => new Set(prev).add(circle.id));
    const { data } = await supabase.from('circle_members').select('user_id').eq('circle_id', circle.id);
    const memberIds = new Set<string>((data ?? []).map((m: { user_id: string }) => m.user_id));
    setInvitePool(prev => {
      const next = new Map(prev);
      memberIds.forEach(uid => next.delete(uid));
      return next;
    });
  };

  const removeExclusionUser = (userId: string) => {
    setExcludeUserIds(prev => { const s = new Set(prev); s.delete(userId); return s; });
    setExcludeUserProfiles(prev => { const m = new Map(prev); m.delete(userId); return m; });
  };

  const removeExclusionCircle = async (circleId: string) => {
    setExcludeCircleIds(prev => { const s = new Set(prev); s.delete(circleId); return s; });
    // If this circle was expanded, add its members back to the invite pool
    if (expandedCircleIds.has(circleId)) {
      const { data } = await supabase
        .from('circle_members')
        .select('user_id, profile:profiles(id, full_name, avatar_url)')
        .eq('circle_id', circleId)
        .neq('user_id', user!.id);
      const excluded = new Set(excludeUserIds);
      if (excludeCircleIds.size > 1) {
        const otherExcluded = [...excludeCircleIds].filter(cid => cid !== circleId);
        const { data: cmData } = await supabase.from('circle_members').select('user_id').in('circle_id', otherExcluded);
        (cmData ?? []).forEach((m: { user_id: string }) => excluded.add(m.user_id));
      }
      setInvitePool(prev => {
        const next = new Map(prev);
        (data ?? []).forEach((m: any) => {
          if (m.profile && !excluded.has(m.user_id)) next.set(m.user_id, m.profile);
        });
        return next;
      });
    }
  };

  const handleCreate = async () => {
    if (!user || title.trim().length < 2) return;
    if (invitePool.size === 0) {
      Alert.alert('Add invitees', 'Please add at least one person or circle to invite.');
      return;
    }
    if (activityTime <= new Date()) {
      Alert.alert('Past date', 'Please choose a future date and time.');
      return;
    }
    try {
      setLoading(true);

      // Compute final invitees before creating — validate again in case state changed (e.g. unselect)
      const excluded = new Set(excludeUserIds);
      if (excludeCircleIds.size > 0) {
        const { data: cmData } = await supabase.from('circle_members').select('user_id').in('circle_id', [...excludeCircleIds]);
        (cmData ?? []).forEach((m: { user_id: string }) => excluded.add(m.user_id));
      }
      const finalInviteIds = [...invitePool.keys()].filter(uid => !excluded.has(uid));

      if (finalInviteIds.length === 0) {
        Alert.alert('Add invitees', 'Please add at least one person or circle to invite.');
        setLoading(false);
        return;
      }

      const activityId = Crypto.randomUUID();

      const { error: activityError } = await supabase.from('activities').insert({
        id: activityId,
        created_by: user.id,
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        activity_time: activityTime.toISOString(),
        splash_art: splashArt,
        is_limited: isLimited,
        max_participants: isLimited ? maxParticipants : null,
      });
      if (activityError) throw activityError;

      // Build rsvp rows: creator gets 'in', everyone in filtered pool gets 'pending'
      const rsvpRows = [
        { activity_id: activityId, user_id: user.id, status: 'in' as const },
        ...finalInviteIds.map(uid => ({
          activity_id: activityId,
          user_id: uid,
          status: 'pending' as const,
        })),
      ];

      const { error: rsvpError } = await supabase.from('rsvps').insert(rsvpRows);
      if (rsvpError) throw rsvpError;

      // Persist exclusions (host-only record)
      const exclusionRows = [
        ...[...excludeUserIds].map((uid: string) => ({ activity_id: activityId, user_id: uid, circle_id: null })),
        ...[...excludeCircleIds].map((cid: string) => ({ activity_id: activityId, user_id: null, circle_id: cid })),
      ];
      if (exclusionRows.length > 0) {
        await supabase.from('activity_exclusions').insert(exclusionRows);
      }

      router.replace(`/(app)/activity/${activityId}?fromTab=upcoming`);
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Could not create activity.');
    } finally {
      setLoading(false);
    }
  };

  const inviteList = [...invitePool.values()];

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader title="New Event" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Title + Cover — merged section with splash as background */}
        <View style={[styles.titleSection, splashArt && styles.titleSectionWithSplash]}>
          {splashArt && (
            <View style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
              <SplashArt preset={splashArt} height={300} opacity={0.35} />
            </View>
          )}
          <View style={styles.titleSectionInner}>
            <TouchableOpacity
              style={styles.addCoverBtn}
              onPress={() => setShowSplashPicker(v => !v)}
            >
              <Ionicons name="image-outline" size={16} color={Colors.primary} />
              <Text style={styles.addCoverBtnText}>{splashArt ? 'Change cover image' : 'Cover image'}</Text>
            </TouchableOpacity>
            {showSplashPicker && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.splashScroll} contentContainerStyle={styles.splashScrollContent}>
                {SPLASH_PRESETS.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.splashOption, styles.splashOptionImage, splashArt === p.id && styles.splashOptionActive]}
                    onPress={() => { setSplashArt(p.id); setShowSplashPicker(false); }}
                  >
                    <View style={styles.splashThumb}>
                      <SplashArt preset={p.id} height={56} opacity={1} />
                    </View>
                    <Text style={styles.splashOptionLabel}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <Text style={[styles.label, styles.titleLabel]}>What's happening? *</Text>
            <TextInput
              style={styles.input} value={title} onChangeText={setTitle}
              placeholder="e.g. Morning surf, Escape room…"
              placeholderTextColor={Colors.textSecondary} maxLength={80} autoFocus
            />
          </View>
        </View>
        
        {/* Details (hidden until button tapped) */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.addCoverBtn}
            onPress={() => setShowDetailsInput(v => !v)}
          >
            <Ionicons name="document-text-outline" size={16} color={Colors.primary} />
            <Text style={styles.addCoverBtnText}>{description.trim() ? 'Change details' : 'Details'}</Text>
          </TouchableOpacity>
          {showDetailsInput && (
            <TextInput
              style={[styles.input, styles.textArea, { marginTop: 10 }]}
              value={description}
              onChangeText={setDescription}
              placeholder="Any extra info…"
              placeholderTextColor={Colors.textSecondary}
              maxLength={300}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
            />
          )}
        </View>

        {/* Date & Time */}
        <View style={styles.section}>
          <Text style={styles.label}>When? *</Text>
          <View style={styles.datetimeRow}>
            <TouchableOpacity
              style={[styles.datetimeBtn, { flex: 2 }, timeHighlight && { borderColor: Colors.primary, borderWidth: 2 }]}
              onPress={() => { setPickerMode('date'); setShowPicker(true); }}
            >
              <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
              <Text style={styles.datetimeText}>{format(activityTime, 'EEE, MMM d')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.datetimeBtn, { flex: 1 }, timeHighlight && { borderColor: Colors.primary, borderWidth: 2 }]}
              onPress={() => { setPickerMode('time'); setShowPicker(true); }}
            >
              <Ionicons name="time-outline" size={18} color={Colors.primary} />
              <Text style={styles.datetimeText}>{format(activityTime, 'h:mm a')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showPicker && (
          <DateTimePicker
            value={activityTime} mode={pickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onChange={(_, date) => { setShowPicker(false); if (date) setActivityTime(date); }}
          />
        )}

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.label}>Where?</Text>
          <LocationAutocomplete
            value={parseLocation(location)?.address ?? location ?? ''}
            onChangeText={(text) => setLocation(text)}
            onResolvedPlace={(p) => setLocation(buildLocationWithPlace(p.address, p.placeId, p.displayName))}
            placeholder="Venue or address"
            maxLength={150}
          />
        </View>

      
        {/* Invite via Circles */}
        <View style={styles.section}>
          <Text style={styles.label}>Invite</Text>
          {circles.length === 0 ? (
            <TouchableOpacity style={styles.emptyCircles} onPress={() => router.push('/(app)/circle/new?fromTab=events')}>
              <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
              <Text style={styles.emptyCirclesText}>Create a circle first</Text>
            </TouchableOpacity>
          ) : (
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
          )}
        </View>

        {/* Individual Search */}
        <View style={styles.section}>
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput} value={searchQuery} onChangeText={handleSearch}
              placeholder="Search by name or username…" placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none" autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={Colors.primary} />}
            {searchQuery.length > 0 && !searching && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.excludeRow}>
            <TouchableOpacity
              style={[styles.excludeBtn, showExclude && styles.excludeBtnActive]}
              onPress={() => { setShowExclude(v => !v); setExcludeQuery(''); setExcludeResults([]); }}
            >
              <Ionicons name={showExclude ? 'chevron-up' : 'person-remove-outline'} size={14} color={showExclude ? Colors.textSecondary : Colors.primary} />
              <Text style={[styles.excludeBtnText, showExclude && { color: Colors.textSecondary }]}>Exclude</Text>
            </TouchableOpacity>
            <View ref={excludeIconRef} collapsable={false}>
              <TouchableOpacity
                onPress={() => {
                  excludeIconRef.current?.measureInWindow((x, y, w) => {
                    setBubblePosition({ x: x + w + 8, y });
                    setShowExcludeBubble(true);
                  });
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="information-circle-outline" size={20} color="#3B82F6" />
              </TouchableOpacity>
            </View>
          </View>
          {searchQuery.trim().length >= 2 && !searching && (
            <View style={styles.searchResults}>
              {searchResults.length > 0 ? (
                <>
                  {searchResults.map(p => {
                    const already = invitePool.has(p.id);
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
                        {already
                          ? <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
                          : <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </>
              ) : (
                <View style={styles.noResultsHint}>
                  <Text style={styles.noResultsText}>No users found for "{searchQuery.trim()}"</Text>
                </View>
              )}
              <TouchableOpacity
                style={styles.inviteLinkRow}
                onPress={async () => {
                  await Clipboard.setStringAsync('https://forms.gle/emYw5bgybEhcH3iB8');
                  Toast.show({ type: 'success', text1: 'Invite link copied' });
                }}
              >
                <Ionicons name="link-outline" size={18} color={Colors.primary} />
                <Text style={styles.inviteLinkText}>Not here? Click to copy invite link</Text>
              </TouchableOpacity>
            </View>
          )}
          {searchQuery.trim().length >= 2 && !searching && searchResults.length === 0 &&
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(searchQuery.trim()) && (
            <TouchableOpacity
              style={styles.inviteEmailBtn}
              onPress={() => {
                const email = searchQuery.trim();
                const name = profile?.full_name ?? 'A friend';
                const subject = encodeURIComponent('Join me on Miba!');
                const body = encodeURIComponent(
                  `Hey!\n\n${name} is inviting you to join Miba — an app for organising hangouts with friends.\n\nDownload it and we can start planning!\n\nhttps://miba.app\n\n— ${name}`
                );
                Linking.openURL(`mailto:${email}?subject=${subject}&body=${body}`);
              }}
            >
              <Ionicons name="mail-outline" size={18} color={Colors.primary} />
              <Text style={styles.inviteEmailText}>Invite <Text style={{ fontWeight: '700' }}>{searchQuery.trim()}</Text> to Miba</Text>
            </TouchableOpacity>
          )}
          {showExclude && (
            <View style={styles.excludeSection}>
              {circles.length > 0 && (
                <View style={styles.excludeCirclesRow}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    {circles.map(c => {
                      const isExcluded = excludeCircleIds.has(c.id);
                      return (
                        <TouchableOpacity
                          key={c.id}
                          style={[styles.excludeChip, isExcluded && styles.excludeChipActive]}
                          onPress={() => isExcluded ? removeExclusionCircle(c.id) : addExclusionCircle(c)}
                        >
                          <Text style={styles.excludeChipEmoji}>{c.emoji}</Text>
                          <Text style={[styles.excludeChipName, isExcluded && styles.excludeChipNameActive]}>{c.name}</Text>
                          {isExcluded && <Ionicons name="checkmark" size={14} color={Colors.primary} />}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              )}
              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color={Colors.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  value={excludeQuery}
                  onChangeText={handleExcludeSearch}
                  placeholder="Search by name or username…"
                  placeholderTextColor={Colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {excludeSearching && <ActivityIndicator size="small" color={Colors.primary} />}
                {excludeQuery.length > 0 && !excludeSearching && (
                  <TouchableOpacity onPress={() => { setExcludeQuery(''); setExcludeResults([]); }}>
                    <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
              {excludeResults.length > 0 && (
                <View style={styles.searchResults}>
                  {excludeResults.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.searchRow}
                      onPress={() => addExclusionUser(p)}
                    >
                      <Avatar uri={p.avatar_url} name={p.full_name} size={36} />
                      <View style={styles.searchInfo}>
                        <Text style={styles.searchName}>{p.full_name ?? 'Unknown'}</Text>
                        {p.username && <Text style={styles.searchUsername}>@{p.username}</Text>}
                      </View>
                      <Ionicons name="remove-circle-outline" size={22} color={Colors.danger} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {(excludeUserIds.size > 0 || excludeCircleIds.size > 0) && (
                <View style={styles.excludedList}>
                  <Text style={styles.excludeSubLabel}>Excluded ({excludeUserIds.size + excludeCircleIds.size})</Text>
                  <View style={styles.excludedChips}>
                    {[...excludeUserProfiles.values()].map(p => (
                      <View key={p.id} style={styles.excludedChip}>
                        <Avatar uri={p.avatar_url} name={p.full_name} size={24} />
                        <Text style={styles.excludedChipName} numberOfLines={1}>{p.full_name?.split(' ')[0] ?? '?'}</Text>
                        <TouchableOpacity onPress={() => removeExclusionUser(p.id)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                          <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    {circles.filter(c => excludeCircleIds.has(c.id)).map(c => (
                      <View key={c.id} style={styles.excludedChip}>
                        <Text style={styles.excludedChipEmoji}>{c.emoji}</Text>
                        <Text style={styles.excludedChipName} numberOfLines={1}>{c.name}</Text>
                        <TouchableOpacity onPress={() => removeExclusionCircle(c.id)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                          <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Invite pool preview */}
        {inviteList.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.label}>Who's invited ({inviteList.length})</Text>
            <View style={styles.invitePool}>
              {inviteList.map(p => (
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

        {/* Limited event */}
        <View style={styles.section}>
          <View style={styles.limitedRow}>
            <TouchableOpacity
              style={styles.addCoverBtn}
              onPress={() => setIsLimited(v => !v)}
            >
              <Ionicons name={isLimited ? 'people' : 'people-outline'} size={16} color={Colors.primary} />
              <Text style={styles.addCoverBtnText}>Limited event</Text>
            </TouchableOpacity>
            <View ref={limitedIconRef} collapsable={false}>
              <TouchableOpacity
                onPress={() => {
                  limitedIconRef.current?.measureInWindow((x, y, w) => {
                    setBubblePosition({ x: x + w + 8, y });
                    setShowLimitedBubble(true);
                  });
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="information-circle-outline" size={20} color="#3B82F6" />
              </TouchableOpacity>
            </View>
          </View>
          {isLimited && (
            <View style={styles.limitedSection}>
              <Text style={styles.label}>Max spots for friends</Text>
              <Text style={styles.limitedHint}>1 = just you + 1 friend</Text>
              <View style={styles.maxInputRow}>
                <TouchableOpacity
                  style={[styles.maxBtn, maxParticipants <= 1 && styles.maxBtnDisabled]}
                  onPress={() => setMaxParticipants(p => Math.max(1, p - 1))}
                  disabled={maxParticipants <= 1}
                >
                  <Ionicons name="remove" size={18} color={maxParticipants <= 1 ? Colors.textSecondary : Colors.primary} />
                </TouchableOpacity>
                <TextInput
                  style={styles.maxInput}
                  value={String(maxParticipants)}
                  onChangeText={(t) => {
                    const n = parseInt(t.replace(/\D/g, ''), 10);
                    if (!isNaN(n)) setMaxParticipants(Math.min(500, Math.max(1, n)));
                    else if (t === '') setMaxParticipants(1);
                  }}
                  keyboardType="number-pad"
                  maxLength={3}
                />
                <TouchableOpacity
                  style={[styles.maxBtn, maxParticipants >= 500 && styles.maxBtnDisabled]}
                  onPress={() => setMaxParticipants(p => Math.min(500, p + 1))}
                  disabled={maxParticipants >= 500}
                >
                  <Ionicons name="add" size={18} color={maxParticipants >= 500 ? Colors.textSecondary : Colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        <Button
          label="Post Activity 🚀"
          onPress={handleCreate}
          loading={loading}
          disabled={title.trim().length < 2 || invitePool.size === 0}
        />
      </ScrollView>

      {/* Tooltip bubbles - overlay closes on any tap */}
      <Modal visible={showExcludeBubble || showLimitedBubble} transparent animationType="fade">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => { setShowExcludeBubble(false); setShowLimitedBubble(false); }}
        />
        {bubblePosition && showExcludeBubble && (
          <Pressable
            style={[
              styles.bubble,
              styles.bubbleRight,
              {
                left: bubblePosition.x,
                top: bubblePosition.y,
                maxWidth: Dimensions.get('window').width - bubblePosition.x - 24,
              },
            ]}
            onPress={() => setShowExcludeBubble(false)}
          >
            <Text style={styles.bubbleText}>Invite all, except selected people.</Text>
          </Pressable>
        )}
        {bubblePosition && showLimitedBubble && (
          <Pressable
            style={[
              styles.bubble,
              styles.bubbleRight,
              {
                left: bubblePosition.x,
                top: bubblePosition.y,
                maxWidth: Dimensions.get('window').width - bubblePosition.x - 24,
              },
            ]}
            onPress={() => setShowLimitedBubble(false)}
          >
            <Text style={styles.bubbleText}>Cap how many friends can join.</Text>
          </Pressable>
        )}
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 22 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  excludeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  excludeBtnActive: {},
  excludeBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  limitedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  limitedSection: { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  limitedHint: { fontSize: 13, color: Colors.textSecondary, marginBottom: 8 },
  maxInputRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  maxBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  maxBtnDisabled: { opacity: 0.5 },
  maxInput: { width: 70, backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 10, fontSize: 18, fontWeight: '600', color: Colors.text, textAlign: 'center' },
  excludeSection: {
    marginTop: 12,
    padding: 14,
    paddingTop: 14,
    backgroundColor: Colors.dangerLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  excludeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  bubbleRight: { position: 'absolute' as const, minWidth: 160, maxWidth: 280 },
  excludeSubLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 8 },
  excludeCirclesRow: { marginBottom: 4 },
  excludeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 },
  excludeChipActive: { borderColor: Colors.danger, backgroundColor: Colors.dangerLight },
  excludeChipEmoji: { fontSize: 16 },
  excludeChipName: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  excludeChipNameActive: { color: Colors.danger },
  excludedList: { marginTop: 12 },
  excludedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  excludedChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.dangerLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 130 },
  excludedChipName: { fontSize: 13, fontWeight: '600', color: Colors.danger, flex: 1 },
  excludedChipEmoji: { fontSize: 14 },
  input: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: Colors.text },
  textArea: { minHeight: 100, paddingTop: 12 },
  datetimeRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  datetimeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12 },
  datetimeText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  emptyCircles: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed', padding: 14 },
  emptyCirclesText: { fontSize: 15, color: Colors.primary, fontWeight: '500' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8, marginRight: 8 },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  chipEmoji: { fontSize: 16 },
  chipName: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  chipNameSelected: { color: Colors.primaryDark },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, fontSize: 16, color: Colors.text, paddingVertical: 12 },
  searchResults: { marginTop: 6, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  inviteLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
  inviteLinkText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
  noResultsHint: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  noResultsText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  searchInfo: { flex: 1 },
  titleSection: { marginBottom: 22, position: 'relative' as const, overflow: 'hidden' as const, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface },
  titleSectionWithSplash: { borderColor: 'transparent' },
  titleSectionInner: { padding: 14 },
  titleLabel: { marginTop: 12 },
  addCoverBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  addCoverBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
  splashScroll: { marginHorizontal: -14, marginTop: 10 },
  splashScrollContent: { paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' },
  splashOption: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 2, borderColor: Colors.border, paddingVertical: 8, paddingHorizontal: 16, marginRight: 10, backgroundColor: Colors.surface },
  splashOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  splashOptionImage: { padding: 0, overflow: 'hidden', width: 80 },
  splashThumb: { width: 80, height: 56, overflow: 'hidden', borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  splashOptionLabel: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary, marginTop: 4 },
  splashOptionText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  searchName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  searchUsername: { fontSize: 13, color: Colors.textSecondary },
  invitePool: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inviteChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.accentLight, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6, maxWidth: 130 },
  inviteChipName: { fontSize: 13, fontWeight: '600', color: Colors.primaryDark, flex: 1 },
  inviteEmailBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6, backgroundColor: Colors.accentLight, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed', paddingHorizontal: 14, paddingVertical: 12 },
  inviteEmailText: { flex: 1, fontSize: 14, color: Colors.primaryDark },
  bubble: { backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6 },
  bubbleText: { fontSize: 14, color: Colors.text },
});
