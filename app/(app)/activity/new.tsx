import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  TouchableOpacity, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, addHours, addMinutes } from 'date-fns';
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

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [splashArt, setSplashArt] = useState<SplashPreset | null>(null);
  const [showSplashPicker, setShowSplashPicker] = useState(false);
  const [showDetailsInput, setShowDetailsInput] = useState(false);
  const [activityTime, setActivityTime] = useState<Date>(addHours(new Date(), 2));
  const [quickHighlight, setQuickHighlight] = useState<'10min' | '1hour' | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time'>('date');

  const setQuickTime = (key: '10min' | '1hour', date: Date) => {
    setActivityTime(date);
    setQuickHighlight(key);
    setTimeout(() => setQuickHighlight(null), 700);
  };

  // Circles for quick-add
  const [circles, setCircles] = useState<Circle[]>([]);
  // Track which circle IDs have been expanded into the invite pool
  const [expandedCircleIds, setExpandedCircleIds] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    if (!user) return;
    supabase
      .from('circles')
      .select('id, name, emoji, description, created_by, created_at')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => setCircles((data ?? []) as Circle[]));
  }, [user]);

  // Expand or collapse a circle's members into/from the invite pool
  const toggleCircle = async (circle: Circle) => {
    if (expandedCircleIds.has(circle.id)) {
      setExpandedCircleIds(prev => { const s = new Set(prev); s.delete(circle.id); return s; });
      return;
    }

    const { data, error } = await supabase
      .from('circle_members')
      .select('user_id, profile:profiles(id, full_name, avatar_url)')
      .eq('circle_id', circle.id)
      .neq('user_id', user!.id);

    if (error) { Alert.alert('Error', 'Could not load circle members.'); return; }

    // Compute excluded set (may be stale in closure, so compute fresh)
    const excluded = new Set(excludeUserIds);
    if (excludeCircleIds.size > 0) {
      const { data: cmData } = await supabase.from('circle_members').select('user_id').in('circle_id', [...excludeCircleIds]);
      (cmData ?? []).forEach((m: { user_id: string }) => excluded.add(m.user_id));
    }

    setExpandedCircleIds(prev => new Set(prev).add(circle.id));
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
    setExcludeQuery('');
    setExcludeResults([]);
  };

  const addExclusionCircle = async (circle: Circle) => {
    setExcludeCircleIds(prev => new Set(prev).add(circle.id));
    const { data } = await supabase.from('circle_members').select('user_id').eq('circle_id', circle.id);
    const memberIds = new Set((data ?? []).map((m: { user_id: string }) => m.user_id));
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

  const removeExclusionCircle = (circleId: string) => {
    setExcludeCircleIds(prev => { const s = new Set(prev); s.delete(circleId); return s; });
  };

  const handleCreate = async () => {
    if (!user || title.trim().length < 2) return;
    try {
      setLoading(true);

      const activityId = Crypto.randomUUID();

      const { error: activityError } = await supabase.from('activities').insert({
        id: activityId,
        created_by: user.id,
        title: title.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        activity_time: activityTime.toISOString(),
        splash_art: splashArt,
      });
      if (activityError) throw activityError;

      // Filter invite pool: exclude users in excludeUserIds + members of excludeCircleIds
      const excluded = new Set(excludeUserIds);
      if (excludeCircleIds.size > 0) {
        const { data: cmData } = await supabase.from('circle_members').select('user_id').in('circle_id', [...excludeCircleIds]);
        (cmData ?? []).forEach((m: { user_id: string }) => excluded.add(m.user_id));
      }
      const finalInviteIds = [...invitePool.keys()].filter(uid => !excluded.has(uid));

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
      <ScreenHeader title="New Activity" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Title */}
        <View style={styles.section}>
          <Text style={styles.label}>What's happening? *</Text>
          <TextInput
            style={styles.input} value={title} onChangeText={setTitle}
            placeholder="e.g. Morning surf, Escape room…"
            placeholderTextColor={Colors.textSecondary} maxLength={80} autoFocus
          />
        </View>

        {/* Cover image (hidden until button tapped) */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.addCoverBtn}
            onPress={() => setShowSplashPicker(v => !v)}
          >
            <Ionicons name="image-outline" size={16} color={Colors.primary} />
            <Text style={styles.addCoverBtnText}>{splashArt ? 'Change cover image' : 'Add cover image'}</Text>
          </TouchableOpacity>
          {showSplashPicker && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.splashScroll} contentContainerStyle={styles.splashScrollContent}>
              <TouchableOpacity
                style={[styles.splashOption, !splashArt && styles.splashOptionActive]}
                onPress={() => setSplashArt(null)}
              >
                <Text style={styles.splashOptionText}>None</Text>
              </TouchableOpacity>
              {SPLASH_PRESETS.map(p => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.splashOption, styles.splashOptionImage, splashArt === p.id && styles.splashOptionActive]}
                  onPress={() => setSplashArt(p.id)}
                >
                  <View style={styles.splashThumb}>
                    <SplashArt preset={p.id} height={56} opacity={1} />
                  </View>
                  <Text style={styles.splashOptionLabel}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Date & Time */}
        <View style={styles.section}>
          <Text style={styles.label}>When? *</Text>
          <View style={styles.quickWhenRow}>
            <TouchableOpacity
              style={[styles.quickBtn, quickHighlight === '10min' && styles.quickBtnActive]}
              onPress={() => setQuickTime('10min', addMinutes(new Date(), 10))}
            >
              <Text style={[styles.quickBtnText, quickHighlight === '10min' && styles.quickBtnTextActive]}>+10 min</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickBtn, quickHighlight === '1hour' && styles.quickBtnActive]}
              onPress={() => setQuickTime('1hour', addHours(new Date(), 1))}
            >
              <Text style={[styles.quickBtnText, quickHighlight === '1hour' && styles.quickBtnTextActive]}>+1 hour</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.datetimeRow, { marginTop: 10 }]}>
              <TouchableOpacity
                style={[styles.datetimeBtn, { flex: 2 }, !!quickHighlight && styles.datetimeBtnHighlight]}
                onPress={() => { setPickerMode('date'); setShowPicker(true); }}
              >
                <Ionicons name="calendar-outline" size={18} color={quickHighlight ? Colors.primary : Colors.primary} />
                <Text style={styles.datetimeText}>{format(activityTime, 'EEE, MMM d')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.datetimeBtn, { flex: 1 }, !!quickHighlight && styles.datetimeBtnHighlight]}
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
          <Text style={styles.label}>Where? (optional)</Text>
          <LocationAutocomplete
            value={parseLocation(location)?.address ?? location ?? ''}
            onChangeText={(text) => setLocation(text)}
            onResolvedPlace={(p) => setLocation(buildLocationWithPlace(p.address, p.placeId, p.displayName))}
            placeholder="Venue, address, or link…"
            maxLength={150}
          />
        </View>

        {/* Details (hidden until button tapped) */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.addCoverBtn}
            onPress={() => setShowDetailsInput(v => !v)}
          >
            <Ionicons name="document-text-outline" size={16} color={Colors.primary} />
            <Text style={styles.addCoverBtnText}>{description.trim() ? 'Change details' : 'Add details'}</Text>
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

        {/* Invite via Circles */}
        <View style={styles.section}>
          <Text style={styles.label}>Invite via Circle</Text>
          {circles.length === 0 ? (
            <TouchableOpacity style={styles.emptyCircles} onPress={() => router.push('/(app)/circle/new')}>
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
          <View style={styles.labelRow}>
            <Text style={styles.label}>Invite individuals</Text>
            <TouchableOpacity
              style={[styles.excludeBtn, showExclude && styles.excludeBtnActive]}
              onPress={() => { setShowExclude(v => !v); setExcludeQuery(''); setExcludeResults([]); }}
            >
              <Ionicons name={showExclude ? 'chevron-up' : 'remove-circle-outline'} size={14} color={showExclude ? Colors.textSecondary : Colors.primary} />
              <Text style={[styles.excludeBtnText, showExclude && { color: Colors.textSecondary }]}>Exclude</Text>
            </TouchableOpacity>
          </View>
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
          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
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
              <Text style={styles.excludeHint}>Excluded users and circles will not be invited.</Text>
              {circles.length > 0 && (
                <View style={styles.excludeCirclesRow}>
                  <Text style={styles.excludeSubLabel}>Exclude circle</Text>
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
              <Text style={styles.excludeSubLabel}>Exclude individual</Text>
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

        <Button
          label="Post Activity 🚀"
          onPress={handleCreate}
          loading={loading}
          disabled={title.trim().length < 2}
        />
      </ScrollView>
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
  excludeSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  excludeHint: { fontSize: 13, color: Colors.textSecondary, marginBottom: 10 },
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
  quickWhenRow: { flexDirection: 'row', gap: 8 },
  quickBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 8 },
  quickBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  quickBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  quickBtnTextActive: { color: Colors.primary },
  datetimeRow: { flexDirection: 'row', gap: 10 },
  datetimeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12 },
  datetimeBtnHighlight: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
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
  searchInfo: { flex: 1 },
  addCoverBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  addCoverBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
  splashScroll: { marginHorizontal: -20, marginTop: 10 },
  splashScrollContent: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center' },
  splashOption: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 2, borderColor: Colors.border, paddingVertical: 8, paddingHorizontal: 16, marginRight: 10 },
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
});
