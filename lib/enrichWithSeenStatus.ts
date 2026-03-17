import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import type { Activity } from '@/lib/types';

export async function enrichWithSeenStatus(
  acts: Activity[],
  userId: string
): Promise<Activity[]> {
  if (acts.length === 0) return acts;

  const actIds = acts.map((a) => a.id);
  const keys = actIds.map((a) => `miba_activity_last_seen_${a}`);
  const pairs = await AsyncStorage.multiGet(keys);
  const lastSeenMap: Record<string, string | null> = {};
  pairs.forEach(([key, value]) => {
    const actId = key.replace('miba_activity_last_seen_', '');
    lastSeenMap[actId] = value;
  });

  // Board read (for normal events) vs chat read (for Mipo)
  const boardKeys = actIds.map((a) => `miba_board_last_read_${a}`);
  const boardPairs = await AsyncStorage.multiGet(boardKeys);
  const boardLastReadMap: Record<string, string | null> = {};
  boardPairs.forEach(([key, value]) => {
    const actId = key.replace('miba_board_last_read_', '');
    boardLastReadMap[actId] = value;
  });

  const chatKeys = actIds.map((a) => `miba_chat_last_read_${a}`);
  const chatPairs = await AsyncStorage.multiGet(chatKeys);
  const chatLastReadMap: Record<string, string | null> = {};
  chatPairs.forEach(([key, value]) => {
    const actId = key.replace('miba_chat_last_read_', '');
    chatLastReadMap[actId] = value;
  });

  // Which activities are Mipo DMs?
  const { data: mipoDms } = await supabase
    .from('mipo_dm_activities')
    .select('activity_id')
    .in('activity_id', actIds);
  const mipoActivityIds = new Set((mipoDms ?? []).map((d: { activity_id: string }) => d.activity_id));
  const normalActivityIds = actIds.filter((id) => !mipoActivityIds.has(id));

  const latestMsgMap: Record<string, string> = {};
  const latestPostMap: Record<string, string> = {};

  if (mipoActivityIds.size > 0) {
    try {
      const { data: msgData } = await supabase
        .from('messages')
        .select('activity_id, created_at')
        .in('activity_id', [...mipoActivityIds])
        .neq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500);
      (msgData ?? []).forEach((m: { activity_id: string; created_at: string }) => {
        if (!latestMsgMap[m.activity_id]) latestMsgMap[m.activity_id] = m.created_at;
      });
    } catch {
      // non-critical
    }
  }

  if (normalActivityIds.length > 0) {
    try {
      const [postsRes, commentsRes] = await Promise.all([
        supabase
          .from('posts')
          .select('activity_id, created_at')
          .in('activity_id', normalActivityIds)
          .neq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('post_comments')
          .select('activity_id, created_at')
          .in('activity_id', normalActivityIds)
          .neq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(500),
      ]);
      const allItems: { activity_id: string; created_at: string }[] = [
        ...(postsRes.data ?? []),
        ...(commentsRes.data ?? []),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      allItems.forEach((item) => {
        if (!latestPostMap[item.activity_id]) latestPostMap[item.activity_id] = item.created_at;
      });
    } catch {
      // non-critical
    }
  }

  return acts.map((a) => {
    const lastSeen = lastSeenMap[a.id];
    const isMipo = mipoActivityIds.has(a.id);
    const latestMsg = isMipo ? latestMsgMap[a.id] : latestPostMap[a.id];
    const lastRead = isMipo ? chatLastReadMap[a.id] : boardLastReadMap[a.id];
    const since = lastRead ?? lastSeen ?? '1970-01-01T00:00:00Z';
    const hasNew = !!latestMsg && latestMsg > since;
    return {
      ...a,
      is_new: lastSeen == null,
      has_new_messages: hasNew,
      latest_message_at: hasNew ? latestMsg : undefined,
    };
  });
}
