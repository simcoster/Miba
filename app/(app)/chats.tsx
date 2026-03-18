import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useClearTabHighlightOnFocus } from '@/contexts/TabHighlightContext';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar } from '@/components/Avatar';
import { SplashArt } from '@/components/SplashArt';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import Colors from '@/constants/Colors';
import { getActivityCoverProps, hasActivityCover } from '@/lib/activityCover';
import type { SplashPreset } from '@/lib/splashArt';

type ChatItem = {
  activityId: string;
  title: string;
  subtitle: string;
  lastMessageAt: string;
  isMipoDm: boolean;
  isLiveLocation?: boolean;
  postId?: string;
  splashArt?: SplashPreset | null;
  placePhotoName?: string | null;
  avatarUri?: string | null;
  avatarName?: string | null;
};

function formatChatTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

function formatLastMessage(msg: { type: string; content: string } | null): string {
  if (!msg) return '';
  if (msg.type === 'user') return msg.content;
  switch (msg.content) {
    case 'event_edited': return 'Event was updated';
    case 'edit_suggestion': return 'Someone suggested a change';
    case 'rsvp_changed': return 'Status was updated';
    case 'location_share_started': return 'Live location shared';
    case 'location_share_stopped': return 'Location sharing stopped';
    default: return 'System message';
  }
}

export default function ChatsScreen() {
  useClearTabHighlightOnFocus();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'events' | 'mipo'>('events');

  const fetchChats = useCallback(async () => {
    if (!user) return;

    const { data: rsvps } = await supabase
      .from('rsvps')
      .select('activity_id')
      .eq('user_id', user.id);
    const activityIds = [...new Set((rsvps ?? []).map((r: { activity_id: string }) => r.activity_id))];
    if (activityIds.length === 0) {
      setChats([]);
      return;
    }

    const [messagesRes, postsRes, mipoDmsRes, liveLocationPostsRes] = await Promise.all([
      supabase
        .from('messages')
        .select('activity_id, content, type, created_at, post_id')
        .in('activity_id', activityIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('posts')
        .select('activity_id, content, created_at, post_type')
        .in('activity_id', activityIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('mipo_dm_activities')
        .select('activity_id, user_a_id, user_b_id')
        .in('activity_id', activityIds),
      supabase
        .from('posts')
        .select('id, activity_id, created_at')
        .in('activity_id', activityIds)
        .eq('post_type', 'live_location')
        .is('chat_closed_at', null),
    ]);

    const mipoDms = new Map(
      (mipoDmsRes.data ?? []).map((d: { activity_id: string; user_a_id: string; user_b_id: string }) => [
        d.activity_id,
        d,
      ])
    );
    const mipoActivityIds = new Set(mipoDms.keys());

    // Mipo: latest from messages (post_id IS NULL)
    const latestMessageByActivity = new Map<
      string,
      { content: string; type: string; created_at: string }
    >();
    for (const m of messagesRes.data ?? []) {
      if ((m as { post_id?: string | null }).post_id) continue;
      if (!latestMessageByActivity.has(m.activity_id)) {
        latestMessageByActivity.set(m.activity_id, m);
      }
    }

    // Events (board): latest from posts (text posts only, exclude live_location)
    const latestPostByActivity = new Map<string, { content: string; created_at: string }>();
    for (const p of postsRes.data ?? []) {
      if ((p as { post_type?: string }).post_type === 'live_location') continue;
      if (!latestPostByActivity.has(p.activity_id)) {
        latestPostByActivity.set(p.activity_id, p);
      }
    }

    // Live location posts: latest message per post
    const latestMessageByPostId = new Map<string, { content: string; type: string; created_at: string }>();
    for (const m of messagesRes.data ?? []) {
      const postId = (m as { post_id?: string | null }).post_id;
      if (!postId) continue;
      if (!latestMessageByPostId.has(postId)) {
        latestMessageByPostId.set(postId, m);
      }
    }

    const mipoItems: { activityId: string; subtitle: string; lastMessageAt: string }[] = [
      ...mipoActivityIds,
    ]
      .filter((aid) => latestMessageByActivity.has(aid))
      .map((aid) => {
        const latest = latestMessageByActivity.get(aid)!;
        return {
          activityId: aid,
          subtitle: formatLastMessage({ type: latest.type, content: latest.content }),
          lastMessageAt: latest.created_at,
        };
      });

    const eventItems: { activityId: string; subtitle: string; lastMessageAt: string }[] = [
      ...latestPostByActivity.keys(),
    ]
      .filter((aid) => !mipoActivityIds.has(aid))
      .map((aid) => {
        const latest = latestPostByActivity.get(aid)!;
        const preview =
          latest.content.length > 60 ? `${latest.content.slice(0, 57)}...` : latest.content;
        return {
          activityId: aid,
          subtitle: preview,
          lastMessageAt: latest.created_at,
        };
      });

    const liveLocationItems: { activityId: string; postId: string; subtitle: string; lastMessageAt: string }[] =
      (liveLocationPostsRes.data ?? []).map((p: { id: string; activity_id: string; created_at: string }) => {
        const latest = latestMessageByPostId.get(p.id);
        return {
          activityId: p.activity_id,
          postId: p.id,
          subtitle: latest ? formatLastMessage({ type: latest.type, content: latest.content }) : 'Live Location',
          lastMessageAt: latest?.created_at ?? p.created_at,
        };
      });

    const allActivityIds = [
      ...mipoItems.map((i) => i.activityId),
      ...eventItems.map((i) => i.activityId),
      ...liveLocationItems.map((i) => i.activityId),
    ];
    if (allActivityIds.length === 0) {
      setChats([]);
      return;
    }

    const otherUserIds = [...mipoDms.values()].map((d) =>
      d.user_a_id === user.id ? d.user_b_id : d.user_a_id
    );

    const [activitiesRes, profilesRes] = await Promise.all([
      supabase.from('activities').select('id, title, splash_art, place_photo_name').in('id', allActivityIds),
      supabase.from('profiles').select('id, full_name, avatar_url').in('id', otherUserIds),
    ]);

    const activities = new Map(
      (activitiesRes.data ?? []).map((a: { id: string; title: string; splash_art: string | null; place_photo_name: string | null }) => [
        a.id,
        a,
      ])
    );
    const profileMap = new Map(
      (profilesRes.data ?? []).map((p: { id: string; full_name: string | null; avatar_url: string | null }) => [
        p.id,
        p,
      ])
    );

    const mipoChatItems: ChatItem[] = mipoItems.map((i) => {
      const dm = mipoDms.get(i.activityId)!;
      const otherId = dm.user_a_id === user.id ? dm.user_b_id : dm.user_a_id;
      const profile = profileMap.get(otherId);
      const activity = activities.get(i.activityId);
      return {
        activityId: i.activityId,
        title: profile?.full_name ?? 'Someone',
        subtitle: i.subtitle.length > 60 ? `${i.subtitle.slice(0, 57)}...` : i.subtitle,
        lastMessageAt: i.lastMessageAt,
        isMipoDm: true,
        splashArt: undefined,
        avatarUri: profile?.avatar_url ?? null,
        avatarName: profile?.full_name ?? 'Someone',
      };
    });

    const eventChatItems: ChatItem[] = eventItems.map((i) => {
      const activity = activities.get(i.activityId);
      return {
        activityId: i.activityId,
        title: activity?.title ?? 'Event',
        subtitle: i.subtitle,
        lastMessageAt: i.lastMessageAt,
        isMipoDm: false,
        splashArt: activity?.splash_art as SplashPreset | null | undefined,
        placePhotoName: activity?.place_photo_name ?? undefined,
        avatarUri: undefined,
        avatarName: undefined,
      };
    });

    const liveLocationChatItems: ChatItem[] = liveLocationItems.map((i) => {
      const activity = activities.get(i.activityId);
      return {
        activityId: i.activityId,
        postId: i.postId,
        title: activity?.title ?? 'Event',
        subtitle: i.subtitle,
        lastMessageAt: i.lastMessageAt,
        isMipoDm: false,
        isLiveLocation: true,
        splashArt: activity?.splash_art as SplashPreset | null | undefined,
        placePhotoName: activity?.place_photo_name ?? undefined,
        avatarUri: undefined,
        avatarName: undefined,
      };
    });

    const items = [...mipoChatItems, ...eventChatItems, ...liveLocationChatItems];
    items.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
    setChats(items);
  }, [user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchChats();
    setRefreshing(false);
  }, [fetchChats]);

  useEffect(() => {
    setLoading(true);
    fetchChats().finally(() => setLoading(false));
  }, [fetchChats]);

  useFocusEffect(
    useCallback(() => {
      fetchChats();
    }, [fetchChats])
  );

  const eventChats = chats.filter(c => !c.isMipoDm);
  const mipoChats = chats.filter(c => c.isMipoDm);
  const visibleChats = activeTab === 'events' ? eventChats : mipoChats;

  const renderItem = ({ item }: { item: ChatItem }) => (
    <TouchableOpacity
      style={styles.chatRow}
      activeOpacity={0.7}
      onPress={() =>
        router.push(
          item.isMipoDm
            ? `/(app)/activity/${item.activityId}/chat?fromTab=chats`
            : item.isLiveLocation && item.postId
              ? `/(app)/activity/${item.activityId}/post-chat/${item.postId}?fromTab=chats`
              : `/(app)/activity/${item.activityId}/board?fromTab=chats`
        )
      }
    >
      {item.isLiveLocation ? (
        <View style={styles.liveLocationIcon}>
          <Ionicons name="location" size={28} color={Colors.primary} />
        </View>
      ) : hasActivityCover({ place_photo_name: item.placePhotoName, splash_art: item.splashArt }) ? (
        <View style={styles.splashCircle}>
          <SplashArt {...getActivityCoverProps({ place_photo_name: item.placePhotoName, splash_art: item.splashArt })!} height={52} opacity={1} />
        </View>
      ) : (
        <Avatar
          uri={item.avatarUri}
          name={item.avatarName ?? item.title}
          size={52}
        />
      )}
      <View style={styles.chatContent}>
        <View style={styles.chatHeader}>
          <View style={styles.chatTitleRow}>
            {item.isLiveLocation && (
              <Ionicons name="location" size={14} color={Colors.primary} style={styles.chatTitleIcon} />
            )}
            <Text style={styles.chatTitle} numberOfLines={1}>{item.isLiveLocation ? `${item.title} · Live Location` : item.title}</Text>
          </View>
          <Text style={styles.chatTime}>{formatChatTime(item.lastMessageAt)}</Text>
        </View>
        {item.subtitle ? (
          <Text style={styles.chatSubtitle} numberOfLines={2}>{item.subtitle}</Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.textSecondary} />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      <ScreenHeader title="Chats" subtitle="event discussions and chats" />

      <View style={styles.subTabRow}>
        <TouchableOpacity
          style={[styles.subTab, activeTab === 'events' && styles.subTabActive]}
          onPress={() => setActiveTab('events')}
        >
          <Text style={[styles.subTabText, activeTab === 'events' && styles.subTabTextActive]}>Events</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.subTab, activeTab === 'mipo' && styles.subTabActive]}
          onPress={() => setActiveTab('mipo')}
        >
          <Text style={[styles.subTabText, activeTab === 'mipo' && styles.subTabTextActive]}>Mipo</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : visibleChats.length === 0 ? (
        <EmptyState
          emoji="💬"
          title={activeTab === 'events' ? 'No event boards yet' : 'No Mipo conversations yet'}
          subtitle={activeTab === 'events' ? 'Open an event and start posting.' : 'Start a conversation from Mipo.'}
        />
      ) : (
        <FlatList
          data={visibleChats}
          keyExtractor={(item) => item.activityId}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  subTabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  subTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.borderLight,
  },
  subTabActive: { backgroundColor: Colors.primary },
  subTabText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  subTabTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: 20, paddingVertical: 12 },
  splashCircle: { width: 52, height: 52, borderRadius: 26, overflow: 'hidden', flexShrink: 0 },
  liveLocationIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  chatTitleRow: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  chatTitleIcon: { marginRight: 4 },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  chatContent: { flex: 1, marginLeft: 14, minWidth: 0 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  chatTitle: { fontSize: 16, fontWeight: '600', color: Colors.text, flex: 1 },
  chatTime: { fontSize: 12, color: Colors.textSecondary, marginLeft: 8 },
  chatSubtitle: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
});
