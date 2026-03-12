import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Keyboard,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';

class MapErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError = () => ({ hasError: true });
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSetTabHighlight } from '@/contexts/TabHighlightContext';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import type { EditSuggestionMetadata } from '@/lib/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Message } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { parseLocation } from '@/lib/locationUtils';
import { requestLocationPermission } from '@/lib/mipoLocation';
import Colors from '@/constants/Colors';

type LocationShare = {
  activity_id: string;
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string;
  profile?: { full_name?: string } | null;
};

function formatMessageTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, h:mm a');
}

export default function ActivityChatScreen() {
  const { id, fromTab } = useLocalSearchParams<{ id: string; fromTab?: string }>();
  const { user } = useAuth();
  useSetTabHighlight(fromTab);
  const router = useRouter();

  const insets = useSafeAreaInsets();

  const [activityTitle, setActivityTitle] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [isMipoDm, setIsMipoDm] = useState(false);
  const [otherUserName, setOtherUserName] = useState<string | null>(null);
  const [locationShares, setLocationShares] = useState<LocationShare[]>([]);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [shareLocationLoading, setShareLocationLoading] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const listRef = useRef<FlatList>(null);
  const scrollOffsetRef = useRef(0);
  const showMapRef = useRef(false);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      setKeyboardVisible(true);
      if (showMapRef.current) {
        const offset = scrollOffsetRef.current + 100;
        requestAnimationFrame(() => {
          listRef.current?.scrollToOffset({ offset, animated: true });
        });
      }
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const locationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch activity title + initial messages
  const fetchInitial = useCallback(async () => {
    if (!id || !user) return;

    const [activityRes, messagesRes] = await Promise.all([
      supabase.from('activities').select('title').eq('id', id).single(),
      supabase
        .from('messages')
        .select('*, profile:profiles(id, full_name, avatar_url)')
        .eq('activity_id', id)
        .order('created_at', { ascending: true }),
    ]);

    if (activityRes.data) setActivityTitle(activityRes.data.title);
    if (!messagesRes.error) setMessages((messagesRes.data ?? []) as Message[]);
  }, [id, user]);

  const markRead = useCallback(() => {
    if (id) AsyncStorage.setItem(`miba_chat_last_read_${id}`, new Date().toISOString());
  }, [id]);

  useEffect(() => {
    setLoading(true);
    fetchInitial().finally(() => { setLoading(false); markRead(); });
  }, [fetchInitial, markRead]);

  // Detect Mipo DM and fetch other user's name for header
  useEffect(() => {
    if (!id || !user) return;
    supabase
      .from('mipo_dm_activities')
      .select('user_a_id, user_b_id')
      .eq('activity_id', id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) {
          setIsMipoDm(false);
          setOtherUserName(null);
          return;
        }
        setIsMipoDm(true);
        const otherId = data.user_a_id === user.id ? data.user_b_id : data.user_a_id;
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', otherId).single();
        setOtherUserName(profile?.full_name ?? 'Someone');
      });
  }, [id, user]);

  // Fetch location shares and subscribe to realtime
  const fetchLocationShares = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('chat_location_shares')
      .select('activity_id, user_id, lat, lng, updated_at')
      .eq('activity_id', id);
    const rows = (data ?? []) as { activity_id: string; user_id: string; lat: number; lng: number; updated_at: string }[];
    if (rows.length === 0) {
      setLocationShares([]);
      return;
    }
    const userIds = [...new Set(rows.map(r => r.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds);
    const profileMap = new Map((profiles ?? []).map((p: { id: string; full_name: string }) => [p.id, { full_name: p.full_name }]));
    setLocationShares(rows.map(r => ({
      ...r,
      profile: profileMap.get(r.user_id) ?? null,
    })));
  }, [id]);

  useEffect(() => {
    if (!id || !isMipoDm) return;
    fetchLocationShares();
    const channel = supabase
      .channel(`chat-location-shares-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chat_location_shares', filter: `activity_id=eq.${id}` },
        () => fetchLocationShares()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, isMipoDm, fetchLocationShares]);

  // Location polling when sharing
  useEffect(() => {
    if (!id || !user || !sharingLocation) return;
    const poll = async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await supabase
          .from('chat_location_shares')
          .update({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            updated_at: new Date().toISOString(),
          })
          .eq('activity_id', id)
          .eq('user_id', user.id);
      } catch {}
    };
    poll();
    locationPollRef.current = setInterval(poll, 8000);
    return () => {
      if (locationPollRef.current) {
        clearInterval(locationPollRef.current);
        locationPollRef.current = null;
      }
    };
  }, [id, user, sharingLocation]);

  const handleShareLocation = useCallback(async () => {
    if (!id || !user) return;
    const granted = await requestLocationPermission();
    if (!granted) {
      Alert.alert('Location required', 'Please enable location access to share your live location.');
      return;
    }
    setShareLocationLoading(true);
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { error } = await supabase.from('chat_location_shares').insert({
        activity_id: id,
        user_id: user.id,
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSharingLocation(true);
    } catch (e) {
      Alert.alert('Error', (e as Error).message ?? 'Could not share location.');
    } finally {
      setShareLocationLoading(false);
    }
  }, [id, user]);

  const handleStopLocation = useCallback(async () => {
    if (!id || !user) return;
    const { error } = await supabase
      .from('chat_location_shares')
      .delete()
      .eq('activity_id', id)
      .eq('user_id', user.id);
    if (!error) setSharingLocation(false);
  }, [id, user]);

  // Sync sharingLocation with locationShares
  useEffect(() => {
    if (user && locationShares.some(s => s.user_id === user.id)) {
      setSharingLocation(true);
    } else {
      setSharingLocation(false);
    }
  }, [user, locationShares]);

  // Scroll to bottom when messages load or a new one arrives
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [loading]);

  // Real-time subscription
  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`activity-chat-${id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `activity_id=eq.${id}` },
        async (payload) => {
          const { data } = await supabase
            .from('messages')
            .select('*, profile:profiles(id, full_name, avatar_url)')
            .eq('id', (payload.new as Message).id)
            .single();
          if (data) {
            setMessages(prev => [...prev, data as Message]);
            setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
            markRead();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `activity_id=eq.${id}` },
        (payload) => {
          // System messages can be updated in-place when edits are merged.
          setMessages(prev =>
            prev.map(m => m.id === (payload.new as Message).id ? { ...m, ...(payload.new as Message) } : m)
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `activity_id=eq.${id}` },
        (payload) => {
          setMessages(prev => prev.filter(m => m.id !== (payload.old as Message).id));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || !user || !id) return;
    try {
      setSending(true);
      setText('');
      const { error } = await supabase.from('messages').insert({
        activity_id: id,
        user_id: user.id,
        content,
      });
      if (error) {
        setText(content);
        Alert.alert('Could not send', error.message ?? 'Please try again.');
      }
    } catch (e: any) {
      setText(content);
      Alert.alert('Could not send', (e as any)?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const STATUS_LABELS: Record<string, string> = {
    pending: 'Invited', in: "I'm in!", out: "Can't go", maybe: 'Maybe',
    hosting: 'Hosting', // legacy: old rsvp_changed messages
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    if (item.type === 'system') {
      if (item.content === 'event_edited') {
        return (
          <TouchableOpacity
            style={styles.systemPillWrapper}
            onPress={() => router.push(`/(app)/activity/${id}/edit-changes?messageId=${item.id}${fromTab ? `&fromTab=${encodeURIComponent(fromTab)}` : ''}`)}
            activeOpacity={0.7}
          >
            <View style={styles.systemPill}>
              <Ionicons name="pencil-outline" size={13} color={Colors.textSecondary} />
              <Text style={styles.systemPillText}>Host edited the event</Text>
              <Ionicons name="chevron-forward" size={13} color={Colors.textSecondary} />
            </View>
            <Text style={styles.systemPillTimestamp}>{formatMessageTime(item.created_at)}</Text>
          </TouchableOpacity>
        );
      }
      if (item.content === 'edit_suggestion') {
        const meta = item.metadata as EditSuggestionMetadata | null;
        const parts: string[] = [];
        if (meta?.suggested_time) {
          const d = new Date(meta.suggested_time);
          parts.push(`${format(d, 'h:mm a')}?`);
        }
        if (meta?.suggested_location) {
          const parsed = parseLocation(meta.suggested_location);
          parts.push(parsed?.address ?? meta.suggested_location);
        }
        const text = parts.length > 0
          ? `${parts.join(' · ')}${meta?.note ? ` · ${meta.note}` : ''}`
          : meta?.note ?? 'suggested a change';
        const name = item.profile?.full_name ?? 'Someone';
        return (
          <View style={styles.systemPillWrapper}>
            <View style={styles.systemPill}>
              <Ionicons name="create-outline" size={13} color={Colors.textSecondary} />
              <Text style={styles.systemPillText}>{name} suggested: {text}</Text>
            </View>
            <Text style={styles.systemPillTimestamp}>{formatMessageTime(item.created_at)}</Text>
          </View>
        );
      }
      if (item.content === 'rsvp_changed') {
        const meta = item.metadata as { old_status?: string; new_status?: string; changed_user_id?: string } | null;
        const oldLabel = meta?.old_status ? STATUS_LABELS[meta.old_status] ?? meta.old_status : '?';
        const newLabel = meta?.new_status ? STATUS_LABELS[meta.new_status] ?? meta.new_status : '?';
        const name = item.profile?.full_name ?? 'Someone';
        const text = meta?.changed_user_id && meta.changed_user_id !== item.user_id
          ? `Host changed someone's status to '${newLabel}'`
          : `${name} changed their status to '${newLabel}'`;
        return (
          <View style={styles.systemPillWrapper}>
            <View style={styles.systemPill}>
              <Ionicons name="people-outline" size={13} color={Colors.textSecondary} />
              <Text style={styles.systemPillText}>{text}</Text>
            </View>
            <Text style={styles.systemPillTimestamp}>{formatMessageTime(item.created_at)}</Text>
          </View>
        );
      }
      if (item.content === 'location_share_started') {
        const name = item.profile?.full_name ?? 'Someone';
        return (
          <View style={styles.systemPillWrapper}>
            <View style={styles.systemPill}>
              <Ionicons name="location-outline" size={13} color={Colors.textSecondary} />
              <Text style={styles.systemPillText}>{name} started showing live location</Text>
            </View>
            <Text style={styles.systemPillTimestamp}>{formatMessageTime(item.created_at)}</Text>
          </View>
        );
      }
      if (item.content === 'location_share_stopped') {
        const name = item.profile?.full_name ?? 'Someone';
        return (
          <View style={styles.systemPillWrapper}>
            <View style={styles.systemPill}>
              <Ionicons name="location-outline" size={13} color={Colors.textSecondary} />
              <Text style={styles.systemPillText}>{name} stopped showing live location</Text>
            </View>
            <Text style={styles.systemPillTimestamp}>{formatMessageTime(item.created_at)}</Text>
          </View>
        );
      }
      return null;
    }

    const isMe = item.user_id === user?.id;
    const prev = index > 0 ? messages[index - 1] : null;
    const showHeader = !prev || prev.user_id !== item.user_id || prev.type === 'system';

    return (
      <View style={[styles.msgWrapper, isMe ? styles.msgWrapperMe : styles.msgWrapperThem]}>
        {!isMe && (
          <View style={styles.avatarCol}>
            {showHeader
              ? <Avatar uri={item.profile?.avatar_url} name={item.profile?.full_name} size={32} />
              : <View style={{ width: 32 }} />
            }
          </View>
        )}
        <View style={[styles.msgGroup, isMe ? styles.msgGroupMe : styles.msgGroupThem]}>
          {showHeader && !isMe && (
            <Text style={styles.senderName}>
              {item.profile?.full_name ?? 'Someone'}
            </Text>
          )}
          <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
            <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
          </View>
          {showHeader && (
            <Text style={[styles.timestamp, isMe && styles.timestampMe]}>
              {formatMessageTime(item.created_at)}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const showMap = isMipoDm && locationShares.length > 0 && Platform.OS !== 'web';
  showMapRef.current = showMap;
  const mapRegion = locationShares.length >= 2
    ? {
        latitude: locationShares.reduce((s, x) => s + x.lat, 0) / locationShares.length,
        longitude: locationShares.reduce((s, x) => s + x.lng, 0) / locationShares.length,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }
    : locationShares.length === 1
      ? { latitude: locationShares[0].lat, longitude: locationShares[0].lng, latitudeDelta: 0.01, longitudeDelta: 0.01 }
      : null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader
        title={isMipoDm ? `Chat with ${otherUserName ?? 'Someone'}` : (activityTitle || 'Chat')}
        subtitle={isMipoDm ? undefined : 'Group chat'}
        showBack
        onTitlePress={!isMipoDm && id ? () => router.push(`/(app)/activity/${id}?fromTab=${encodeURIComponent(fromTab ?? 'chats')}`) : undefined}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubble-outline" size={48} color={Colors.border} />
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptySubtitle}>Be the first to say something!</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {isMipoDm && (
        <View style={styles.locationSection}>
          {sharingLocation ? (
            <TouchableOpacity style={styles.locationBtn} onPress={handleStopLocation}>
              <Ionicons name="location" size={18} color={Colors.danger} />
              <Text style={styles.locationBtnText}>Stop showing location</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.locationBtn}
              onPress={handleShareLocation}
              disabled={shareLocationLoading}
            >
              {shareLocationLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <>
                  <Ionicons name="location-outline" size={18} color={Colors.primary} />
                  <Text style={[styles.locationBtnText, styles.locationBtnTextPrimary]}>Share live location</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}

      {showMap && mapRegion && (
        <View style={[styles.mapContainer, keyboardVisible && styles.mapContainerKeyboard]}>
          <MapErrorBoundary
            fallback={
              <View style={styles.mapFallback}>
                <Ionicons name="map-outline" size={32} color={Colors.textSecondary} />
                <Text style={styles.mapFallbackText}>Map unavailable</Text>
              </View>
            }
          >
            <MapView
              key={locationShares.map(s => s.user_id).sort().join(',')}
              style={styles.map}
              initialRegion={mapRegion}
            >
              {locationShares.map(s => (
                <Marker
                  key={s.user_id}
                  coordinate={{ latitude: s.lat, longitude: s.lng }}
                  title={s.user_id === user?.id ? 'You' : (s.profile?.full_name ?? 'Friend')}
                />
              ))}
            </MapView>
          </MapErrorBoundary>
        </View>
      )}

      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor={Colors.textSecondary}
          multiline
          maxLength={1000}
          returnKeyType="default"
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
          activeOpacity={0.8}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Ionicons name="send" size={18} color="#fff" />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginTop: 8 },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary },

  messageList: { padding: 16, gap: 2, paddingBottom: 8 },

  msgWrapper: { flexDirection: 'row', marginBottom: 2, alignItems: 'flex-end' },
  msgWrapperMe: { justifyContent: 'flex-end' },
  msgWrapperThem: { justifyContent: 'flex-start' },

  avatarCol: { marginRight: 6, alignSelf: 'flex-end' },

  msgGroup: { maxWidth: '75%' },
  msgGroupMe: { alignItems: 'flex-end' },
  msgGroupThem: { alignItems: 'flex-start' },

  senderName: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 3, marginLeft: 4 },

  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  bubbleMe: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleThem: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderBottomLeftRadius: 4,
  },
  bubbleText: { fontSize: 15, color: Colors.text, lineHeight: 21 },
  bubbleTextMe: { color: '#fff' },

  timestamp: { fontSize: 11, color: Colors.textSecondary, marginTop: 3, marginLeft: 4 },
  timestampMe: { marginRight: 4, marginLeft: 0 },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 22, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, color: Colors.text,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.border },

  systemPillWrapper: { alignItems: 'center', marginVertical: 10, gap: 4 },
  systemPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.borderLight,
    borderRadius: 20,
  },
  systemPillText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  systemPillTimestamp: { fontSize: 11, color: Colors.textSecondary },

  locationSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  locationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationBtnText: { fontSize: 15, color: Colors.textSecondary, fontWeight: '600' },
  locationBtnTextPrimary: { color: Colors.primary },
  mapContainer: { height: 200, backgroundColor: Colors.borderLight },
  mapContainerKeyboard: { height: 100 },
  map: { flex: 1, width: '100%' },
  mapFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.borderLight,
    gap: 8,
  },
  mapFallbackText: { fontSize: 14, color: Colors.textSecondary },
});
