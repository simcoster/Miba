import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Keyboard,
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
import { useLocalSearchParams, useGlobalSearchParams, useRouter } from 'expo-router';
import { useMipo } from '@/contexts/MipoContext';
import { useSetTabHighlight } from '@/contexts/TabHighlightContext';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Message } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { requestLocationPermission, turnOffLocationSharingIfActiveWhenPermissionDenied } from '@/lib/mipoLocation';
import { turnOffLiveLocationPost, getLocationQuickThenAccurate } from '@/lib/liveLocationPost';
import { parseLocation } from '@/lib/locationUtils';
import { fetchPlaceDetails } from '@/lib/placesApi';
import * as Crypto from 'expo-crypto';
import Toast from 'react-native-toast-message';
import Colors from '@/constants/Colors';

type LocationShare = {
  activity_id: string;
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string;
  profile?: { full_name?: string; avatar_url?: string | null } | null;
};

function formatMessageTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, h:mm a');
}

function formatEndTime(dateStr: string): string {
  const d = new Date(dateStr);
  return isToday(d) ? format(d, 'h:mm a') : format(d, 'MMM d, h:mm a');
}

export default function PostChatScreen() {
  const localParams = useLocalSearchParams<{
    id: string;
    postId: string;
    fromTab?: string;
  }>();
  const globalParams = useGlobalSearchParams<{ fromTab?: string }>();
  const { id, postId } = localParams;
  const fromTab = localParams.fromTab ?? globalParams.fromTab;
  const { user } = useAuth();
  const { setVisible } = useMipo();
  useSetTabHighlight(fromTab ?? 'chats');
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [post, setPost] = useState<{
    id: string;
    activity_id: string;
    user_id: string;
    creator_expires_at: string | null;
    chat_closed_at: string | null;
  } | null>(null);
  const [activityTitle, setActivityTitle] = useState('');
  const [activityIsJoinMe, setActivityIsJoinMe] = useState(false);
  const [eventLocationCoords, setEventLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [locationShares, setLocationShares] = useState<LocationShare[]>([]);
  const [sharingLocation, setSharingLocation] = useState(false);
  const [shareLocationLoading, setShareLocationLoading] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [endingChat, setEndingChat] = useState(false);

  const listRef = useRef<FlatList>(null);
  const scrollOffsetRef = useRef(0);
  const showMapRef = useRef(false);
  const locationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasEverHadLocationSharesRef = useRef(false);
  const lastMapRegionRef = useRef<{
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  } | null>(null);

  const isExpired = !!post?.chat_closed_at;
  const isCreator = post?.user_id === user?.id;

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setKeyboardVisible(true);
        if (showMapRef.current) {
          const offset = scrollOffsetRef.current + 100;
          requestAnimationFrame(() => {
            listRef.current?.scrollToOffset({ offset, animated: true });
          });
        }
      }
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardVisible(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const fetchPostAndActivity = useCallback(async () => {
    if (!postId || !id) return;
    const { data: postData } = await supabase
      .from('posts')
      .select('id, activity_id, user_id, creator_expires_at, chat_closed_at')
      .eq('id', postId)
      .single();
    if (postData) setPost(postData);
    const { data: actData } = await supabase
      .from('activities')
      .select('title, is_join_me, location')
      .eq('id', id)
      .single();
    if (actData) {
      setActivityTitle(actData.title ?? '');
      setActivityIsJoinMe(!!actData.is_join_me);
      const parsed = parseLocation((actData as { location?: string | null }).location);
      if (parsed?.placeId) {
        const token = Crypto.randomUUID();
        const details = await fetchPlaceDetails(parsed.placeId, token);
        if (details?.location) {
          const address = details.formattedAddress || parsed.displayName || parsed.address || 'unknown';
          console.log('placed destination marker at', address);
          setEventLocationCoords({
            lat: details.location.latitude,
            lng: details.location.longitude,
          });
        } else {
          setEventLocationCoords(null);
        }
      } else {
        setEventLocationCoords(null);
      }
    } else {
      setEventLocationCoords(null);
    }
  }, [postId, id]);

  const fetchMessages = useCallback(async () => {
    if (!postId) return;
    const { data } = await supabase
      .from('messages')
      .select('*, profile:profiles(id, full_name, avatar_url)')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });
    setMessages((data ?? []) as Message[]);
  }, [postId]);

  const fetchLocationShares = useCallback(async () => {
    if (!postId) return;
    const { data } = await supabase
      .from('chat_location_shares')
      .select('activity_id, user_id, lat, lng, updated_at')
      .eq('post_id', postId);
    const rows = (data ?? []) as {
      activity_id: string;
      user_id: string;
      lat: number;
      lng: number;
      updated_at: string;
    }[];
    if (rows.length === 0) {
      setLocationShares([]);
      return;
    }
    const userIds = [...new Set(rows.map((r) => r.user_id))];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', userIds);
    const profileMap = new Map(
      (profiles ?? []).map(
        (p: { id: string; full_name: string; avatar_url: string | null }) => [
          p.id,
          { full_name: p.full_name, avatar_url: p.avatar_url },
        ]
      )
    );
    setLocationShares(
      rows.map((r) => ({
        ...r,
        profile: profileMap.get(r.user_id) ?? null,
      }))
    );
  }, [postId]);

  const fetchInitial = useCallback(async () => {
    await fetchPostAndActivity();
    await fetchMessages();
    await fetchLocationShares();
  }, [fetchPostAndActivity, fetchMessages, fetchLocationShares]);

  const markRead = useCallback(() => {
    if (postId)
      AsyncStorage.setItem(
        `miba_post_chat_last_read_${postId}`,
        new Date().toISOString()
      );
  }, [postId]);

  useEffect(() => {
    setLoading(true);
    fetchInitial().finally(() => {
      setLoading(false);
      markRead();
    });
  }, [fetchInitial, markRead]);

  useEffect(() => {
    if (!postId) return;
    fetchLocationShares();
    const channel = supabase
      .channel(`post-chat-location-${postId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_location_shares',
          filter: `post_id=eq.${postId}`,
        },
        () => fetchLocationShares()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, fetchLocationShares]);

  useEffect(() => {
    if (!postId || !user || !sharingLocation || !post) return;
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (stopped) return;
        await supabase
          .from('chat_location_shares')
          .update({
            lat: loc.coords.latitude,
            lng: loc.coords.longitude,
            updated_at: new Date().toISOString(),
          })
          .eq('post_id', postId)
          .eq('user_id', user.id);
      } catch (e) {
        if (stopped) return;
        stopped = true;
        console.warn('[PostChat] Location poll failed, stopping:', (e as Error).message);
        if (locationPollRef.current) {
          clearInterval(locationPollRef.current);
          locationPollRef.current = null;
        }
        if (post?.user_id === user.id) {
          await turnOffLiveLocationPost(postId, user.id, false);
        } else {
          await supabase
            .from('chat_location_shares')
            .delete()
            .eq('post_id', postId)
            .eq('user_id', user.id);
        }
        setPost((p) => (p ? { ...p } : null));
        setLocationShares((prev) => prev.filter((s) => s.user_id !== user.id));
        setSharingLocation(false);
        Toast.show({
          type: 'info',
          text1: 'Location sharing stopped',
          text2: 'Location was disabled. Enable it in Settings to share again.',
          visibilityTime: 4000,
        });
      }
    };
    poll();
    locationPollRef.current = setInterval(poll, 8000);
    return () => {
      stopped = true;
      if (locationPollRef.current) {
        clearInterval(locationPollRef.current);
        locationPollRef.current = null;
      }
    };
  }, [postId, user, sharingLocation, post]);

  useEffect(() => {
    if (!postId) return;
    const channel = supabase
      .channel(`post-chat-messages-${postId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `post_id=eq.${postId}`,
        },
        async (payload) => {
          const { data } = await supabase
            .from('messages')
            .select('*, profile:profiles(id, full_name, avatar_url)')
            .eq('id', (payload.new as Message).id)
            .single();
          if (data) {
            setMessages((prev) => [...prev, data as Message]);
            setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
            markRead();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `post_id=eq.${postId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === (payload.new as Message).id
                ? { ...m, ...(payload.new as Message) }
                : m
            )
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `post_id=eq.${postId}`,
        },
        (payload) => {
          setMessages((prev) =>
            prev.filter((m) => m.id !== (payload.old as Message).id)
          );
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [postId, markRead]);

  const handleShareLocation = useCallback(async () => {
    if (!postId || !user || !post) return;
    const granted = await requestLocationPermission();
    if (!granted) {
      const { turnedOffMipo, turnedOffLiveLocation } = await turnOffLocationSharingIfActiveWhenPermissionDenied(user.id, post.activity_id);
      if (turnedOffMipo || turnedOffLiveLocation) {
        if (turnedOffMipo) setVisible(false, null);
        if (turnedOffLiveLocation) {
          setPost((p) => (p ? { ...p, chat_closed_at: new Date().toISOString() } : null));
          setLocationShares((prev) => prev.filter((s) => s.user_id !== user.id));
          setSharingLocation(false);
        }
      } else {
        Toast.show({
          type: 'info',
          text1: 'Location required',
          text2: 'Location access was denied. Enable it in Settings to share your live location.',
          visibilityTime: 4000,
        });
      }
      return;
    }
    setShareLocationLoading(true);
    try {
      const loc = await getLocationQuickThenAccurate((highLoc) => {
        supabase
          .from('chat_location_shares')
          .update({
            lat: highLoc.coords.latitude,
            lng: highLoc.coords.longitude,
            updated_at: new Date().toISOString(),
          })
          .eq('post_id', postId)
          .eq('user_id', user.id);
      });
      if (!loc) throw new Error('Could not get your location.');
      const { error } = await supabase.from('chat_location_shares').insert({
        activity_id: post.activity_id,
        post_id: postId,
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
  }, [postId, user, post]);

  const handleEndChat = useCallback(async () => {
    if (!postId || !user || !isCreator || isExpired) return;
    Alert.alert(
      'End chat now?',
      'This will close the live location chat. No one will be able to send new messages.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End chat now',
          style: 'destructive',
          onPress: async () => {
            setEndingChat(true);
            try {
              await turnOffLiveLocationPost(postId, user.id);
              setPost((p) => (p ? { ...p, chat_closed_at: new Date().toISOString() } : null));
              setLocationShares((prev) => prev.filter((s) => s.user_id !== user.id));
              setSharingLocation(false);
            } catch (e) {
              Alert.alert('Error', (e as Error).message ?? 'Could not end chat.');
            } finally {
              setEndingChat(false);
            }
          },
        },
      ]
    );
  }, [postId, user, isCreator, isExpired]);

  const handleStopLocation = useCallback(async () => {
    if (!postId || !user) return;
    const { error } = await supabase
      .from('chat_location_shares')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id);
    if (!error) {
      setSharingLocation(false);
      setLocationShares((prev) => prev.filter((s) => s.user_id !== user.id));
    }
  }, [postId, user]);

  useEffect(() => {
    if (user && locationShares.some((s) => s.user_id === user.id)) {
      setSharingLocation(true);
    } else {
      setSharingLocation(false);
    }
  }, [user, locationShares]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
    }
  }, [loading]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || !user || !postId || !post || isExpired) return;
    try {
      setSending(true);
      setText('');
      const { error } = await supabase.from('messages').insert({
        activity_id: post.activity_id,
        post_id: postId,
        user_id: user.id,
        content,
      });
      if (error) {
        setText(content);
        Alert.alert('Could not send', error.message ?? 'Please try again.');
      }
    } catch (e: unknown) {
      setText(content);
      Alert.alert('Could not send', (e as Error)?.message ?? 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    if (item.type === 'system') {
      if (item.content === 'location_share_started') {
        const name = item.profile?.full_name ?? 'Someone';
        return (
          <View style={styles.systemPillWrapper}>
            <View style={styles.systemPill}>
              <Ionicons
                name="location-outline"
                size={13}
                color={Colors.textSecondary}
              />
              <Text style={styles.systemPillText}>
                {name} started showing live location
              </Text>
            </View>
            <Text style={styles.systemPillTimestamp}>
              {formatMessageTime(item.created_at)}
            </Text>
          </View>
        );
      }
      if (item.content === 'location_share_stopped') {
        const name = item.profile?.full_name ?? 'Someone';
        return (
          <View style={styles.systemPillWrapper}>
            <View style={styles.systemPill}>
              <Ionicons
                name="location-outline"
                size={13}
                color={Colors.textSecondary}
              />
              <Text style={styles.systemPillText}>
                {name} stopped showing live location
              </Text>
            </View>
            <Text style={styles.systemPillTimestamp}>
              {formatMessageTime(item.created_at)}
            </Text>
          </View>
        );
      }
      return null;
    }

    const isMe = item.user_id === user?.id;
    const prev = index > 0 ? messages[index - 1] : null;
    const showHeader =
      !prev || prev.user_id !== item.user_id || prev.type === 'system';

    return (
      <View
        style={[
          styles.msgWrapper,
          isMe ? styles.msgWrapperMe : styles.msgWrapperThem,
        ]}
      >
        {!isMe && (
          <View style={styles.avatarCol}>
            {showHeader ? (
              <Avatar
                uri={item.profile?.avatar_url}
                name={item.profile?.full_name}
                size={32}
              />
            ) : (
              <View style={{ width: 32 }} />
            )}
          </View>
        )}
        <View
          style={[
            styles.msgGroup,
            isMe ? styles.msgGroupMe : styles.msgGroupThem,
          ]}
        >
          {showHeader && !isMe && (
            <Text style={styles.senderName}>
              {item.profile?.full_name ?? 'Someone'}
            </Text>
          )}
          <View
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}
          >
            <Text
              style={[styles.bubbleText, isMe && styles.bubbleTextMe]}
            >
              {item.content}
            </Text>
          </View>
          {showHeader && (
            <Text
              style={[styles.timestamp, isMe && styles.timestampMe]}
            >
              {formatMessageTime(item.created_at)}
            </Text>
          )}
        </View>
      </View>
    );
  };

  const allPoints = [
    ...locationShares.map((s) => ({ lat: s.lat, lng: s.lng })),
    ...(eventLocationCoords ? [eventLocationCoords] : []),
  ];
  if (allPoints.length > 0) {
    hasEverHadLocationSharesRef.current = true;
    lastMapRegionRef.current =
      allPoints.length >= 2
        ? {
            latitude: allPoints.reduce((s, x) => s + x.lat, 0) / allPoints.length,
            longitude: allPoints.reduce((s, x) => s + x.lng, 0) / allPoints.length,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }
        : {
            latitude: allPoints[0].lat,
            longitude: allPoints[0].lng,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          };
  }
  const showMap =
    (locationShares.length > 0 || eventLocationCoords || hasEverHadLocationSharesRef.current) &&
    Platform.OS !== 'web';
  showMapRef.current = showMap;
  const mapRegion =
    allPoints.length > 0
      ? lastMapRegionRef.current
      : hasEverHadLocationSharesRef.current
        ? lastMapRegionRef.current
        : null;

  if (!post) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader
        title="Live Location"
        subtitle={isExpired ? 'Expired' : activityTitle || undefined}
        showBack
        rightActionPrefix={
          isCreator && !isExpired && post?.creator_expires_at ? (
            <Text style={styles.endTimeText}>
              chat will end at: {formatEndTime(post.creator_expires_at)}
            </Text>
          ) : undefined
        }
        rightAction={
          isCreator && !isExpired && !activityIsJoinMe
            ? {
                icon: 'close',
                label: 'End chat now',
                onPress: handleEndChat,
                loading: endingChat,
              }
            : undefined
        }
        onTitlePress={
          id
            ? () =>
                router.push(
                  `/(app)/activity/${id}?fromTab=${encodeURIComponent(
                    fromTab ?? 'chats'
                  )}`
                )
            : undefined
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="chatbubble-outline" size={48} color={Colors.border} />
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.emptySubtitle}>
            Be the first to say something!
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => {
            scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          onContentSizeChange={() =>
            listRef.current?.scrollToEnd({ animated: false })
          }
        />
      )}

      <View style={styles.locationSection}>
        {sharingLocation ? (
          <TouchableOpacity
            style={styles.locationBtn}
            onPress={handleStopLocation}
            disabled={isExpired}
          >
            <Ionicons name="location" size={18} color={Colors.danger} />
            <Text style={styles.locationBtnText}>Stop showing location</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.locationBtn, isExpired && styles.locationBtnDisabled]}
            onPress={handleShareLocation}
            disabled={shareLocationLoading || isExpired}
          >
            {shareLocationLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} />
            ) : (
              <>
                <Ionicons
                  name="location-outline"
                  size={18}
                  color={isExpired ? Colors.textSecondary : Colors.primary}
                />
                <Text
                  style={[
                    styles.locationBtnText,
                    !isExpired && styles.locationBtnTextPrimary,
                  ]}
                >
                  Share live location
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {showMap && mapRegion && (
        <View
          style={[
            styles.mapContainer,
            keyboardVisible && styles.mapContainerKeyboard,
          ]}
        >
          <MapErrorBoundary
            fallback={
              <View style={styles.mapFallback}>
                <Ionicons
                  name="map-outline"
                  size={32}
                  color={Colors.textSecondary}
                />
                <Text style={styles.mapFallbackText}>Map unavailable</Text>
              </View>
            }
          >
            <MapView
              key={[locationShares.map((s) => s.user_id).sort().join(','), eventLocationCoords ? 'event' : ''].join('|')}
              style={styles.map}
              initialRegion={mapRegion}
            >
              {eventLocationCoords && (
                <Marker
                  key="event"
                  coordinate={{ latitude: eventLocationCoords.lat, longitude: eventLocationCoords.lng }}
                  title={activityTitle || 'Event'}
                  pinColor="#E53935"
                />
              )}
              {locationShares.map((s) => (
                <Marker
                  key={s.user_id}
                  coordinate={{ latitude: s.lat, longitude: s.lng }}
                  title={
                    s.user_id === user?.id
                      ? 'You'
                      : (s.profile?.full_name ?? 'Friend')
                  }
                  image={
                    s.profile?.avatar_url
                      ? { uri: s.profile.avatar_url }
                      : undefined
                  }
                />
              ))}
            </MapView>
          </MapErrorBoundary>
        </View>
      )}

      <View
        style={[
          styles.inputBar,
          { paddingBottom: Math.max(insets.bottom, 10) },
        ]}
      >
        <TextInput
          style={[styles.input, isExpired && styles.inputDisabled]}
          value={text}
          onChangeText={setText}
          placeholder={isExpired ? 'Chat expired' : 'Message…'}
          placeholderTextColor={Colors.textSecondary}
          multiline
          maxLength={1000}
          returnKeyType="default"
          editable={!isExpired}
        />
        <TouchableOpacity
          style={[
            styles.sendBtn,
            (!text.trim() || sending || isExpired) && styles.sendBtnDisabled,
          ]}
          onPress={handleSend}
          disabled={!text.trim() || sending || isExpired}
          activeOpacity={0.8}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  endTimeText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'right' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
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

  senderName: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
    marginBottom: 3,
    marginLeft: 4,
  },

  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
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

  timestamp: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 3,
    marginLeft: 4,
  },
  timestampMe: { marginRight: 4, marginLeft: 0 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: Colors.text,
    maxHeight: 120,
  },
  inputDisabled: {
    backgroundColor: Colors.borderLight,
    color: Colors.textSecondary,
    opacity: 0.7,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.border },

  systemPillWrapper: {
    alignItems: 'center',
    marginVertical: 10,
    gap: 4,
  },
  systemPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    borderRadius: 20,
  },
  systemPillText: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
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
  locationBtnDisabled: { opacity: 0.6 },
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
