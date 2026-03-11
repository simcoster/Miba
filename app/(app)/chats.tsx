import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import Colors from '@/constants/Colors';

type ChatItem = {
  activityId: string;
  title: string;
  subtitle: string;
  lastMessageAt: string;
  isMipoDm: boolean;
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
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [chats, setChats] = useState<ChatItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

    const { data: messages } = await supabase
      .from('messages')
      .select('activity_id, content, type, created_at')
      .in('activity_id', activityIds)
      .order('created_at', { ascending: false });

    const latestByActivity = new Map<string, { content: string; type: string; created_at: string }>();
    for (const m of messages ?? []) {
      if (!latestByActivity.has(m.activity_id)) {
        latestByActivity.set(m.activity_id, m);
      }
    }
    const activityIdsWithMessages = [...latestByActivity.keys()];
    if (activityIdsWithMessages.length === 0) {
      setChats([]);
      return;
    }

    const [activitiesRes, mipoDmsRes] = await Promise.all([
      supabase.from('activities').select('id, title').in('id', activityIdsWithMessages),
      supabase
        .from('mipo_dm_activities')
        .select('activity_id, user_a_id, user_b_id')
        .in('activity_id', activityIdsWithMessages),
    ]);

    const activities = new Map((activitiesRes.data ?? []).map((a: { id: string; title: string }) => [a.id, a]));
    const mipoDms = new Map((mipoDmsRes.data ?? []).map((d: { activity_id: string; user_a_id: string; user_b_id: string }) => [d.activity_id, d]));

    const otherUserIds = new Set<string>();
    for (const dm of mipoDms.values()) {
      otherUserIds.add(dm.user_a_id === user.id ? dm.user_b_id : dm.user_a_id);
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', [...otherUserIds]);
    const profileMap = new Map((profiles ?? []).map((p: { id: string; full_name: string | null; avatar_url: string | null }) => [p.id, p]));

    const items: ChatItem[] = activityIdsWithMessages.map((aid) => {
      const activity = activities.get(aid);
      const latest = latestByActivity.get(aid);
      const dm = mipoDms.get(aid);
      const otherProfile = dm ? profileMap.get(dm.user_a_id === user.id ? dm.user_b_id : dm.user_a_id) : null;
      const displayTitle = dm
        ? `Chat with ${otherProfile?.full_name ?? 'Someone'}`
        : (activity?.title ?? 'Chat');
      const subtitle = formatLastMessage(latest ? { type: latest.type, content: latest.content } : null);
      const truncatedSubtitle = subtitle.length > 60 ? `${subtitle.slice(0, 57)}...` : subtitle;

      return {
        activityId: aid,
        title: displayTitle,
        subtitle: truncatedSubtitle,
        lastMessageAt: latest?.created_at ?? '',
        isMipoDm: !!dm,
        avatarUri: dm ? otherProfile?.avatar_url : undefined,
        avatarName: dm ? (otherProfile?.full_name ?? 'Someone') : undefined,
      };
    });

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

  const renderItem = ({ item }: { item: ChatItem }) => (
    <TouchableOpacity
      style={styles.chatRow}
      activeOpacity={0.7}
      onPress={() => router.push(`/(app)/activity/${item.activityId}/chat`)}
    >
      <Avatar
        uri={item.avatarUri}
        name={item.avatarName ?? item.title}
        size={52}
      />
      <View style={styles.chatContent}>
        <View style={styles.chatHeader}>
          <Text style={styles.chatTitle} numberOfLines={1}>{item.title}</Text>
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
      <ScreenHeader title="Chats" subtitle="Mipo & event conversations" />
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : chats.length === 0 ? (
        <EmptyState
          emoji="💬"
          title="No chats yet"
          subtitle="Start a conversation from Mipo or open an event chat."
        />
      ) : (
        <FlatList
          data={chats}
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
  listContent: { paddingHorizontal: 20, paddingVertical: 12 },
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
