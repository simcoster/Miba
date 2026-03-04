import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import Colors from '@/constants/Colors';

function formatMessageTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, h:mm a');
}

export default function ActivityChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const insets = useSafeAreaInsets();

  const [activityTitle, setActivityTitle] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList>(null);

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
    pending: 'Invited', in: "I'm in!", out: "Can't go", maybe: 'Maybe', hosting: 'Hosting',
  };

  const renderMessage = ({ item, index }: { item: Message; index: number }) => {
    if (item.type === 'system') {
      if (item.content === 'event_edited') {
        return (
          <TouchableOpacity
            style={styles.systemPillWrapper}
            onPress={() => router.push(`/(app)/activity/${id}/edit-changes?messageId=${item.id}`)}
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
          parts.push(meta.suggested_location);
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
          ? `Host changed someone's status to ${newLabel}`
          : `${name} changed their status '${oldLabel} → ${newLabel}'`;
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

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <ScreenHeader title={activityTitle || 'Chat'} subtitle="Group chat" showBack />

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
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
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
});
