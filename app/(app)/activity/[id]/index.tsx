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
import { Activity, Profile, Rsvp, NOW_SENTINEL, EditableFields } from '@/lib/types';
import { postEditSystemMessage } from '@/lib/postEditSystemMessage';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
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
  const [editIsNow, setEditIsNow] = useState(false);
  const [editTime, setEditTime] = useState(new Date());
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
      creator:profiles!activities_created_by_fkey(id, full_name, avatar_url),
      rsvps(*, profile:profiles(id, full_name, avatar_url, is_demo))
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
        going_count: (data.rsvps as Rsvp[])?.filter(r => r.status === 'in' || r.status === 'hosting').length ?? 0,
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
        const nowMode = act.activity_time === NOW_SENTINEL;
        setEditIsNow(nowMode);
        setEditTime(nowMode ? new Date() : new Date(act.activity_time));
        setIsEditing(true);
      }
    }
  }, [id, user]);

  useEffect(() => { setLoading(true); fetchActivity().finally(() => setLoading(false)); }, [fetchActivity]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchActivity(); setRefreshing(false); }, [fetchActivity]);

  // Bug fix: reset edit mode when navigating to a different activity
  useEffect(() => { setIsEditing(false); }, [id]);

  // Android back button exits edit mode instead of navigating away
  useEffect(() => {
    if (!isEditing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setIsEditing(false);
      return true;
    });
    return () => sub.remove();
  }, [isEditing]);

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

  const handleRsvp = async (status: 'in' | 'out') => {
    if (!user || !activity) return;
    // Creator is always "in" — their RSVP is locked
    if (activity.created_by === user.id) return;
    try {
      setRsvpLoading(true);
      Haptics.impactAsync(status === 'in' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      const existing = activity.my_rsvp;
      if (existing) {
        if (existing.status === status) {
          await supabase.from('rsvps').update({ status: 'pending' }).eq('id', existing.id);
        } else {
          await supabase.from('rsvps').update({ status }).eq('id', existing.id);
        }
      } else {
        await supabase.from('rsvps').insert({ activity_id: activity.id, user_id: user.id, status });
      }
      await fetchActivity();
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Could not update RSVP.');
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleProxyRsvp = (rsvp: Rsvp) => {
    if (!isCreator || !rsvp.profile?.is_demo) return;
    const name = rsvp.profile.full_name ?? 'them';
    Alert.alert(`RSVP for ${name}`, 'Set their response:', [
      { text: 'Going ✓', onPress: () => applyProxyRsvp(rsvp.id, 'in') },
      { text: "Can't make it ✗", onPress: () => applyProxyRsvp(rsvp.id, 'out') },
      { text: 'Reset to invited', onPress: () => applyProxyRsvp(rsvp.id, 'pending') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const applyProxyRsvp = async (rsvpId: string, status: 'pending' | 'in' | 'out') => {
    try {
      await supabase.from('rsvps').update({ status }).eq('id', rsvpId);
      await fetchActivity();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not update RSVP.');
    }
  };

  const handleAddSearch = async (text: string) => {
    setAddQuery(text);
    if (text.trim().length < 2) { setAddResults([]); return; }
    setAddSearching(true);
    const alreadyInvited = new Set((activity?.rsvps ?? []).map(r => r.user_id));
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, username, is_demo, created_at, updated_at')
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
        if (error) Alert.alert('Error', error.message);
        else await fetchActivity();
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
    const nowMode = activity.activity_time === NOW_SENTINEL;
    setEditIsNow(nowMode);
    setEditTime(nowMode ? new Date() : new Date(activity.activity_time));
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
      };
      const newValues: EditableFields = {
        title: editTitle.trim(),
        description: editDesc.trim() || null,
        location: editLocation.trim() || null,
        activity_time: editIsNow ? NOW_SENTINEL : editTime.toISOString(),
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
      if (existing) {
        await supabase.from('rsvps').update({ status: 'maybe' }).eq('id', existing.id);
      } else {
        await supabase.from('rsvps').insert({ activity_id: activity.id, user_id: user.id, status: 'maybe' });
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

  const isHappeningNow = activity.activity_time === NOW_SENTINEL;
  const activityDate = isHappeningNow ? new Date() : new Date(activity.activity_time);
  const past = isHappeningNow ? false : isPast(activityDate);
  const myRsvp = activity.my_rsvp;

  const dateLabel = isHappeningNow ? 'Happening now'
    : isToday(activityDate) ? `Today at ${format(activityDate, 'h:mm a')}`
    : isTomorrow(activityDate) ? `Tomorrow at ${format(activityDate, 'h:mm a')}`
    : format(activityDate, 'EEEE, MMMM d · h:mm a');

  const sortHostFirst = (rsvps: Rsvp[]) =>
    [...rsvps].sort((a, b) =>
      a.user_id === activity.created_by ? -1 : b.user_id === activity.created_by ? 1 : 0
    );

  // Split invitees by status, host always first
  const going = sortHostFirst(activity.rsvps?.filter(r => r.status === 'in' || r.status === 'hosting') ?? []);
  const maybe = sortHostFirst(activity.rsvps?.filter(r => r.status === 'maybe') ?? []);
  const notGoing = sortHostFirst(activity.rsvps?.filter(r => r.status === 'out') ?? []);
  const pending = sortHostFirst(activity.rsvps?.filter(r => r.status === 'pending') ?? []);

  const headerActions = [
    { icon: 'chatbubble-ellipses-outline' as const, onPress: () => router.push(`/(app)/activity/${id}/chat`), badge: hasUnread },
    ...(isCreator && activity.status === 'active' && !isEditing
      ? [{ icon: 'ellipsis-vertical' as const, onPress: () => setShowMenu(true) }]
      : []),
  ];

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader title="" showBack onBack={isEditing ? () => setIsEditing(false) : handleBack} rightActions={headerActions} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        {isEditing ? (
          <TextInput
            style={styles.titleInput}
            value={editTitle}
            onChangeText={setEditTitle}
            placeholder="Activity title…"
            placeholderTextColor={Colors.textSecondary}
            maxLength={80}
            autoFocus
          />
        ) : (
          <Text style={[styles.title, past && styles.titlePast]}>{activity.title}</Text>
        )}

        {activity.status === 'cancelled' && (
          <View style={styles.cancelBanner}>
            <Ionicons name="close-circle" size={16} color={Colors.danger} />
            <Text style={styles.cancelText}>This activity has been cancelled</Text>
          </View>
        )}

        {/* Meta card */}
        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.metaIcon}><Ionicons name="calendar" size={20} color={Colors.primary} /></View>
            {isEditing ? (
              <View style={{ flex: 1 }}>
                <View style={styles.editQuickRow}>
                  <TouchableOpacity style={[styles.editQuickBtn, editIsNow && styles.editQuickBtnActive]} onPress={() => setEditIsNow(true)}>
                    <Ionicons name="flash" size={13} color={editIsNow ? Colors.primary : Colors.textSecondary} />
                    <Text style={[styles.editQuickBtnText, editIsNow && styles.editQuickBtnTextActive]}>Now</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.editQuickBtn, editQuickHighlight === '10min' && styles.editQuickBtnActive]} onPress={() => { setEditIsNow(false); setEditTime(addMinutes(new Date(), 10)); setEditQuickHighlight('10min'); setTimeout(() => setEditQuickHighlight(null), 700); }}>
                    <Text style={[styles.editQuickBtnText, editQuickHighlight === '10min' && styles.editQuickBtnTextActive]}>+10 min</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.editQuickBtn, editQuickHighlight === '1hour' && styles.editQuickBtnActive]} onPress={() => { setEditIsNow(false); setEditTime(addHours(new Date(), 1)); setEditQuickHighlight('1hour'); setTimeout(() => setEditQuickHighlight(null), 700); }}>
                    <Text style={[styles.editQuickBtnText, editQuickHighlight === '1hour' && styles.editQuickBtnTextActive]}>+1 hour</Text>
                  </TouchableOpacity>
                </View>
                {!editIsNow && (
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
                )}
              </View>
            ) : (
              <View><Text style={styles.metaLabel}>When</Text><Text style={styles.metaValue}>{dateLabel}</Text></View>
            )}
          </View>
          <View style={styles.metaRow}>
            <View style={styles.metaIcon}><Ionicons name="location" size={20} color={Colors.primary} /></View>
            {isEditing ? (
              <TextInput
                style={styles.editInlineInput}
                value={editLocation}
                onChangeText={setEditLocation}
                placeholder="Where? (optional)"
                placeholderTextColor={Colors.textSecondary}
                maxLength={150}
              />
            ) : activity.location ? (
              <View style={{ flex: 1 }}><Text style={styles.metaLabel}>Where</Text><Text style={styles.metaValue}>{activity.location}</Text></View>
            ) : null}
          </View>
        </View>

        {/* DateTimePicker for edit mode */}
        {isEditing && !editIsNow && showEditPicker && (
          <DateTimePicker
            value={editTime} mode={editPickerMode}
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            minimumDate={new Date()}
            onChange={(_, date) => { setShowEditPicker(false); if (date) setEditTime(date); }}
          />
        )}

        {/* Description */}
        {isEditing ? (
          <TextInput
            style={[styles.editInput, styles.editTextArea]}
            value={editDesc}
            onChangeText={setEditDesc}
            placeholder="Details (optional)"
            placeholderTextColor={Colors.textSecondary}
            maxLength={300}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        ) : activity.description ? (
          <View style={styles.descCard}><Text style={styles.descText}>{activity.description}</Text></View>
        ) : null}


        {/* RSVP section */}
        {!past && activity.status === 'active' && !isEditing && !isCreator && (
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
              {going.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = rsvp.user_id === activity.created_by;
                const canProxy = isCreator && rsvp.profile?.is_demo && activity.status === 'active' && !past;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <TouchableOpacity
                    key={rsvp.id} style={styles.attendeeRow}
                    onPress={canProxy ? () => handleProxyRsvp(rsvp) : undefined}
                    onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                    activeOpacity={canProxy || canRemove ? 0.7 : 1}
                  >
                    <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                    <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                    {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                    {isHost && <View style={styles.hostBadge}><Text style={styles.hostText}>Host</Text></View>}
                    {!(isMe && isHost) && (
                      rsvp.status === 'hosting'
                        ? <View style={styles.statusBadgeHosting}><Text style={styles.statusTextHosting}>Hosting</Text></View>
                        : <View style={styles.statusBadgeGoing}><Text style={styles.statusTextGoing}>{canProxy ? 'Going ✎' : 'Going'}</Text></View>
                    )}
                  </TouchableOpacity>
                );
              })}
              {maybe.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = rsvp.user_id === activity.created_by;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                const visibleNote = isMe ? (maybeNote || null) : (isCreator ? (rsvp.note ?? null) : null);
                return (
                  <TouchableOpacity
                    key={rsvp.id} style={styles.attendeeRow}
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
                );
              })}
              {notGoing.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = rsvp.user_id === activity.created_by;
                const canProxy = isCreator && rsvp.profile?.is_demo && activity.status === 'active' && !past;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <TouchableOpacity
                    key={rsvp.id} style={[styles.attendeeRow, { opacity: 0.6 }]}
                    onPress={canProxy ? () => handleProxyRsvp(rsvp) : undefined}
                    onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                    activeOpacity={canProxy || canRemove ? 0.7 : 1}
                  >
                    <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                    <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                    {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                    {isHost && <View style={styles.hostBadge}><Text style={styles.hostText}>Host</Text></View>}
                    <View style={styles.statusBadgeOut}><Text style={styles.statusTextOut}>{canProxy ? "Can't go ✎" : "Can't go"}</Text></View>
                  </TouchableOpacity>
                );
              })}
              {pending.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = rsvp.user_id === activity.created_by;
                const canProxy = isCreator && rsvp.profile?.is_demo && activity.status === 'active' && !past;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <TouchableOpacity
                    key={rsvp.id} style={[styles.attendeeRow, { opacity: 0.5 }]}
                    onPress={canProxy ? () => handleProxyRsvp(rsvp) : undefined}
                    onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                    activeOpacity={canProxy || canRemove ? 0.7 : 1}
                  >
                    <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                    <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                    {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                    {isHost && <View style={styles.hostBadge}><Text style={styles.hostText}>Host</Text></View>}
                    <View style={styles.statusBadgePending}><Text style={styles.statusTextPending}>{canProxy ? 'Invited ✎' : 'Invited'}</Text></View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Chat entry */}
        {!isEditing && (
          <TouchableOpacity
            style={styles.chatEntry}
            onPress={() => router.push(`/(app)/activity/${id}/chat`)}
            activeOpacity={0.8}
          >
            <View style={styles.chatEntryIcon}>
              <Ionicons name="chatbubble-ellipses" size={22} color={Colors.primary} />
            </View>
            <View style={styles.chatEntryText}>
              <Text style={styles.chatEntryTitle}>Group Chat</Text>
              <Text style={styles.chatEntrySubtitle}>Chat with everyone who's invited</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}

        {/* Save / Delete — visible only while editing */}
        {isEditing && (
          <View style={styles.creatorFooter}>
            <TouchableOpacity
              style={[styles.footerBtn, styles.footerBtnPrimary, (saveLoading || editTitle.trim().length < 2) && { opacity: 0.4 }]}
              onPress={handleSaveEdit}
              disabled={saveLoading || editTitle.trim().length < 2}
            >
              {saveLoading
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Text style={[styles.footerBtnText, { color: Colors.primary }]}>Save changes</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.footerBtn, styles.footerBtnDanger, { flex: 0, paddingHorizontal: 20 }]} onPress={handleCancel}>
              <Ionicons name="trash-outline" size={16} color={Colors.danger} />
              <Text style={[styles.footerBtnText, { color: Colors.danger }]}>Delete</Text>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  content: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, lineHeight: 34, marginBottom: 12 },
  titlePast: { color: Colors.textSecondary },
  cancelBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.dangerLight, borderRadius: 12, padding: 12, marginBottom: 12 },
  cancelText: { fontSize: 14, color: Colors.danger, fontWeight: '600' },
  metaCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 12 },
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
  chatEntry: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, padding: 14 },
  chatEntryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  chatEntryText: { flex: 1 },
  chatEntryTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  chatEntrySubtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
});
