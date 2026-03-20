import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl,
  TextInput, ActivityIndicator, Linking, Platform, KeyboardAvoidingView, BackHandler, Keyboard,
  Modal, Image, Pressable, Dimensions, useWindowDimensions,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ZoomableImage } from '@/components/ZoomableImage';
import * as Clipboard from 'expo-clipboard';
import Toast from 'react-native-toast-message';
import { useLocalSearchParams, useGlobalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSetTabHighlight } from '@/contexts/TabHighlightContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import { format, isToday, isTomorrow, isPast, addMinutes } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Activity, Profile, Rsvp, EditableFields, isJoinMeNow, JOIN_ME_NOW_ACTIVITY_TIME } from '@/lib/types';
import { postEditSystemMessage } from '@/lib/postEditSystemMessage';
import { postEditSuggestionMessage } from '@/lib/postEditSuggestionMessage';
import { postRsvpChangeMessage } from '@/lib/postRsvpChangeMessage';
import { postHostPing } from '@/lib/postHostPing';
import { reportError } from '@/lib/reportError';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ActivityUpdatesFeed } from '@/components/ActivityUpdatesFeed';
import { LocationAutocomplete } from '@/components/LocationAutocomplete';
import { LocationDisplay } from '@/components/LocationDisplay';
import { RichText } from '@/components/RichText';
import { SplashArt } from '@/components/SplashArt';
import { SPLASH_PRESETS, SPLASH_PRESETS_REGULAR, type SplashPreset } from '@/lib/splashArt';
import { parseLocation, buildLocationWithPlace, buildGoogleMapsUrl } from '@/lib/locationUtils';
import { getCoverImageUrl } from '@/lib/placesApi';
import { getAndClearPendingPosterForActivity } from '@/lib/pendingPoster';
import { uploadPosterImage } from '@/lib/uploadPoster';
import { deleteActivity } from '@/lib/deleteActivity';
import { markActivityVisited } from '@/lib/visitedActivities';
import * as Calendar from 'expo-calendar';
import Colors from '@/constants/Colors';

export default function ActivityDetailScreen() {
  const localParams = useLocalSearchParams<{ id: string; edit?: string; fromTab?: string }>();
  const globalParams = useGlobalSearchParams<{ fromTab?: string }>();
  const { id, edit } = localParams;
  const fromTab = localParams.fromTab ?? globalParams.fromTab;
  const { user, profile } = useAuth();
  useSetTabHighlight(fromTab);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [activityDeleted, setActivityDeleted] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  const [hasUnread, setHasUnread] = useState(false);
  const [activeLiveLocationPostId, setActiveLiveLocationPostId] = useState<string | null>(null);

  // Invite-edit state
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [showDeclined, setShowDeclined] = useState(false);
  // Join me: showFullList toggles between "I'm in" only vs full list (replaces showDeclined semantics)
  const [showFullList, setShowFullList] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<Profile[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addLoading, setAddLoading] = useState<string | null>(null);
  const [pingLoading, setPingLoading] = useState(false);
  const [lastPingAt, setLastPingAt] = useState<string | null>(null);
  const [showPingBubble, setShowPingBubble] = useState(false);
  const [pingBubblePosition, setPingBubblePosition] = useState<{ iconX: number; y: number } | null>(null);
  const pingIconRef = useRef<View>(null);

  // Activity edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editTime, setEditTime] = useState(new Date());
  const [editSplashArt, setEditSplashArt] = useState<SplashPreset | null>(null);
  const [editPlacePhotoName, setEditPlacePhotoName] = useState<string | null>(null);
  const [showEditSplashPicker, setShowEditSplashPicker] = useState(false);
  const [showEditDetailsInput, setShowEditDetailsInput] = useState(false);
  const [showEditPicker, setShowEditPicker] = useState(false);
  const [editPickerMode, setEditPickerMode] = useState<'date' | 'time'>('date');
  const [editJoinMeWhenNow, setEditJoinMeWhenNow] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [showPosterModal, setShowPosterModal] = useState(false);
  const [posterUploading, setPosterUploading] = useState(false);
  const [posterScale, setPosterScale] = useState(1);
  const { width: screenWidth } = useWindowDimensions();

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
    setActivityDeleted(false);
    const { data, error } = await supabase.from('activities').select(`
      *,
      host:profiles!activities_created_by_fkey(id, full_name, avatar_url),
      host_pings(pinged_at),
      rsvps(*, profile:profiles(id, full_name, avatar_url))
    `).eq('id', id).maybeSingle();

    if (error) {
      console.error('[Activity] fetch error:', error.message);
      setFetchError(error.message);
      setActivity(null);
      return;
    }
    if (!data) {
      setActivity(null);
      setLastPingAt(null);
      setActivityDeleted(true);
      return;
    }
    if (data) {
      setActivityDeleted(false);
      let hostPings: { pinged_at: string }[] | undefined;
      if (data.created_by === user.id) {
        const { data: hp } = await supabase.from('host_pings').select('pinged_at').eq('activity_id', id).maybeSingle();
        hostPings = hp ? [hp] : [];
      } else {
        const embedded = data.host_pings;
        hostPings = Array.isArray(embedded) ? embedded : embedded ? [embedded as { pinged_at: string }] : [];
      }
      const act = {
        ...data,
        host_pings: hostPings,
        my_rsvp: (data.rsvps as Rsvp[])?.find(r => r.user_id === user.id) ?? null,
        going_count: (data.rsvps as Rsvp[])?.filter(r => r.status === 'in').length ?? 0,
      } as Activity;
      setActivity(act);
      if (data.created_by === user.id) {
        setLastPingAt(hostPings[0]?.pinged_at ?? null);
      } else {
        setLastPingAt(null);
      }

      const { data: livePost } = await supabase
        .from('posts')
        .select('id')
        .eq('activity_id', id)
        .eq('post_type', 'live_location')
        .is('chat_closed_at', null)
        .maybeSingle();
      setActiveLiveLocationPostId(livePost?.id ?? null);
      // Mark RSVP as seen for badge clearing. Board read is set when user opens the board.
      // Do NOT set miba_activity_last_seen here — that would cause ActivityUpdatesFeed to filter out all updates before the user sees them.
      const now = new Date().toISOString();
      AsyncStorage.setItem(`miba_rsvp_changes_seen_${id}`, now).catch(() => {});
      markActivityVisited(id).catch(() => {});

      // Auto-enter edit mode when cloned (navigated with ?edit=1)
      if (editOnLoad.current) {
        editOnLoad.current = false;
        setEditTitle(act.title);
        setEditDesc(act.description ?? '');
        setEditLocation(act.location ?? '');
        const isNow = act.activity_time === JOIN_ME_NOW_ACTIVITY_TIME && !!act.is_join_me;
        setEditJoinMeWhenNow(isNow);
        setEditTime(isNow ? new Date() : new Date(act.activity_time));
        setEditSplashArt(act.splash_art ?? 'banner_1');
        setEditPlacePhotoName(act.place_photo_name ?? null);
        setIsEditing(true);
      }
    }
  }, [id, user]);

  useEffect(() => { setLoading(true); fetchActivity().finally(() => setLoading(false)); }, [fetchActivity]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchActivity(); setRefreshing(false); }, [fetchActivity]);

  // Background poster upload: when arriving from "create from poster", upload in background
  useEffect(() => {
    if (!id || !activity) return;
    const posterUri = getAndClearPendingPosterForActivity(id);
    if (!posterUri) return;

    console.log('[ActivityDetail] Poster upload starting for', id);
    setPosterUploading(true);
    uploadPosterImage(posterUri, id)
      .then(async (posterUrl) => {
        if (posterUrl) {
          await supabase.from('activities').update({ poster_image_url: posterUrl }).eq('id', id);
          setActivity(prev => prev ? { ...prev, poster_image_url: posterUrl } : null);
          console.log('[ActivityDetail] Poster upload done, DB updated');
        } else {
          console.warn('[ActivityDetail] Poster upload failed (no URL returned)');
        }
      })
      .finally(() => setPosterUploading(false));
  }, [id, activity?.id]);

  // Bug fix: reset edit mode when navigating to a different activity
  useEffect(() => { setIsEditing(false); setEditSplashArt(null); setEditPlacePhotoName(null); setShowEditSplashPicker(false); setShowEditDetailsInput(false); setLastPingAt(null); }, [id]);
  useEffect(() => { if (!isEditing) setShowEditSplashPicker(false); setShowEditDetailsInput(false); }, [isEditing]);
  useEffect(() => { if (!showPosterModal) setPosterScale(1); }, [showPosterModal]);

  const checkUnread = useCallback(async () => {
    if (!id || !user) return;
    try {
      const stored = await AsyncStorage.getItem(`miba_board_last_read_${id}`);
      const since = stored ?? '1970-01-01T00:00:00Z';
      const [postsRes, commentsRes] = await Promise.all([
        supabase
          .from('posts')
          .select('*', { count: 'exact', head: true })
          .eq('activity_id', id)
          .neq('user_id', user.id)
          .gt('created_at', since),
        supabase
          .from('post_comments')
          .select('*', { count: 'exact', head: true })
          .eq('activity_id', id)
          .neq('user_id', user.id)
          .gt('created_at', since),
      ]);
      const postsCount = postsRes.count ?? 0;
      const commentsCount = commentsRes.count ?? 0;
      setHasUnread(postsCount + commentsCount > 0);
    } catch {
      // non-critical — silently ignore
    }
  }, [id, user]);

  useFocusEffect(useCallback(() => {
    checkUnread();
    fetchActivity();
  }, [checkUnread, fetchActivity]));

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
              if (!user || !activity) return;
              const { error } = await deleteActivity(activity.id, user.id);
              if (error) {
                Alert.alert('Error', 'Could not delete event.');
                return;
              }
              router.back();
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
    const list = ((data ?? []) as Profile[]).filter(p => !alreadyInvited.has(p.id));
    setAddResults(list);
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

  const pingCooldownEnds = lastPingAt ? addMinutes(new Date(lastPingAt), 24 * 60) : null;
  const pingOnCooldown = pingCooldownEnds ? new Date() < pingCooldownEnds : false;
  const pingHoursLeft = pingOnCooldown && pingCooldownEnds
    ? Math.max(1, Math.ceil((pingCooldownEnds.getTime() - Date.now()) / (60 * 60 * 1000)))
    : 0;

  const handlePing = async () => {
    if (!id || !isCreator) return;
    if (pingOnCooldown) {
      Toast.show({ type: 'info', text1: `You can only ping once every 24 hours, please try again in ${pingHoursLeft} hours` });
      return;
    }
    setPingLoading(true);
    try {
      const result = await postHostPing(id);
      if (result.ok) {
        Toast.show({ type: 'success', text1: 'Ping sent!' });
        await fetchActivity();
      } else {
        const isRateLimit = result.error?.toLowerCase().includes('once per day') ?? false;
        if (isRateLimit) {
          await fetchActivity();
          const { data: hp } = await supabase.from('host_pings').select('pinged_at').eq('activity_id', id).maybeSingle();
          const hoursLeft = hp?.pinged_at
            ? Math.max(1, Math.ceil((addMinutes(new Date(hp.pinged_at), 24 * 60).getTime() - Date.now()) / (60 * 60 * 1000)))
            : 24;
          Toast.show({ type: 'info', text1: `You can only ping once every 24 hours, please try again in ${hoursLeft} hours` });
        } else {
          reportError(new Error(result.error ?? 'RPC error'), { action: 'host_ping' });
          Toast.show({ type: 'error', text1: result.error ?? 'Could not ping' });
        }
      }
    } catch (e) {
      reportError(e, { action: 'host_ping' });
      Toast.show({ type: 'error', text1: (e as Error).message ?? 'Could not ping' });
    } finally {
      setPingLoading(false);
    }
  };

  const handleCancel = () => Alert.alert('Delete Activity', 'This will permanently delete the event and all its discussions, location chats, and live location sessions. Continue?', [
    { text: 'No', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      if (!user || !id) return;
      const { error } = await deleteActivity(id, user.id);
      if (error) {
        Alert.alert('Error', 'Could not delete event.');
        return;
      }
      router.back();
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
          place_photo_name: activity.place_photo_name ?? null,
          is_limited: activity.is_limited ?? false,
          max_participants: activity.is_limited ? activity.max_participants : null,
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
    const isNow = isJoinMeNow(activity);
    setEditJoinMeWhenNow(isNow);
    setEditTime(isNow ? new Date() : new Date(activity.activity_time));
    setEditSplashArt(activity.splash_art ?? 'banner_1');
    setEditPlacePhotoName(activity.place_photo_name ?? null);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!activity || editTitle.trim().length < 2) return;
    const isJoinMe = !!activity.is_join_me;
    if (!(isJoinMe && editJoinMeWhenNow) && editTime <= new Date()) {
      Alert.alert('Past date', 'Please choose a future date and time.');
      return;
    }
    try {
      setSaveLoading(true);

      const oldValues: EditableFields = {
        title: activity.title,
        description: activity.description,
        location: activity.location,
        activity_time: activity.activity_time,
        splash_art: activity.splash_art ?? undefined,
        place_photo_name: activity.place_photo_name ?? undefined,
      };
      const activityTimeValue = isJoinMe && editJoinMeWhenNow ? JOIN_ME_NOW_ACTIVITY_TIME : editTime.toISOString();
      const newValues: EditableFields = {
        title: editTitle.trim(),
        description: editDesc.trim() || null,
        location: editLocation.trim() || null,
        activity_time: activityTimeValue,
        splash_art: editPlacePhotoName ? null : editSplashArt,
        place_photo_name: editPlacePhotoName || null,
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
    setSuggestTime(isJoinMeNow(activity!) ? new Date() : new Date(activity!.activity_time));
    setSuggestLocation(activity!.location ?? '');
    setSuggestNote('');
    setShowSuggestionModal(true);
  };

  const handleAddToCalendar = async () => {
    if (!activity) return;
    if (Platform.OS === 'web') {
      Alert.alert('Not available', 'Adding to calendar is only supported on iOS and Android.');
      return;
    }
    try {
      const startDate = isJoinMeNow(activity) ? new Date() : new Date(activity.activity_time);
      const endDate = addMinutes(startDate, 60); // 1 hour default
      const locationStr = parseLocation(activity.location)?.address ?? activity.location ?? undefined;
      await Calendar.createEventInCalendarAsync({
        title: activity.title,
        startDate,
        endDate,
        location: locationStr,
        notes: activity.description ?? undefined,
      });
    } catch (e: any) {
      Alert.alert('Could not add to calendar', e.message ?? 'Please try again.');
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

  if (activityDeleted || fetchError || !activity) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Activity" showBack />
        <View style={styles.center}>
          {activityDeleted ? (
            <>
              <Ionicons name="trash-outline" size={40} color={Colors.textSecondary} />
              <Text style={[styles.loadingText, { marginTop: 10 }]}>Event deleted</Text>
              <TouchableOpacity
                onPress={() => router.replace('/(app)/events')}
                style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: Colors.primary, borderRadius: 12 }}
              >
                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Go back to events</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Ionicons name="alert-circle-outline" size={40} color={Colors.danger} />
              <Text style={[styles.loadingText, { marginTop: 10, color: Colors.danger }]}>
                {fetchError ?? 'Activity not found.'}
              </Text>
              <TouchableOpacity onPress={() => { setLoading(true); fetchActivity().finally(() => setLoading(false)); }} style={{ marginTop: 16 }}>
                <Text style={{ color: Colors.primary, fontWeight: '600' }}>Try again</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  const activityDate = new Date(activity.activity_time);
  const past = isPast(activityDate);
  const myRsvp = activity.my_rsvp;

  const dateLabel = isJoinMeNow(activity)
    ? 'Now'
    : isToday(activityDate)
    ? `Today at ${format(activityDate, 'h:mm a')}`
    : isTomorrow(activityDate)
    ? `Tomorrow at ${format(activityDate, 'h:mm a')}`
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

  const hasPoster = !!(activity.poster_image_url && String(activity.poster_image_url).trim());
  const showPosterButton = hasPoster || posterUploading;
  const headerActions = [
    ...(showPosterButton
      ? [{
          icon: 'image-outline' as const,
          onPress: () => setShowPosterModal(true),
          loading: posterUploading,
        }]
      : []),
    { icon: 'chatbubble-ellipses-outline' as const, onPress: () => router.push(`/(app)/activity/${id}/board?fromTab=${encodeURIComponent(fromTab ?? 'events')}`), badge: hasUnread },
    ...(isCreator && activity.status === 'active' && !isEditing
      ? [{ icon: 'ellipsis-vertical' as const, onPress: () => setShowMenu(true) }]
      : []),
  ];

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader title="" showBack onBack={isEditing ? () => setIsEditing(false) : handleBack} rightActions={headerActions} />
      {/* Fixed title — does not scroll */}
      <View style={styles.titleSection}>
        {((activity.place_photo_name && !isEditing) || (activity.splash_art && !isEditing) || (activity.poster_image_url && String(activity.poster_image_url).trim() && !isEditing) || (isEditing && (editPlacePhotoName || editSplashArt))) ? (
          <View style={styles.splashBlock}>
            <SplashArt
              preset={isEditing ? editSplashArt ?? undefined : activity.splash_art ?? undefined}
              imageUri={
                isEditing && editPlacePhotoName
                  ? getCoverImageUrl(editPlacePhotoName)
                  : activity.place_photo_name
                    ? getCoverImageUrl(activity.place_photo_name)
                    : activity.poster_image_url && String(activity.poster_image_url).trim()
                      ? activity.poster_image_url
                      : undefined
              }
              height={90}
              opacity={0.5}
              resizeMode="cover"
            />
          </View>
        ) : isEditing ? (
          <TouchableOpacity style={styles.splashThumbPlaceholder} onPress={() => setShowEditSplashPicker(true)}>
            <Ionicons name="image-outline" size={24} color={Colors.primary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.titleRow}>
          <View style={styles.titleContent}>
            {isEditing ? (
              <>
                <TouchableOpacity
                  style={[styles.addCoverBtn, { marginBottom: 8 }]}
                  onPress={() => setShowEditSplashPicker(v => !v)}
                >
                  <Ionicons name="image-outline" size={16} color={Colors.primary} />
                  <Text style={styles.addCoverBtnText}>{(editSplashArt || editPlacePhotoName) ? 'Change cover' : 'Add cover'}</Text>
                </TouchableOpacity>
                {showEditSplashPicker && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.splashPickerContent, { marginBottom: 10 }]}>
                    {(activity.is_join_me ? SPLASH_PRESETS : SPLASH_PRESETS_REGULAR).map(p => (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.splashPickerOption, styles.splashPickerOptionImg, editSplashArt === p.id && styles.splashPickerOptionActive]}
                        onPress={() => { setEditSplashArt(p.id); setEditPlacePhotoName(null); setShowEditSplashPicker(false); }}
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
          </View>
        </View>
        {activity.status === 'cancelled' && (
          <View style={styles.cancelBanner}>
            <Ionicons name="close-circle" size={16} color={Colors.danger} />
            <Text style={styles.cancelText}>This activity has been cancelled</Text>
          </View>
        )}
        {activity.is_limited && activity.max_participants != null && (
          <View style={styles.limitedBadge}>
            <Ionicons name="people-outline" size={14} color={Colors.primary} />
            <Text style={styles.limitedBadgeText}>Limited, max {activity.max_participants}</Text>
          </View>
        )}
        {activity.is_join_me && activity.join_me_expires_at && !past && (
          <View style={styles.limitedBadge}>
            <Ionicons name="time-outline" size={14} color={Colors.primary} />
            <Text style={styles.limitedBadgeText}>
              Ends at {format(new Date(activity.join_me_expires_at), 'h:mm a')}
            </Text>
          </View>
        )}
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
                {activity.is_join_me ? (
                  <View style={styles.editDatetimeRow}>
                    <TouchableOpacity
                      style={[styles.editDatetimeBtn, { flex: 1 }, editJoinMeWhenNow && { borderColor: Colors.primary, backgroundColor: Colors.accentLight }]}
                      onPress={() => setEditJoinMeWhenNow(true)}
                    >
                      <Ionicons name="time-outline" size={15} color={editJoinMeWhenNow ? Colors.primary : Colors.textSecondary} />
                      <Text style={[styles.editDatetimeText, editJoinMeWhenNow && { color: Colors.primaryDark }]}>Now</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editDatetimeBtn, { flex: 1 }, !editJoinMeWhenNow && { borderColor: Colors.primary, backgroundColor: Colors.accentLight }]}
                      onPress={() => setEditJoinMeWhenNow(false)}
                    >
                      <Ionicons name="calendar-outline" size={15} color={!editJoinMeWhenNow ? Colors.primary : Colors.textSecondary} />
                      <Text style={[styles.editDatetimeText, !editJoinMeWhenNow && { color: Colors.primaryDark }]}>Later</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
                {(!activity.is_join_me || !editJoinMeWhenNow) && (
                  <View style={styles.editDatetimeRow}>
                    <TouchableOpacity style={[styles.editDatetimeBtn, { flex: 2 }]} onPress={() => { setEditPickerMode('date'); setShowEditPicker(true); }}>
                      <Ionicons name="calendar-outline" size={15} color={Colors.primary} />
                      <Text style={styles.editDatetimeText}>{format(editTime, 'EEE, MMM d')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.editDatetimeBtn, { flex: 1 }]} onPress={() => { setEditPickerMode('time'); setShowEditPicker(true); }}>
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
              <View style={{ flex: 1 }}>
                <LocationAutocomplete
                  value={parseLocation(editLocation)?.address ?? editLocation ?? ''}
                  onChangeText={(text) => { setEditLocation(text); setEditPlacePhotoName(null); }}
                  onResolvedPlace={(p) => {
                    setEditLocation(buildLocationWithPlace(p.address, p.placeId, p.displayName));
                    if (p.placePhotoName) {
                      setEditPlacePhotoName(p.placePhotoName);
                      setEditSplashArt(null);
                    } else {
                      setEditPlacePhotoName(null);
                    }
                  }}
                  placeholder="Where? (optional)"
                  maxLength={150}
                  showIcon={false}
                  style={{ marginBottom: 0 }}
                />
              </View>
            ) : activity.location ? (
              <View style={[styles.metaRowInner, { flex: 1 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.metaLabel}>Where</Text>
                  <LocationDisplay
                    location={activity.location}
                    variant="detail"
                    showIcon={false}
                    hideMapsButton={!past && activity.status === 'active' && !isEditing && parseLocation(activity.location)?.placeId != null}
                  />
                </View>
              </View>
            ) : null}
          </View>
          {!past && activity.status === 'active' && !isEditing && !isCreator && (
            <TouchableOpacity style={styles.suggestBtn} onPress={openSuggestionModal}>
              <Ionicons name="create-outline" size={16} color={Colors.primary} />
              <Text style={styles.suggestBtnText}>Suggest different time or location</Text>
            </TouchableOpacity>
          )}
          {!past && activity.status === 'active' && !isEditing && (parseLocation(activity.location)?.placeId != null || (Platform.OS !== 'web' && !isJoinMeNow(activity))) && (
            <View style={styles.actionButtonsRow}>
              {Platform.OS !== 'web' && !isJoinMeNow(activity) && (
                <TouchableOpacity style={styles.actionBtn} onPress={handleAddToCalendar}>
                  <Ionicons name="calendar-outline" size={16} color={Colors.primary} />
                  <Text style={styles.actionBtnText}>Add to calendar</Text>
                </TouchableOpacity>
              )}
              {parseLocation(activity.location)?.placeId != null && (
                <TouchableOpacity
                  style={styles.actionBtnMaps}
                  onPress={() => Linking.openURL(buildGoogleMapsUrl(parseLocation(activity.location)!.placeId!, parseLocation(activity.location)!.displayName ?? parseLocation(activity.location)!.address))}
                >
                  <Ionicons name="map-outline" size={20} color={Colors.primary} />
                </TouchableOpacity>
              )}
            </View>
          )}
          {!past && activity.status === 'active' && !isEditing && (activity.is_join_me ? true : activeLiveLocationPostId) && (
            <TouchableOpacity
              style={styles.liveLocationBtn}
              onPress={() => {
                if (activeLiveLocationPostId) {
                  router.push(`/(app)/activity/${id}/post-chat/${activeLiveLocationPostId}?fromTab=${encodeURIComponent(fromTab ?? 'events')}`);
                } else {
                  router.push(`/(app)/activity/${id}/board?fromTab=${encodeURIComponent(fromTab ?? 'events')}`);
                }
              }}
            >
              <Ionicons name="location" size={22} color={Colors.primary} />
              <Text style={styles.liveLocationBtnText}>
                {activeLiveLocationPostId ? 'live location shared' : 'Share live location'}
              </Text>
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

        {/* Original poster popup (from "From Poster" events) — pinch to zoom */}
        <Modal visible={showPosterModal} transparent animationType="fade" onRequestClose={() => setShowPosterModal(false)}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <Pressable style={styles.locationImageModalOverlay} onPress={() => setShowPosterModal(false)}>
              <Pressable style={[styles.locationImageModalContent, { maxWidth: 750 }]} onPress={() => {}}>
                {activity?.poster_image_url && (
                  <ScrollView
                    style={{ maxHeight: Dimensions.get('window').height * 0.85 }}
                    contentContainerStyle={styles.posterScrollContent}
                    showsVerticalScrollIndicator={false}
                    scrollEnabled={posterScale <= 1}
                  >
                    <ZoomableImage
                      source={{ uri: activity.poster_image_url }}
                      style={{
                        width: Math.min(750, screenWidth - 24),
                        height: Math.min(600, Dimensions.get('window').height * 0.75),
                      }}
                      onScaleChange={setPosterScale}
                    />
                  </ScrollView>
                )}
                <TouchableOpacity
                  style={styles.locationImageModalClose}
                  onPress={() => setShowPosterModal(false)}
                >
                  <Text style={styles.locationImageModalCloseText}>Close</Text>
                </TouchableOpacity>
              </Pressable>
            </Pressable>
          </GestureHandlerRootView>
        </Modal>

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
              <>
                <TextInput
                  style={[styles.editInput, styles.editTextArea, { marginTop: 10 }]}
                  value={editDesc}
                  onChangeText={setEditDesc}
                  placeholder="Any extra info… Use **bold**, *italic*, and paste URLs for links."
                  placeholderTextColor={Colors.textSecondary}
                  maxLength={500}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                <Text style={[styles.formatHint, { marginTop: 6 }]}>
                  Supports **bold**, *italic*, [link](url), and colors: [primary]text[/primary]
                </Text>
              </>
            )}
          </View>
        ) : activity.description ? (
          <View style={styles.descCard}>
            <ScrollView style={styles.descScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              <RichText style={styles.descText}>{activity.description}</RichText>
            </ScrollView>
          </View>
        ) : null}


        {/* RSVP section — hidden for host when limited or join me (host is always "in") */}
        {!past && activity.status === 'active' && !isEditing && !(isCreator && (activity.is_limited || activity.is_join_me)) && (
          <View style={styles.rsvpSection}>
            <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>Are you joining?</Text>
                <View style={styles.rsvpButtons}>
                  {/* I'm in — disabled when limited event is closed (non-host) */}
                  <TouchableOpacity
                    style={[styles.rsvpBtn, myRsvp?.status === 'in' && styles.rsvpBtnInActive]}
                    onPress={() => { handleRsvp('in'); }}
                    disabled={rsvpLoading || (!isCreator && !!activity.limited_closed_at)}
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
            <View style={styles.sectionHeaderRight}>
              {(activity.is_join_me ? (going.length + maybe.length + notGoing.length + pending.length > 0) : notGoing.length > 0) && (
                <TouchableOpacity
                  style={styles.showDeclinedBtn}
                  onPress={() => activity.is_join_me ? setShowFullList(v => !v) : setShowDeclined(v => !v)}
                >
                  <Ionicons name={(activity.is_join_me ? showFullList : showDeclined) ? 'eye-off-outline' : 'eye-outline'} size={14} color={Colors.textSecondary} />
                  <Text style={styles.showDeclinedBtnText}>
                    {activity.is_join_me
                      ? (showFullList ? 'Show I\'m in only' : `Show full list (${going.length + maybe.length + notGoing.length + pending.length})`)
                      : (showDeclined ? 'Hide declined' : `Show declined (${notGoing.length})`)}
                  </Text>
                </TouchableOpacity>
              )}
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
              {addQuery.trim().length >= 2 && !addSearching && (
                <View style={styles.addResultsList}>
                  {addResults.length > 0 ? (
                    addResults.map(p => (
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
                    ))
                  ) : (
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
                      <View style={styles.addNoResultsWrap}>
                        <Text style={styles.addNoResults}>No users found for "{addQuery}"</Text>
                      </View>
                    )
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
            </View>
          )}

          {(activity.rsvps ?? []).length === 0 ? (
            <Text style={styles.noAttendees}>No one invited yet.</Text>
          ) : (
            <View style={styles.attendeeList}>
              {/* Host always first (hidden when declined and showDeclined/showFullList is off) */}
              {hostRsvp && (hostRsvp.status !== 'out' || (activity.is_join_me ? showFullList : showDeclined)) && (() => {
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
                      {status === 'in' && <View style={styles.statusBadgeGoing}><Text style={styles.statusTextGoing}>You're in!</Text></View>}
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
                      <View style={styles.statusBadgeGoing}><Text style={styles.statusTextGoing}>You're in!</Text></View>
                    </TouchableOpacity>
                    {canRemove && (
                      <TouchableOpacity style={styles.removeInviteeBtn} onPress={() => handleRemoveInvitee(rsvp)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={24} color={Colors.danger} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
              {(!activity.is_join_me || showFullList) && maybe.map(rsvp => {
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
              {(activity.is_join_me ? showFullList : showDeclined) && notGoing.map(rsvp => {
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
              {(!activity.is_join_me || showFullList) && pending.map(rsvp => {
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

          {/* Ping row — below invited list, right-aligned with info button */}
          {isCreator && activity.status === 'active' && !past && !activity.is_join_me && (pending.length + maybe.length) > 0 && (
            <View style={styles.pingRow}>
              <View style={{ flex: 1 }} />
              <View style={styles.pingRowRight}>
                <View ref={pingIconRef} collapsable={false}>
                  <TouchableOpacity
                    onPress={() => {
                      pingIconRef.current?.measureInWindow((x, y) => {
                        setPingBubblePosition({ iconX: x, y });
                        setShowPingBubble(true);
                      });
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="information-circle-outline" size={20} color="#3B82F6" />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  style={[
                    styles.addInviteBtn,
                    (pingLoading || pingOnCooldown) && styles.pingBtnDisabled,
                  ]}
                  onPress={handlePing}
                  disabled={pingLoading}
                >
                  {pingLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="notifications-outline" size={16} color={pingOnCooldown ? Colors.textSecondary : Colors.primary} />
                      <Text style={[styles.addInviteBtnText, pingOnCooldown && { color: Colors.textSecondary }]}>Ping</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>

        {/* Updates feed — hidden for join me events */}
        {!isEditing && !activity.is_join_me && (
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

      {/* Ping info bubble */}
      <Modal visible={showPingBubble} transparent animationType="fade">
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => setShowPingBubble(false)}
        />
        {pingBubblePosition && showPingBubble && (
          <Pressable
            style={[
              styles.pingBubble,
              styles.pingBubbleLeft,
              {
                left: 24,
                right: Dimensions.get('window').width - pingBubblePosition.iconX + 8,
                top: pingBubblePosition.y,
              },
            ]}
            onPress={() => setShowPingBubble(false)}
          >
            <Text style={styles.pingBubbleText}>Send a reminder to people who haven't responded yet.\nYou can use this once every 24 hours.</Text>
          </Pressable>
        )}
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
              <TouchableOpacity style={styles.suggestionInput} onPress={() => { setSuggestPickerMode('date'); if (!suggestTime) setSuggestTime(isJoinMeNow(activity) ? new Date() : new Date(activity.activity_time)); setShowSuggestPicker(true); }}>
                <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
                <Text style={styles.suggestionInputText}>{suggestTime ? format(suggestTime, 'EEE, MMM d') : 'Pick date'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.suggestionInput} onPress={() => { setSuggestPickerMode('time'); if (!suggestTime) setSuggestTime(isJoinMeNow(activity) ? new Date() : new Date(activity.activity_time)); setShowSuggestPicker(true); }}>
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
            value={suggestTime ?? (isJoinMeNow(activity) ? new Date() : new Date(activity.activity_time))}
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
  titleSection: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  splashBlock: { marginHorizontal: -20, marginTop: -8, marginBottom: 12, overflow: 'hidden', borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  splashThumbPlaceholder: { width: 56, height: 56, borderRadius: 12, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 8 },
  titleContent: { flex: 1, minWidth: 0 },
  editSection: { marginBottom: 16 },
  editSectionLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  addCoverBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  addCoverBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
  formatHint: { fontSize: 12, color: Colors.textSecondary },
  splashPickerContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  splashPickerOption: { alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 2, borderColor: Colors.border, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: Colors.surface },
  splashPickerOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  splashPickerOptionImg: { padding: 0, overflow: 'hidden', width: 64 },
  splashPickerThumb: { width: 64, height: 48, overflow: 'hidden', borderRadius: 10 },
  splashPickerOptionLabel: { fontSize: 10, fontWeight: '600', color: Colors.textSecondary, marginTop: 4 },
  splashPickerOptionText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  content: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: '800', color: '#000', lineHeight: 34, marginBottom: 12, paddingVertical: 8, paddingHorizontal: 4 },
  titleRtl: { textAlign: 'right' },
  titlePast: { color: '#000' },
  cancelBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.dangerLight, borderRadius: 12, padding: 12, marginBottom: 12 },
  cancelText: { fontSize: 14, color: Colors.danger, fontWeight: '600' },
  limitedBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  limitedBadgeText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  metaCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 12 },
  suggestBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingVertical: 8 },
  suggestBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  actionButtonsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  actionBtnMaps: { padding: 12, marginLeft: 'auto' },
  liveLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  liveLocationBtnText: { fontSize: 16, fontWeight: '700', color: Colors.primary },
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
  metaRowInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  locationImageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  locationImageModalContent: {
    width: '100%',
    maxWidth: 500,
    alignItems: 'center',
  },
  posterScrollContent: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  locationImageModalClose: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: Colors.surface,
    borderRadius: 12,
  },
  locationImageModalCloseText: { fontSize: 16, fontWeight: '600', color: Colors.primary },
  metaLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 15, color: Colors.text, fontWeight: '600', marginTop: 1 },
  descCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border, marginBottom: 12, maxHeight: 128 },
  descScroll: { maxHeight: 100 },
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
  titleInput: { fontSize: 26, fontWeight: '800', color: '#000', lineHeight: 32, marginBottom: 12, borderBottomWidth: 2, borderBottomColor: Colors.primary, paddingBottom: 4 },
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
  editDatetimeRow: { flexDirection: 'row', gap: 8 },
  editDatetimeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 8 },
  editDatetimeText: { fontSize: 13, fontWeight: '600', color: Colors.text },
  editInlineInput: { flex: 1, fontSize: 15, color: Colors.text, borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: 4 },
  editInput: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.text, marginBottom: 12 },
  editTextArea: { minHeight: 80, paddingTop: 10, textAlignVertical: 'top' },
  attendeesSection: { marginTop: 8, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  showDeclinedBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 },
  showDeclinedBtnText: { fontSize: 13, color: Colors.textSecondary },
  addInviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  addInviteBtnActive: { borderColor: Colors.border, backgroundColor: Colors.surface },
  addInviteBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  pingRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  pingRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pingBtnDisabled: { opacity: 0.6, borderColor: Colors.textSecondary, backgroundColor: Colors.border },
  pingBubble: { backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6 },
  pingBubbleRight: { position: 'absolute' as const, minWidth: 160, maxWidth: 280 },
  pingBubbleLeft: { position: 'absolute' as const, minWidth: 160 },
  pingBubbleText: { fontSize: 14, color: Colors.text },
  addSearchSection: { marginBottom: 12 },
  addSearchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 10, gap: 8, marginBottom: 6 },
  addSearchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 10 },
  addResultsList: { backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  addResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  addResultInfo: { flex: 1 },
  addResultName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  addResultUsername: { fontSize: 12, color: Colors.textSecondary },
  addNoResults: { fontSize: 13, color: Colors.textSecondary, paddingHorizontal: 4 },
  addNoResultsWrap: { paddingHorizontal: 12, paddingVertical: 12 },
  inviteEmailBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 12, marginTop: 2, marginBottom: 4, backgroundColor: Colors.accentLight, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed', paddingHorizontal: 12, paddingVertical: 10 },
  inviteLinkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  inviteLinkText: { fontSize: 14, color: Colors.primary, fontWeight: '500' },
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
