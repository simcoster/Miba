import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Avatar';
import Colors from '@/constants/Colors';
import { parseLocation } from '@/lib/locationUtils';
import type { RsvpStatus } from '@/lib/types';
import type { RsvpChangeMetadata } from '@/lib/postRsvpChangeMessage';
import type { EditSuggestionMetadata } from '@/lib/types';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const DISMISSED_KEY = (id: string) => `miba_activity_updates_dismissed_${id}`;

type SystemMessage = {
  id: string;
  user_id: string;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  profile?: { id: string; full_name: string | null; avatar_url: string | null };
};

type UpdateItem = {
  id: string;
  userId: string;
  userName: string;
  avatarUrl: string | null;
  text: string;
  createdAt: string;
  messageId?: string;
  isEventEdit?: boolean;
};

const STATUS_LABELS: Record<RsvpStatus, string> = {
  pending: 'Invited',
  in: "I'm in!",
  out: "Can't go",
  maybe: 'Maybe',
};
// Legacy: old rsvp_changed messages may have 'hosting' in metadata
const STATUS_LABEL = (s: string) => STATUS_LABELS[s as RsvpStatus] ?? (s === 'hosting' ? 'Hosting' : s);

function formatUpdateTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return `Yesterday ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d, h:mm a');
}

export function ActivityUpdatesFeed({ activityId, hostId }: { activityId: string; hostId: string | null }) {
  const router = useRouter();
  const [updates, setUpdates] = useState<UpdateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const fetchUpdates = useCallback(async () => {
    const { data, error } = await supabase
      .from('messages')
      .select('id, user_id, content, metadata, created_at, profile:profiles(id, full_name, avatar_url)')
      .eq('activity_id', activityId)
      .eq('type', 'system')
      .in('content', ['event_edited', 'rsvp_changed', 'edit_suggestion'])
      .order('created_at', { ascending: false }) as { data: SystemMessage[] | null; error: unknown };

    if (error || !data) {
      setLoading(false);
      return;
    }

    const items: UpdateItem[] = [];
    const seenByUserAndBucket = new Map<string, Set<number>>();

    for (const msg of data) {
      const bucket = Math.floor(new Date(msg.created_at).getTime() / THIRTY_MINUTES_MS) * THIRTY_MINUTES_MS;
      const key = `${msg.user_id}:${bucket}`;
      if (!seenByUserAndBucket.has(msg.user_id)) {
        seenByUserAndBucket.set(msg.user_id, new Set());
      }
      const buckets = seenByUserAndBucket.get(msg.user_id)!;
      if (buckets.has(bucket)) continue;
      buckets.add(bucket);

      const profile = msg.profile as { full_name: string | null; avatar_url: string | null } | undefined;
      const userName = profile?.full_name ?? 'Someone';
      const isHost = msg.user_id === hostId;

      if (msg.content === 'event_edited') {
        items.push({
          id: msg.id,
          userId: msg.user_id,
          userName: isHost ? 'Host' : userName,
          avatarUrl: profile?.avatar_url ?? null,
          text: 'changed event details',
          createdAt: msg.created_at,
          messageId: msg.id,
          isEventEdit: true,
        });
      } else if (msg.content === 'edit_suggestion') {
        const meta = msg.metadata as EditSuggestionMetadata | null;
        const parts: string[] = [];
        if (meta?.suggested_time) {
          const d = new Date(meta.suggested_time);
          parts.push(format(d, 'h:mm a'));
        }
        if (meta?.suggested_location) {
          const parsed = parseLocation(meta.suggested_location);
          parts.push(parsed?.address ?? meta.suggested_location);
        }
        const suggestionText = parts.length > 0
          ? `suggested ${parts.join(' · ')}${meta?.note ? ` · ${meta.note}` : ''}`
          : meta?.note ? `suggested: ${meta.note}` : 'suggested a change';
        items.push({
          id: msg.id,
          userId: msg.user_id,
          userName: isHost ? 'Host' : userName,
          avatarUrl: profile?.avatar_url ?? null,
          text: suggestionText,
          createdAt: msg.created_at,
        });
      } else if (msg.content === 'rsvp_changed') {
        const meta = msg.metadata as RsvpChangeMetadata | null;
        const oldLabel = meta?.old_status ? STATUS_LABEL(meta.old_status) : '?';
        const newLabel = meta?.new_status ? STATUS_LABEL(meta.new_status) : '?';
        const changedUserId = meta?.changed_user_id;
        let text: string;
        if (changedUserId && changedUserId !== msg.user_id) {
          text = `changed someone's status to ${newLabel}`;
        } else {
          text = `changed their status '${oldLabel} → ${newLabel}'`;
        }
        items.push({
          id: msg.id,
          userId: msg.user_id,
          userName: isHost && changedUserId ? 'Host' : userName,
          avatarUrl: profile?.avatar_url ?? null,
          text,
          createdAt: msg.created_at,
        });
      }
    }

    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const stored = await AsyncStorage.getItem(DISMISSED_KEY(activityId));
    const dismissed = new Set<string>(stored ? JSON.parse(stored) : []);
    setDismissedIds(dismissed);
    setUpdates(items.filter((i) => !dismissed.has(i.id)));
    setLoading(false);
  }, [activityId, hostId]);

  const handleDismiss = useCallback(
    async (item: UpdateItem) => {
      const next = new Set(dismissedIds);
      next.add(item.id);
      setDismissedIds(next);
      setUpdates((prev) => prev.filter((u) => u.id !== item.id));
      await AsyncStorage.setItem(DISMISSED_KEY(activityId), JSON.stringify([...next]));
    },
    [activityId, dismissedIds]
  );

  const handleSeenAll = useCallback(async () => {
    const allIds = new Set(dismissedIds);
    updates.forEach((u) => allIds.add(u.id));
    setDismissedIds(allIds);
    setUpdates([]);
    await AsyncStorage.setItem(DISMISSED_KEY(activityId), JSON.stringify([...allIds]));
  }, [activityId, dismissedIds, updates]);

  useEffect(() => {
    fetchUpdates();
  }, [fetchUpdates]);

  if (loading) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Updates</Text>
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={Colors.primary} />
        </View>
      </View>
    );
  }

  if (updates.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Updates</Text>
        <View style={styles.empty}>
          <Ionicons name="notifications-outline" size={24} color={Colors.border} />
          <Text style={styles.emptyText}>No updates yet</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Updates</Text>
        {updates.length > 0 && (
          <TouchableOpacity style={styles.seenAllBtn} onPress={handleSeenAll}>
            <Ionicons name="checkmark-done-outline" size={16} color={Colors.primary} />
            <Text style={styles.seenAllBtnText}>Seen all</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.feed}>
        {updates.map((item) => (
          <Swipeable
            key={item.id}
            renderLeftActions={() => (
              <TouchableOpacity
                style={styles.dismissAction}
                onPress={() => handleDismiss(item)}
              >
                <Ionicons name="checkmark-circle" size={24} color="#fff" />
                <Text style={styles.dismissActionText}>Dismiss</Text>
              </TouchableOpacity>
            )}
            renderRightActions={() => (
              <TouchableOpacity
                style={styles.dismissAction}
                onPress={() => handleDismiss(item)}
              >
                <Ionicons name="checkmark-circle" size={24} color="#fff" />
                <Text style={styles.dismissActionText}>Dismiss</Text>
              </TouchableOpacity>
            )}
            onSwipeableOpen={() => handleDismiss(item)}
            friction={2}
            leftThreshold={60}
            rightThreshold={60}
          >
            <TouchableOpacity
              style={styles.updateRow}
              onPress={item.isEventEdit && item.messageId
                ? () => router.push(`/(app)/activity/${activityId}/edit-changes?messageId=${item.messageId}`)
                : undefined}
              activeOpacity={item.isEventEdit ? 0.7 : 1}
              disabled={!item.isEventEdit}
            >
              <Avatar uri={item.avatarUrl} name={item.userName} size={36} />
              <View style={styles.updateContent}>
                <Text style={styles.updateText}>
                  <Text style={styles.updateName}>{item.userName} </Text>
                  {item.text}
                </Text>
                <Text style={styles.updateTime}>{formatUpdateTime(item.createdAt)}</Text>
              </View>
              {item.isEventEdit && (
                <Ionicons name="chevron-forward" size={16} color={Colors.textSecondary} />
              )}
            </TouchableOpacity>
          </Swipeable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 8, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  seenAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16,
    backgroundColor: Colors.accentLight,
  },
  seenAllBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  loading: { paddingVertical: 24, alignItems: 'center' },
  empty: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.borderLight,
  },
  emptyText: { fontSize: 14, color: Colors.textSecondary },
  feed: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  updateRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  updateContent: { flex: 1 },
  updateText: { fontSize: 14, color: Colors.text },
  updateName: { fontWeight: '600' },
  updateTime: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  dismissAction: {
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
    borderRadius: 14,
    gap: 4,
  },
  dismissActionText: { fontSize: 11, fontWeight: '600', color: '#fff' },
});
