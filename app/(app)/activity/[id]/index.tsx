import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl,
  TextInput, ActivityIndicator, Linking, Platform, KeyboardAvoidingView, BackHandler, Keyboard,
  Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, isToday, isTomorrow, isPast, addHours, addMinutes } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Activity, Profile, Rsvp, EditableFields } from '@/lib/types';
import { postEditSystemMessage } from '@/lib/postEditSystemMessage';
import { postEditSuggestionMessage } from '@/lib/postEditSuggestionMessage';
import { postRsvpChangeMessage } from '@/lib/postRsvpChangeMessage';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ActivityUpdatesFeed } from '@/components/ActivityUpdatesFeed';
import { LocationAutocomplete } from '@/components/LocationAutocomplete';
import { LocationDisplay } from '@/components/LocationDisplay';
import { SplashArt } from '@/components/SplashArt';
import { SPLASH_PRESETS, type SplashPreset } from '@/lib/splashArt';
import { parseLocation, buildLocationWithPlace } from '@/lib/locationUtils';
import Colors from '@/constants/Colors';

export default function ActivityDetailScreen() {
  const { id, edit, fromTab } = useLocalSearchParams<{ id: string; edit?: string; fromTab?: string }>();
  const { user, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  const [hasUnread, setHasUnread] = useState(false);

  // Invite-edit state
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<Profile[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addLoading, setAddLoading] = useState<string | null>(null);

  // Activity edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editTime, setEditTime] = useState(new Date());
  const [editSplashArt, setEditSplashArt] = useState<SplashPreset | null>(null);
  const [showEditSplashPicker, setShowEditSplashPicker] = useState(false);
  const [showEditDetailsInput, setShowEditDetailsInput] = useState(false);
  const [showEditPicker, setShowEditPicker] = useState(false);
  const [editPickerMode, setEditPickerMode] = useState<'date' | 'time'>('date');
  const [editQuickHighlight, setEditQuickHighlight] = useState<'10min' | '1hour' | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);

  // Menu / clone state
  const [showMenu, setShowMenu] = useState(false);
  const [cloneLoading, setCloneLoading] = useState(false);
  // Tracks whether we should enter edit mode on the next successful fetch.
  // Reset whenever id/edit params change so it works even when the component
  // is reused across navigations by Expo Router.
  const editOnLoad = useRef(false);
  useEffect(() => { editOnLoad.current = edit === '1'; }, [id, edit]);

  // Edit suggestion state (invited users)
  const [showSuggestionModal, setShowSuggestionModal] = useState(false);
  const [suggestTime, setSuggestTime] = useState<Date | null>(null);
  const [suggestLocation, setSuggestLocation] = useState('');
  const [suggestNote, setSuggestNote] = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestPickerMode, setSuggestPickerMode] = useState<'date' | 'time'>('date');
  const [showSuggestPicker, setShowSuggestPicker] = useState(false);

  // Maybe RSVP state
  const [maybeNote, setMaybeNote] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteDirty, setNoteDirty] = useState(false);
  const lastSavedNote = useRef<string>('');

  const isCreator = activity?.created_by === user?.id;

  const fetchActivity = useCallback(async () => {
    if (!id || !user) return;
    setFetchError(null);
    const { data, error } = await supabase.from('activities').select(`
      *,
      host:profiles!activities_created_by_fkey(id, full_name, avatar_url),
      rsvps(*, profile:profiles(id, full_name, avatar_url))
    `).eq('id', id).single();

    if (error) {
      console.error('[Activity] fetch error:', error.message);
      setFetchError(error.message);
      return;
    }
    if (data) {
      const act = {
        ...data,
        my_rsvp: (data.rsvps as Rsvp[])?.find(r => r.user_id === user.id) ?? null,
        going_count: (data.rsvps as Rsvp[])?.filter(r => r.status === 'in').length ?? 0,
      } as Activity;
      setActivity(act);
      // Mark this activity as seen (clears "new", "new messages", and RSVP changes from updates feed)
      const now = new Date().toISOString();
      AsyncStorage.setItem(`miba_activity_last_seen_${id}`, now).catch(() => {});
      AsyncStorage.setItem(`miba_chat_last_read_${id}`, now).catch(() => {});
      AsyncStorage.setItem(`miba_rsvp_changes_seen_${id}`, now).catch(() => {});

      // Auto-enter edit mode when cloned (navigated with ?edit=1)
      if (editOnLoad.current) {
        editOnLoad.current = false;
        setEditTitle(act.title);
        setEditDesc(act.description ?? '');
        setEditLocation(act.location ?? '');
        setEditTime(new Date(act.activity_time));
        setEditSplashArt(act.splash_art ?? null);
        setIsEditing(true);
      }
    }
  }, [id, user]);

  useEffect(() => { setLoading(true); fetchActivity().finally(() => setLoading(false)); }, [fetchActivity]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchActivity(); setRefreshing(false); }, [fetchActivity]);

  // Bug fix: reset edit mode when navigating to a different activity
  useEffect(() => { setIsEditing(false); setEditSplashArt(null); setShowEditSplashPicker(false); setShowEditDetailsInput(false); }, [id]);
  useEffect(() => { if (!isEditing) setShowEditSplashPicker(false); setShowEditDetailsInput(false); }, [isEditing]);

  const checkUnread = useCallback(async () => {
    if (!id || !user) return;
    try {
      const stored = await AsyncStorage.getItem(`miba_chat_last_read_${id}`);
      const since = stored ?? '1970-01-01T00:00:00Z';
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('activity_id', id)
        .neq('user_id', user.id)
        .gt('created_at', since);
      setHasUnread((count ?? 0) > 0);
    } catch {
      // non-critical — silently ignore
    }
  }, [id, user]);

  useFocusEffect(useCallback(() => { checkUnread(); }, [checkUnread]));

  const handleBack = useCallback(() => {
    if (fromTab === 'declined' && activity?.my_rsvp && (activity.my_rsvp.status === 'in' || activity.my_rsvp.status === 'maybe')) {
      router.replace('/(app)/events?tab=upcoming');
      return;
    }
    // Navigate explicitly to the tab we came from (avoids router.back() always going to Updates)
    const tab = typeof fromTab === 'string' ? fromTab : undefined;
    if (tab === 'updates') {
      router.replace('/(app)');
    } else if (tab === 'circles') {
      router.replace('/(app)/circles');
    } else if (tab === 'upcoming' || tab === 'invited' || tab === 'past' || tab === 'declined') {
      router.replace(`/(app)/events?tab=${tab}`);
    } else {
      router.back();
    }
  }, [fromTab, activity?.my_rsvp?.status, router]);

  // Android back button: exit edit mode when editing, otherwise use handleBack
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isEditing) {
        setIsEditing(false);
        return true;
      }
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [isEditing, handleBack]);

  const handleRsvp = async (status: 'in' | 'out') => {
    if (!user || !activity) return;
    const isCreator = activity.created_by === user.id;

    // Host declining: show delete confirmation dialog
    if (status === 'out' && isCreator) {
      const existing = activity.my_rsvp;
      const alreadyOut = existing?.status === 'out';
      if (!alreadyOut) {
        Alert.alert(
          "You're declining this event",
          'Would you like to delete the activity instead?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Just decline', onPress: () => performRsvpUpdate('out') },
            { text: 'Delete event', style: 'destructive', onPress: async () => {
              await supabase.from('activities').update({ status: 'cancelled' }).eq('id', activity.id);
              fetchActivity();
            }},
          ]
        );
        return;
      }
    }

    await performRsvpUpdate(status);
  };

  const performRsvpUpdate = async (status: 'in' | 'out') => {
    if (!user || !activity) return;
    try {
      setRsvpLoading(true);
      Haptics.impactAsync(status === 'in' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      const existing = activity.my_rsvp;
      const oldStatus = existing?.status ?? 'pending';
      const isCreator = activity.created_by === user.id;
      const dbStatus = status;
      const isAlreadySelected = status === 'in' ? existing?.status === 'in' : existing?.status === 'out';
      let newStatus: 'pending' | 'in' | 'out' = dbStatus;

      if (existing) {
        if (isAlreadySelected) {
          await supabase.from('rsvps').update({ status: 'pending' }).eq('id', existing.id);
          newStatus = 'pending';
        } else {
          await supabase.from('rsvps').update({ status: dbStatus }).eq('id', existing.id);
        }
      } else {
        await supabase.from('rsvps').insert({ activity_id: activity.id, user_id: user.id, status: dbStatus });
      }
      if (oldStatus !== newStatus) {
        postRsvpChangeMessage(activity.id, user.id, oldStatus, newStatus).catch(() => {});
      }
      await fetchActivity();
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Could not update RSVP.');
    } finally {
      setRsvpLoading(false);
    }
  };

  // Resolved excluded user IDs (explicit + from excluded circles)
  const handleAddSearch = async (text: string) => {
    setAddQuery(text);
    if (text.trim().length < 2) { setAddResults([]); return; }
    setAddSearching(true);
    const alreadyInvited = new Set((activity?.rsvps ?? []).map(r => r.user_id));
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, username, created_at, updated_at')
      .or(`full_name.ilike.%${text.trim()}%,username.ilike.%${text.trim()}%`)
      .neq('id', user!.id)
      .limit(20);
    setAddResults(((data ?? []) as Profile[]).filter(p => !alreadyInvited.has(p.id)));
    setAddSearching(false);
  };


  const handleAddInvitee = async (profile: Profile) => {
    if (!activity) return;
    try {
      setAddLoading(profile.id);
      const { error } = await supabase.from('rsvps').insert({
        activity_id: activity.id,
        user_id: profile.id,
        status: 'pending',
      });
      if (error) throw error;
      setAddQuery('');
      setAddResults([]);
      await fetchActivity();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not add invitee.');
    } finally {
      setAddLoading(null);
    }
  };

  const handleRemoveInvitee = (rsvp: Rsvp) => {
    if (!isCreator || rsvp.user_id === user?.id) return;
    const name = rsvp.profile?.full_name ?? 'this person';
    Alert.alert('Remove invitee', `Remove ${name} from this activity?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('rsvps').delete().eq('id', rsvp.id);
        if (error) {
          Alert.alert('Could not remove', error.message ?? 'Please try again.');
          return;
        }
        await fetchActivity();
      }},
    ]);
  };

  const handleCancel = () => Alert.alert('Delete Activity', 'This will cancel the activity for everyone. Continue?', [
    { text: 'No', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      await supabase.from('activities').update({ status: 'cancelled' }).eq('id', id);
      fetchActivity();
    }},
  ]);

  const handleClone = async () => {
    if (!activity || !user) return;
    try {
      setCloneLoading(true);
      const newTime = addMinutes(new Date(), 10).toISOString();
      const { data: newActivity, error } = await supabase
        .from('activities')
        .insert({
          title: activity.title,
          description: activity.description,
          location: activity.location,
          activity_time: newTime,
          created_by: user.id,
          splash_art: activity.splash_art,
        })
        .select('id')
        .single();
      if (error || !newActivity) throw error ?? new Error('Clone failed');

      const rsvpsToClone = (activity.rsvps ?? []).map(r => ({
        activity_id: newActivity.id,
        user_id: r.user_id,
        status: r.user_id === user.id ? 'in' : 'pending',
      }));
      if (rsvpsToClone.length > 0) {
        await supabase.from('rsvps').insert(rsvpsToClone);
      }
      router.push(`/(app)/activity/${newActivity.id}?edit=1`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not clone activity.');
    } finally {
      setCloneLoading(false);
    }
  };

  const startEditing = () => {
    if (!activity) return;
    setEditTitle(activity.title);
    setEditDesc(activity.description ?? '');
    setEditLocation(activity.location ?? '');
    setEditTime(new Date(activity.activity_time));
    setEditSplashArt(activity.splash_art ?? null);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!activity || editTitle.trim().length < 2) return;
    try {
      setSaveLoading(true);

      const oldValues: EditableFields = {
        title: activity.title,
        description: activity.description,
        location: activity.location,
        activity_time: activity.activity_time,
        splash_art: activity.splash_art ?? undefined,
      };
      const newValues: EditableFields = {
        title: editTitle.trim(),
        description: editDesc.trim() || null,
        location: editLocation.trim() || null,
        activity_time: editTime.toISOString(),
        splash_art: editSplashArt,
      };

      const { error } = await supabase.from('activities').update(newValues).eq('id', activity.id);
      if (error) throw error;

      setIsEditing(false);
      await fetchActivity();

      if (user) {
        await postEditSystemMessage(activity.id, user.id, oldValues, newValues);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save changes.');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleMaybeRsvp = async () => {
    if (!user || !activity) return;
    try {
      setRsvpLoading(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const existing = activity.my_rsvp;
      const oldStatus = (existing?.status ?? 'pending') as 'pending' | 'in' | 'out' | 'maybe';
      if (existing) {
        await supabase.from('rsvps').update({ status: 'maybe' }).eq('id', existing.id);
      } else {
        await supabase.from('rsvps').insert({ activity_id: activity.id, user_id: user.id, status: 'maybe' });
      }
      if (oldStatus !== 'maybe') {
        postRsvpChangeMessage(activity.id, user.id, oldStatus, 'maybe').catch(() => {});
      }
      await fetchActivity();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not update RSVP.');
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleSaveNote = async () => {
    if (!activity?.my_rsvp) return;
    const trimmed = maybeNote.trim();
    if (trimmed === lastSavedNote.current) return;
    try {
      setNoteLoading(true);
      await supabase.from('rsvps').update({ note: trimmed || null }).eq('id', activity.my_rsvp.id);
      lastSavedNote.current = trimmed;
      setNoteDirty(false);
      Keyboard.dismiss();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save note.');
    } finally {
      setNoteLoading(false);
    }
  };

  const handleSubmitSuggestion = async () => {
    if (!activity || !user) return;
    const note = suggestNote.trim();
    if (!note) {
      Alert.alert('Note required', 'Please add a note explaining your suggestion.');
      return;
    }
    if (!suggestTime && !suggestLocation.trim()) {
      Alert.alert('Suggestion required', 'Please suggest a different time and/or location.');
      return;
    }
    try {
      setSuggestLoading(true);
      await postEditSuggestionMessage(activity.id, user.id, {
        suggested_time: suggestTime?.toISOString() ?? null,
        suggested_location: suggestLocation.trim() || null,
        note,
      });
      setShowSuggestionModal(false);
      setSuggestTime(null);
      setSuggestLocation('');
      setSuggestNote('');
      await fetchActivity();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not post suggestion.');
    } finally {
      setSuggestLoading(false);
    }
  };

  const openSuggestionModal = () => {
    setSuggestTime(new Date(activity!.activity_time));
    setSuggestLocation(activity!.location ?? '');
    setSuggestNote('');
    setShowSuggestionModal(true);
  };

  // Sync note field when rsvp first loads
  useEffect(() => {
    const note = activity?.my_rsvp?.note ?? '';
    setMaybeNote(note);
    setNoteDirty(false);
    lastSavedNote.current = note;
  }, [activity?.my_rsvp?.id]);

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Activity" showBack />
        <View style={styles.center}><Text style={styles.loadingText}>Loading…</Text></View>
      </View>
    );
  }

  if (fetchError || !activity) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Activity" showBack />
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={40} color={Colors.danger} />
          <Text style={[styles.loadingText, { marginTop: 10, color: Colors.danger }]}>
            {fetchError ?? 'Activity not found.'}
          </Text>
          <TouchableOpacity onPress={() => { setLoading(true); fetchActivity().finally(() => setLoading(false)); }} style={{ marginTop: 16 }}>
            <Text style={{ color: Colors.primary, fontWeight: '600' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const activityDate = new Date(activity.activity_time);
  const past = isPast(activityDate);
  const myRsvp = activity.my_rsvp;

  const dateLabel = isToday(activityDate) ? `Today at ${format(activityDate, 'h:mm a')}`
    : isTomorrow(activityDate) ? `Tomorrow at ${format(activityDate, 'h:mm a')}`
    : format(activityDate, 'EEEE, MMMM d · h:mm a');

  const hostId = activity.created_by;
  const hostRsvp = activity.rsvps?.find(r => r.user_id === hostId) ?? null;
  const withoutHost = (rsvps: Rsvp[]) => rsvps.filter(r => r.user_id !== hostId);

  // Split invitees by status; host is rendered first separately
  const going = withoutHost(activity.rsvps?.filter(r => r.status === 'in') ?? []);
  const maybe = withoutHost(activity.rsvps?.filter(r => r.status === 'maybe') ?? []);
  const notGoing = withoutHost(activity.rsvps?.filter(r => r.status === 'out') ?? []);
  const pending = withoutHost(activity.rsvps?.filter(r => r.status === 'pending') ?? []);

  const isHebrew = (s: string) => /[\u0590-\u05FF]/.test(s);

  const headerActions = [
    { icon: 'chatbubble-ellipses-outline' as const, onPress: () => router.push(`/(app)/activity/${id}/chat`), badge: hasUnread },
    ...(isCreator && activity.status === 'active' && !isEditing
      ? [{ icon: 'ellipsis-vertical' as const, onPress: () => setShowMenu(true) }]
      : []),
  ];

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader title="" showBack onBack={isEditing ? () => setIsEditing(false) : handleBack} rightActions={headerActions} />
      {/* Fixed title — does not scroll */}
      <View style={[styles.titleSection, (activity.splash_art || (isEditing && editSplashArt)) && styles.titleSectionWithSplash]}>
        {(activity.splash_art && !isEditing) || (isEditing && editSplashArt) ? (
          <View style={styles.splashBackground}>
            <SplashArt preset={isEditing ? editSplashArt! : activity.splash_art!} height={105} opacity={0.4} />
          </View>
        ) : null}
        <View style={styles.titleSectionOverlay}>
        {isEditing ? (
          <>
            <TouchableOpacity
              style={[styles.addCoverBtn, editSplashArt && styles.addCoverBtnOnImage]}
              onPress={() => setShowEditSplashPicker(v => !v)}
            >
              <Ionicons name="image-outline" size={16} color={editSplashArt ? '#fff' : Colors.primary} />
              <Text style={[styles.addCoverBtnText, editSplashArt && styles.addCoverBtnTextOnImage]}>{editSplashArt ? 'Change cover image' : 'Add cover image'}</Text>
            </TouchableOpacity>
            {showEditSplashPicker && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.splashPickerContent, { marginTop: 10 }]}>
                <TouchableOpacity
                  style={[styles.splashPickerOption, !editSplashArt && styles.splashPickerOptionActive]}
                  onPress={() => { setEditSplashArt(null); setShowEditSplashPicker(false); }}
                >
                  <Text style={styles.splashPickerOptionText}>None</Text>
                </TouchableOpacity>
                {SPLASH_PRESETS.map(p => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.splashPickerOption, styles.splashPickerOptionImg, editSplashArt === p.id && styles.splashPickerOptionActive]}
                    onPress={() => { setEditSplashArt(p.id); setShowEditSplashPicker(false); }}
                  >
                    <View style={styles.splashPickerThumb}>
                      <SplashArt preset={p.id} height={48} opacity={1} />
                    </View>
                    <Text style={styles.splashPickerOptionLabel}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            <TextInput
              style={[styles.titleInput, isHebrew(editTitle) && styles.titleRtl]}
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Activity title…"
              placeholderTextColor={Colors.textSecondary}
              maxLength={80}
              autoFocus
            />
          </>
        ) : (
          <Text style={[styles.title, past && styles.titlePast, isHebrew(activity.title) && styles.titleRtl]}>{activity.title}</Text>
        )}
        {activity.status === 'cancelled' && (
          <View style={styles.cancelBanner}>
            <Ionicons name="close-circle" size={16} color={Colors.danger} />
            <Text style={styles.cancelText}>This activity has been cancelled</Text>
          </View>
        )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Meta card */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.metaIcon}><Ionicons name="calendar" size={20} color={Colors.primary} /></View>
            {isEditing ? (
              <View style={{ flex: 1 }}>
                <View style={styles.editQuickRow}>
                  <TouchableOpacity style={[styles.editQuickBtn, editQuickHighlight === '10min' && styles.editQuickBtnActive]} onPress={() => { setEditTime(addMinutes(new Date(), 10)); setEditQuickHighlight('10min'); setTimeout(() => setEditQuickHighlight(null), 700); }}>
                    <Text style={[styles.editQuickBtnText, editQuickHighlight === '10min' && styles.editQuickBtnTextActive]}>+10 min</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.editQuickBtn, editQuickHighlight === '1hour' && styles.editQuickBtnActive]} onPress={() => { setEditTime(addHours(new Date(), 1)); setEditQuickHighlight('1hour'); setTimeout(() => setEditQuickHighlight(null), 700); }}>
                    <Text style={[styles.editQuickBtnText, editQuickHighlight === '1hour' && styles.editQuickBtnTextActive]}>+1 hour</Text>
                  </TouchableOpacity>
                </View>
                <View style={[styles.editDatetimeRow, { marginTop: 8 }]}>
                  <TouchableOpacity style={[styles.editDatetimeBtn, { flex: 2 }, !!editQuickHighlight && styles.editDatetimeBtnHighlight]} onPress={() => { setEditPickerMode('date'); setShowEditPicker(true); }}>
                    <Ionicons name="calendar-outline" size={15} color={Colors.primary} />
                    <Text style={styles.editDatetimeText}>{format(editTime, 'EEE, MMM d')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.editDatetimeBtn, { flex: 1 }, !!editQuickHighlight && styles.editDatetimeBtnHighlight]} onPress={() => { setEditPickerMode('time'); setShowEditPicker(true); }}>
                    <Ionicons name="time-outline" size={15} color={Colors.primary} />
                    <Text style={styles.editDatetimeText}>{format(editTime, 'h:mm a')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View><Text style={styles.metaLabel}>When</Text><Text style={styles.metaValue}>{dateLabel}</Text></View>
            )}
          </View>
          <View style={styles.metaRow}>
            <View style={styles.metaIcon}><Ionicons name="location" size={20} color={Colors.primary} /></View>
            {isEditing ? (
              <View style={{ flex: 1 }}>
                <LocationAutocomplete
                  value={parseLocation(editLocation)?.address ?? editLocation ?? ''}
                  onChangeText={(text) => setEditLocation(text)}
                  onResolvedPlace={(p) => setEditLocation(buildLocationWithPlace(p.address, p.placeId, p.displayName))}
                  placeholder="Where? (optional)"
                  maxLength={150}
                  showIcon={false}
                  style={{ marginBottom: 0 }}
                />
              </View>
            ) : activity.location ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.metaLabel}>Where</Text>
                <LocationDisplay location={activity.location} variant="detail" showIcon={false} />
              </View>
            ) : null}
          </View>
          {!past && activity.status === 'active' && !isEditing && !isCreator && (
            <TouchableOpacity style={styles.suggestBtn} onPress={openSuggestionModal}>
              <Ionicons name="create-outline" size={16} color={Colors.primary} />
              <Text style={styles.suggestBtnText}>Suggest different time or location</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* DateTimePicker for edit mode */}
        {isEditing && showEditPicker && (
          <DateTimePicker
            value={editTime} mode={editPickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onChange={(_, date) => { setShowEditPicker(false); if (date) setEditTime(date); }}
          />
        )}

        {/* Description (edit: hidden until button tapped) */}
        {isEditing ? (
          <View style={styles.editSection}>
            <TouchableOpacity
              style={styles.addCoverBtn}
              onPress={() => setShowEditDetailsInput(v => !v)}
            >
              <Ionicons name="document-text-outline" size={16} color={Colors.primary} />
              <Text style={styles.addCoverBtnText}>{editDesc.trim() ? 'Change details' : 'Add details'}</Text>
            </TouchableOpacity>
            {showEditDetailsInput && (
              <TextInput
                style={[styles.editInput, styles.editTextArea, { marginTop: 10 }]}
                value={editDesc}
                onChangeText={setEditDesc}
                placeholder="Any extra info…"
                placeholderTextColor={Colors.textSecondary}
                maxLength={300}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />
            )}
          </View>
        ) : activity.description ? (
          <View style={styles.descCard}><Text style={styles.descText}>{activity.description}</Text></View>
        ) : null}


        {/* RSVP section */}
        {!past && activity.status === 'active' && !isEditing && (
          <View style={styles.rsvpSection}>
            <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>Are you joining?</Text>
                <View style={styles.rsvpButtons}>
                  {/* I'm in */}
                  <TouchableOpacity
                    style={[styles.rsvpBtn, myRsvp?.status === 'in' && styles.rsvpBtnInActive]}
                    onPress={() => { handleRsvp('in'); }}
                    disabled={rsvpLoading}
                    activeOpacity={0.85}
                  >
                    {myRsvp?.status === 'in' && (
                      <LinearGradient colors={['#16A34A', '#22C55E']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFillObject} />
                    )}
                    <Ionicons name={myRsvp?.status === 'in' ? 'checkmark-circle' : 'checkmark-circle-outline'} size={20} color={myRsvp?.status === 'in' ? '#fff' : Colors.success} />
                    <Text style={[styles.rsvpBtnText, myRsvp?.status === 'in' && styles.rsvpBtnTextActive]}>
                      {myRsvp?.status === 'in' ? "I'm in!" : "I'm in"}
                    </Text>
                  </TouchableOpacity>

                  {/* Maybe */}
                  <TouchableOpacity
                    style={[styles.rsvpBtn, myRsvp?.status === 'maybe' && styles.rsvpBtnMaybeActive]}
                    onPress={async () => {
                      if (myRsvp?.status === 'maybe') {
                        setRsvpLoading(true);
                        try { await supabase.from('rsvps').update({ status: 'pending' }).eq('id', myRsvp.id); await fetchActivity(); }
                        catch (e: any) { Alert.alert('Error', e.message); }
                        finally { setRsvpLoading(false); }
                      } else {
                        handleMaybeRsvp();
                      }
                    }}
                    disabled={rsvpLoading}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={myRsvp?.status === 'maybe' ? 'help-circle' : 'help-circle-outline'} size={20} color={Colors.warning} />
                    <Text style={[styles.rsvpBtnText, { color: Colors.warning }]}>Maybe</Text>
                  </TouchableOpacity>

                  {/* Can't go */}
                  <TouchableOpacity
                    style={[styles.rsvpBtn, myRsvp?.status === 'out' && styles.rsvpBtnOutActive]}
                    onPress={() => { handleRsvp('out'); }}
                    disabled={rsvpLoading}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="close-circle-outline" size={20} color={myRsvp?.status === 'out' ? Colors.danger : Colors.textSecondary} />
                    <Text style={[styles.rsvpBtnText, myRsvp?.status === 'out' && { color: Colors.danger }]}>Can't go</Text>
                  </TouchableOpacity>
                </View>

                {/* Note / conditions input — shown when status is maybe */}
                {myRsvp?.status === 'maybe' && (
                  <View style={styles.noteCard}>
                    <View style={styles.noteCardHeader}>
                      <Ionicons name="document-text-outline" size={15} color={Colors.primary} />
                      <Text style={styles.noteCardTitle}>Why maybe?</Text>
                      {noteLoading
                        ? <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 6 }} />
                        : noteDirty && (
                          <TouchableOpacity onPress={handleSaveNote} style={styles.noteSaveBtn}>
                            <Text style={styles.noteSaveBtnText}>Save</Text>
                          </TouchableOpacity>
                        )
                      }
                    </View>
                    <TextInput
                      style={styles.noteInput}
                      value={maybeNote}
                      onChangeText={text => { setMaybeNote(text); setNoteDirty(text.trim() !== lastSavedNote.current.trim()); }}
                      placeholder="e.g. need a ride, need to check something…"
                      placeholderTextColor={Colors.textSecondary}
                      multiline
                      textAlignVertical="top"
                    />
                  </View>
                )}
          </View>
        )}

        {/* Unified invitees list */}
        <View style={styles.attendeesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Invited · {(activity.rsvps ?? []).length}
            </Text>
            {isCreator && activity.status === 'active' && !past && (
              <TouchableOpacity
                style={[styles.addInviteBtn, showAddSearch && styles.addInviteBtnActive]}
                onPress={() => { setShowAddSearch(v => !v); setAddQuery(''); setAddResults([]); }}
              >
                <Ionicons name={showAddSearch ? 'close' : 'person-add-outline'} size={16} color={showAddSearch ? Colors.textSecondary : Colors.primary} />
                <Text style={[styles.addInviteBtnText, showAddSearch && { color: Colors.textSecondary }]}>
                  {showAddSearch ? 'Done' : 'Add'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Inline add-invitee search */}
          {showAddSearch && (
            <View style={styles.addSearchSection}>
              <View style={styles.addSearchBox}>
                <Ionicons name="search" size={16} color={Colors.textSecondary} />
                <TextInput
                  style={styles.addSearchInput}
                  value={addQuery}
                  onChangeText={handleAddSearch}
                  placeholder="Search by name or username…"
                  placeholderTextColor={Colors.textSecondary}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {addSearching
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : addQuery.length > 0 && (
                    <TouchableOpacity onPress={() => { setAddQuery(''); setAddResults([]); }}>
                      <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  )
                }
              </View>
              {addResults.length > 0 && (
                <View style={styles.addResultsList}>
                  {addResults.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.addResultRow}
                      onPress={() => handleAddInvitee(p)}
                      disabled={addLoading === p.id}
                    >
                      <Avatar uri={p.avatar_url} name={p.full_name} size={36} />
                      <View style={styles.addResultInfo}>
                        <Text style={styles.addResultName}>{p.full_name ?? 'Unknown'}</Text>
                        {p.username && <Text style={styles.addResultUsername}>@{p.username}</Text>}
                      </View>
                      {addLoading === p.id
                        ? <ActivityIndicator size="small" color={Colors.primary} />
                        : <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
                      }
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {addQuery.length >= 2 && !addSearching && addResults.length === 0 && (
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addQuery.trim()) ? (
                  <TouchableOpacity
                    style={styles.inviteEmailBtn}
                    onPress={() => {
                      const email = addQuery.trim();
                      const name = profile?.full_name ?? 'A friend';
                      const subject = encodeURIComponent('Join me on Miba!');
                      const body = encodeURIComponent(
                        `Hey!\n\n${name} is inviting you to join Miba — an app for organising hangouts with friends.\n\nDownload it and we can start planning!\n\nhttps://miba.app\n\n— ${name}`
                      );
                      Linking.openURL(`mailto:${email}?subject=${subject}&body=${body}`);
                    }}
                  >
                    <Ionicons name="mail-outline" size={18} color={Colors.primary} />
                    <Text style={styles.inviteEmailText}>Invite <Text style={{ fontWeight: '700' }}>{addQuery.trim()}</Text> to Miba</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.addNoResults}>No users found for "{addQuery}"</Text>
                )
              )}
            </View>
          )}

          {(activity.rsvps ?? []).length === 0 ? (
            <Text style={styles.noAttendees}>No one invited yet.</Text>
          ) : (
            <View style={styles.attendeeList}>
              {/* Host always first */}
              {hostRsvp && (() => {
                const rsvp = hostRsvp;
                const isMe = rsvp.user_id === user?.id;
                const isHost = true;
                const canRemove = false;
                const status = rsvp.status;
                const rowOpacity = status === 'out' ? 0.6 : status === 'pending' ? 0.5 : 1;
                return (
                  <View key={rsvp.id} style={[styles.attendeeRow, { opacity: rowOpacity }]}>
                    <TouchableOpacity style={styles.attendeeRowMain} activeOpacity={1}>
                      <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                      {status === 'maybe' ? (
                        <View style={{ flex: 1 }}>
                          <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                          {(isMe ? maybeNote : (isCreator ? rsvp.note : null)) ? <Text style={styles.attendeeNote} numberOfLines={2}>{isMe ? maybeNote : rsvp.note}</Text> : null}
                        </View>
                      ) : (
                        <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                      )}
                      {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                      <View style={styles.hostBadge}><Text style={styles.hostText}>Host</Text></View>
                      {status === 'in' && <View style={styles.statusBadgeGoing}><Text style={styles.statusTextGoing}>Going</Text></View>}
                      {status === 'maybe' && <View style={styles.statusBadgeMaybe}><Text style={styles.statusTextMaybe}>Maybe</Text></View>}
                      {status === 'out' && <View style={styles.statusBadgeOut}><Text style={styles.statusTextOut}>Can't go</Text></View>}
                      {status === 'pending' && <View style={styles.statusBadgePending}><Text style={styles.statusTextPending}>Invited</Text></View>}
                    </TouchableOpacity>
                  </View>
                );
              })()}
              {going.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = rsvp.user_id === activity.created_by;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <View key={rsvp.id} style={styles.attendeeRow}>
                    <TouchableOpacity
                      style={styles.attendeeRowMain}
                      onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                      activeOpacity={canRemove ? 0.7 : 1}
                    >
                      <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                      <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                      {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                      {isHost && <View style={styles.hostBadge}><Text style={styles.hostText}>Host</Text></View>}
                      <View style={styles.statusBadgeGoing}><Text style={styles.statusTextGoing}>Going</Text></View>
                    </TouchableOpacity>
                    {canRemove && (
                      <TouchableOpacity style={styles.removeInviteeBtn} onPress={() => handleRemoveInvitee(rsvp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={24} color={Colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {maybe.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = rsvp.user_id === activity.created_by;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                const visibleNote = isMe ? (maybeNote || null) : (isCreator ? (rsvp.note ?? null) : null);
                return (
                  <View key={rsvp.id} style={styles.attendeeRow}>
                    <TouchableOpacity
                      style={styles.attendeeRowMain}
                      onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                      activeOpacity={canRemove ? 0.7 : 1}
                    >
                      <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                        {visibleNote ? <Text style={styles.attendeeNote} numberOfLines={2}>{visibleNote}</Text> : null}
                      </View>
                      {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                      {isHost && <View style={styles.hostBadge}><Text style={styles.hostText}>Host</Text></View>}
                      <View style={styles.statusBadgeMaybe}>
                        <Text style={styles.statusTextMaybe}>Maybe</Text>
                      </View>
                    </TouchableOpacity>
                    {canRemove && (
                      <TouchableOpacity style={styles.removeInviteeBtn} onPress={() => handleRemoveInvitee(rsvp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={24} color={Colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {notGoing.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = rsvp.user_id === activity.created_by;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <View key={rsvp.id} style={[styles.attendeeRow, { opacity: 0.6 }]}>
                    <TouchableOpacity
                      style={styles.attendeeRowMain}
                      onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                      activeOpacity={canRemove ? 0.7 : 1}
                    >
                      <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                      <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                      {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                      {isHost && <View style={styles.hostBadge}><Text style={styles.hostText}>Host</Text></View>}
                      <View style={styles.statusBadgeOut}><Text style={styles.statusTextOut}>Can't go</Text></View>
                    </TouchableOpacity>
                    {canRemove && (
                      <TouchableOpacity style={styles.removeInviteeBtn} onPress={() => handleRemoveInvitee(rsvp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={24} color={Colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {pending.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = rsvp.user_id === activity.created_by;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <View key={rsvp.id} style={[styles.attendeeRow, { opacity: 0.5 }]}>
                    <TouchableOpacity
                      style={styles.attendeeRowMain}
                      onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                      activeOpacity={canRemove ? 0.7 : 1}
                    >
                      <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                      <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                      {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                      {isHost && <View style={styles.hostBadge}><Text style={styles.hostText}>Host</Text></View>}
                      <View style={styles.statusBadgePending}><Text style={styles.statusTextPending}>Invited</Text></View>
                    </TouchableOpacity>
                    {canRemove && (
                      <TouchableOpacity
                        style={styles.removeInviteeBtn}
                        onPress={() => handleRemoveInvitee(rsvp)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={24} color={Colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}
        </View>

        {/* Updates feed */}
        {!isEditing && (
          <ActivityUpdatesFeed activityId={id} hostId={activity.created_by} />
        )}

        {/* Save — visible only while editing */}
        {isEditing && (
          <View style={styles.creatorFooter}>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnPrimary, (saveLoading || editTitle.trim().length < 2) && { opacity: 0.2 }]}
              onPress={handleSaveEdit}
              disabled={saveLoading || editTitle.trim().length < 2}
            >
              {saveLoading
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Text style={[styles.footerBtnText, { color: Colors.primary }]}>Save changes</Text>}
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* ⋮ dropdown menu */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={[styles.menuCard, { top: insets.top + 56 }]}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); startEditing(); }}>
              <Ionicons name="create-outline" size={18} color={Colors.text} />
              <Text style={styles.menuItemText}>Edit</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); handleClone(); }} disabled={cloneLoading}>
              {cloneLoading
                ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 18 }} />
                : <Ionicons name="copy-outline" size={18} color={Colors.text} />}
              <Text style={styles.menuItemText}>Clone</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); handleCancel(); }}>
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              <Text style={[styles.menuItemText, { color: Colors.danger }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Suggest time/location modal (invited users) */}
      <Modal visible={showSuggestionModal} transparent animationType="slide" onRequestClose={() => setShowSuggestionModal(false)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowSuggestionModal(false)} />
          <View style={[styles.suggestionModal, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.suggestionHandle} />
            <Text style={styles.suggestionTitle}>Suggest time or location</Text>
            <Text style={styles.suggestionSubtitle}>Your suggestion will appear in the feed for the host to see.</Text>

            <Text style={styles.suggestionLabel}>Suggested time (optional)</Text>
            <View style={styles.suggestionRow}>
              <TouchableOpacity style={styles.suggestionInput} onPress={() => { setSuggestPickerMode('date'); if (!suggestTime) setSuggestTime(new Date(activity.activity_time)); setShowSuggestPicker(true); }}>
                <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
                <Text style={styles.suggestionInputText}>{suggestTime ? format(suggestTime, 'EEE, MMM d') : 'Pick date'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.suggestionInput} onPress={() => { setSuggestPickerMode('time'); if (!suggestTime) setSuggestTime(new Date(activity.activity_time)); setShowSuggestPicker(true); }}>
                <Ionicons name="time-outline" size={18} color={Colors.primary} />
                <Text style={styles.suggestionInputText}>{suggestTime ? format(suggestTime, 'h:mm a') : 'Pick time'}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.suggestionClear} onPress={() => setSuggestTime(null)}>
              <Text style={styles.suggestionClearText}>Clear time</Text>
            </TouchableOpacity>

            <Text style={styles.suggestionLabel}>Suggested location (optional)</Text>
            <LocationAutocomplete
              value={parseLocation(suggestLocation)?.address ?? suggestLocation ?? ''}
              onChangeText={(text) => setSuggestLocation(text)}
              onResolvedPlace={(p) => setSuggestLocation(buildLocationWithPlace(p.address, p.placeId, p.displayName))}
              placeholder="e.g. Coffee shop downtown"
              maxLength={150}
              showIcon={false}
              style={{ marginBottom: 16 }}
              inputStyle={styles.suggestionTextInput}
            />

            <Text style={styles.suggestionLabel}>Note *</Text>
            <TextInput
              style={[styles.suggestionTextInput, styles.suggestionNoteInput]}
              value={suggestNote}
              onChangeText={setSuggestNote}
              placeholder="e.g. too early bro"
              placeholderTextColor={Colors.textSecondary}
              maxLength={200}
              multiline
            />

            <View style={styles.suggestionActions}>
              <TouchableOpacity style={styles.suggestionCancelBtn} onPress={() => setShowSuggestionModal(false)}>
                <Text style={styles.suggestionCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.suggestionSubmitBtn, (!suggestNote.trim() || (!suggestTime && !suggestLocation.trim())) && styles.suggestionSubmitDisabled]}
                onPress={handleSubmitSuggestion}
                disabled={suggestLoading || !suggestNote.trim() || (!suggestTime && !suggestLocation.trim())}
              >
                {suggestLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.suggestionSubmitText}>Post suggestion</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>

        {showSuggestPicker && (
          <DateTimePicker
            value={suggestTime ?? new Date(activity.activity_time)}
            mode={suggestPickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onChange={(_, date) => { setShowSuggestPicker(false); if (date) setSuggestTime(date); }}
          />
        )}
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  titleSection: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4, position: 'relative' as const },
  titleSectionWithSplash: { minHeight: 105, overflow: 'hidden' as const },
  splashBackground: { position: 'absolute' as const, top: 0, left: 20, right: 20, height: 105, overflow: 'hidden', borderRadius: 16 },
  titleSectionOverlay: { paddingTop: 8, paddingBottom: 4 },
  editSection: { marginBottom: 16 },
  editSectionLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  addCoverBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  addCoverBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
  addCoverBtnOnImage: {},
  addCoverBtnTextOnImage: { color: '#fff', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
  splashPickerContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  splashPickerOption: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 2, borderColor: Colors.border, paddingVertical: 8, paddingHorizontal: 16 },
  splashPickerOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  splashPickerOptionImg: { padding: 0, overflow: 'hidden', width: 64 },
  splashPickerThumb: { width: 64, height: 48, overflow: 'hidden', borderRadius: 10 },
  splashPickerOptionLabel: { fontSize: 10, fontWeight: '600', color: Colors.textSecondary, marginTop: 4 },
  splashPickerOptionText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  content: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, lineHeight: 34, marginBottom: 12, paddingVertical: 8, paddingHorizontal: 4 },
  titleRtl: { textAlign: 'right' },
  titlePast: { color: Colors.textSecondary },
  cancelBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.dangerLight, borderRadius: 12, padding: 12, marginBottom: 12 },
  cancelText: { fontSize: 14, color: Colors.danger, fontWeight: '600' },
  metaCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 12 },
  suggestBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingVertical: 8 },
  suggestBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  suggestionModal: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  suggestionHandle: { width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  suggestionTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  suggestionSubtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 20 },
  suggestionLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  suggestionRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  suggestionInput: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.background, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12 },
  suggestionInputText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  suggestionClear: { alignSelf: 'flex-start', marginBottom: 16 },
  suggestionClearText: { fontSize: 13, color: Colors.textSecondary },
  suggestionTextInput: { backgroundColor: Colors.background, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: Colors.text, marginBottom: 16 },
  suggestionNoteInput: { minHeight: 60, textAlignVertical: 'top' },
  suggestionActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  suggestionCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  suggestionCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  suggestionSubmitBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  suggestionSubmitDisabled: { opacity: 0.5 },
  suggestionSubmitText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  metaLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 15, color: Colors.text, fontWeight: '600', marginTop: 1 },
  descCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 12 },
  descText: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  rsvpSection: { marginVertical: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  rsvpButtons: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  rsvpBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, paddingVertical: 14, overflow: 'hidden' },
  rsvpBtnInActive: { borderColor: Colors.success },
  rsvpBtnOutActive: { borderColor: Colors.danger, backgroundColor: Colors.dangerLight },
  rsvpBtnMaybeActive: { borderColor: Colors.warning, backgroundColor: Colors.warningLight },
  rsvpGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 8 },
  rsvpBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  rsvpBtnTextActive: { fontSize: 15, fontWeight: '700', color: '#fff' },
  noteCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.borderLight, padding: 14, marginBottom: 16 },
  noteCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  noteCardTitle: { fontSize: 14, fontWeight: '600', color: Colors.primary, flex: 1 },
  noteInput: { fontSize: 14, color: Colors.text, lineHeight: 20, minHeight: 25 },
  noteSaveBtn: { marginLeft: 'auto', backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  noteSaveBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
  titleInput: { fontSize: 26, fontWeight: '800', color: Colors.text, lineHeight: 32, marginBottom: 12, borderBottomWidth: 2, borderBottomColor: Colors.primary, paddingBottom: 4 },
  creatorFooter: { flexDirection: 'row', gap: 10, marginTop: 8, marginBottom: 8 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  menuCard: {
    position: 'absolute', right: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight,
    minWidth: 180,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  menuItemText: { fontSize: 15, fontWeight: '500', color: Colors.text },
  menuDivider: { height: 1, backgroundColor: Colors.borderLight },
  footerBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 13, borderRadius: 14, borderWidth: 1.5,
  },
  footerBtnPrimary: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  footerBtnDanger: { borderColor: Colors.danger, backgroundColor: Colors.dangerLight },
  footerBtnText: { fontSize: 15, fontWeight: '600' },
  editQuickRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  editQuickBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.background, borderRadius: 16, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 5 },
  editQuickBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  editQuickBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  editQuickBtnTextActive: { color: Colors.primary },
  editDatetimeRow: { flexDirection: 'row', gap: 8 },
  editDatetimeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 8 },
  editDatetimeBtnHighlight: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  editDatetimeText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  editInlineInput: { flex: 1, fontSize: 15, color: Colors.text, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: 4 },
  editInput: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.text, marginBottom: 12 },
  editTextArea: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  attendeesSection: { marginTop: 8, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addInviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  addInviteBtnActive: { borderColor: Colors.border, backgroundColor: Colors.surface },
  addInviteBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  addSearchSection: { marginBottom: 12 },
  addSearchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 10, gap: 8, marginBottom: 6 },
  addSearchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 10 },
  addResultsList: { backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  addResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  addResultInfo: { flex: 1 },
  addResultName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  addResultUsername: { fontSize: 12, color: Colors.textSecondary },
  addNoResults: { fontSize: 13, color: Colors.textSecondary, paddingHorizontal: 4 },
  inviteEmailBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2, backgroundColor: Colors.accentLight, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed', paddingHorizontal: 12, paddingVertical: 10 },
  inviteEmailText: { flex: 1, fontSize: 13, color: Colors.primaryDark },
  noAttendees: { fontSize: 14, color: Colors.textSecondary },
  attendeeList: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  attendeeRowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  removeInviteeBtn: { padding: 4 },
  attendeeName: { flex: 1, fontSize: 15, fontWeight: '500', color: Colors.text },
  youBadge: { backgroundColor: Colors.accentLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  youText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  statusBadgeHosting: { backgroundColor: Colors.accentLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextHosting: { fontSize: 11, fontWeight: '600', color: Colors.primary },
  statusBadgeGoing: { backgroundColor: Colors.successLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextGoing: { fontSize: 11, fontWeight: '600', color: Colors.success },
  statusBadgeOut: { backgroundColor: Colors.dangerLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextOut: { fontSize: 11, fontWeight: '600', color: Colors.danger },
  statusBadgePending: { backgroundColor: Colors.borderLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextPending: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  statusBadgeMaybe: { backgroundColor: Colors.warningLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextMaybe: { fontSize: 11, fontWeight: '600', color: Colors.warning },
  hostBadge: { backgroundColor: '#FEFCE8', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  hostText: { fontSize: 12, color: '#CA8A04', fontWeight: '600' },
  attendeeNote: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
});
