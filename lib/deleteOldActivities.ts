/**
 * Deletes the current user's activities older than 30 days (and their posters).
 * Call on app load when the user is authenticated.
 */
import { supabase } from '@/lib/supabase';
import { deleteActivity } from '@/lib/deleteActivity';

const MAX_AGE_DAYS = 30;

export async function deleteOldActivitiesForUser(userId: string): Promise<void> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_AGE_DAYS);
  const cutoffIso = cutoff.toISOString();

  const { data: oldActivities, error } = await supabase
    .from('activities')
    .select('id')
    .eq('created_by', userId)
    .lt('activity_time', cutoffIso);

  if (error || !oldActivities?.length) return;

  for (const a of oldActivities) {
    try {
      await deleteActivity(a.id, userId);
    } catch {
      // Best effort; continue with others
    }
  }
}
