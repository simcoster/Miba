import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Mark all updates for an activity as seen/dismissed.
 * Clears: new invite, new messages, RSVP changes from the updates feed.
 */
export async function markUpdatesAsSeen(activityId: string): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    AsyncStorage.setItem(`miba_activity_last_seen_${activityId}`, now),
    AsyncStorage.setItem(`miba_chat_last_read_${activityId}`, now),
    AsyncStorage.setItem(`miba_rsvp_changes_seen_${activityId}`, now),
  ]);
}
