import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import type { Activity } from '@/lib/types';

export async function enrichWithSeenStatus(
  acts: Activity[],
  userId: string
): Promise<Activity[]> {
  if (acts.length === 0) return acts;

  const keys = acts.map(a => `miba_activity_last_seen_${a.id}`);
  const pairs = await AsyncStorage.multiGet(keys);
  const lastSeenMap: Record<string, string | null> = {};
  pairs.forEach(([key, value]) => {
    const actId = key.replace('miba_activity_last_seen_', '');
    lastSeenMap[actId] = value;
  });

  const seenIds = acts.filter(a => lastSeenMap[a.id] != null).map(a => a.id);
  const latestMsgMap: Record<string, string> = {};

  if (seenIds.length > 0) {
    try {
      const { data: msgData } = await supabase
        .from('messages')
        .select('activity_id, created_at')
        .in('activity_id', seenIds)
        .neq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500);

      (msgData ?? []).forEach((m: { activity_id: string; created_at: string }) => {
        if (!latestMsgMap[m.activity_id]) {
          latestMsgMap[m.activity_id] = m.created_at;
        }
      });
    } catch {
      // non-critical
    }
  }

  return acts.map(a => {
    const lastSeen = lastSeenMap[a.id];
    const latestMsg = latestMsgMap[a.id];
    const hasNew = !!latestMsg && !!lastSeen && latestMsg > lastSeen;
    return {
      ...a,
      is_new: lastSeen == null,
      has_new_messages: hasNew,
      latest_message_at: hasNew ? latestMsg : undefined,
    };
  });
}
