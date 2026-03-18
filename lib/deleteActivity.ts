/**
 * Delete an activity and all related data.
 * Stops live location sharing for the current user if they are sharing on this activity.
 * Database cascade handles: rsvps, posts, post_comments, messages, chat_location_shares,
 * activity_exclusions, mipo_dm_activities, activity_push_notifications.
 */
import { supabase } from '@/lib/supabase';
import { turnOffLiveLocationPost } from '@/lib/liveLocationPost';

export async function deleteActivity(activityId: string, userId: string) {
  // Stop live location if current user is sharing on this activity
  const { data: activePosts } = await supabase
    .from('posts')
    .select('id')
    .eq('activity_id', activityId)
    .eq('user_id', userId)
    .eq('post_type', 'live_location')
    .is('chat_closed_at', null);

  for (const post of activePosts ?? []) {
    try {
      await turnOffLiveLocationPost(post.id, userId);
    } catch {
      // Best effort; cascade will clean up DB
    }
  }

  const { error } = await supabase.from('activities').delete().eq('id', activityId);
  return { error: error ?? null };
}
