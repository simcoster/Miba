/**
 * Delete an activity and all related data.
 * Also deletes the poster image from Supabase Storage if one exists.
 * Stops live location sharing for the current user if they are sharing on this activity.
 * Database cascade handles: rsvps, posts, post_comments, messages, chat_location_shares,
 * activity_exclusions, mipo_dm_activities, activity_push_notifications.
 */
import { supabase } from '@/lib/supabase';
import { turnOffLiveLocationPost } from '@/lib/liveLocationPost';

const POSTERS_BUCKET = 'posters';

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

  // Delete poster from storage only if the activity has one. Best effort; DB delete proceeds either way.
  const { data: activity } = await supabase
    .from('activities')
    .select('poster_image_url')
    .eq('id', activityId)
    .single();
  if (activity?.poster_image_url && String(activity.poster_image_url).trim()) {
    try {
      await supabase.storage.from(POSTERS_BUCKET).remove([`${activityId}.jpg`]);
    } catch {
      // Ignore; poster may already be gone
    }
  }

  const { error } = await supabase.from('activities').delete().eq('id', activityId);
  return { error: error ?? null };
}
