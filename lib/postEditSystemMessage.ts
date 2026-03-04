import { supabase } from '@/lib/supabase';
import type { EditableFields, EditMetadata } from '@/lib/types';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/**
 * After a successful activity edit, insert a system message into the chat
 * summarising what changed, or merge into an existing system message if one
 * was created within the last 30 minutes by the same user.
 */
export async function postEditSystemMessage(
  activityId: string,
  userId: string,
  oldValues: EditableFields,
  newValues: EditableFields,
): Promise<void> {
  // Compute which fields actually changed.
  // activity_time needs semantic comparison: Supabase returns "+00:00" suffix while
  // toISOString() produces "Z", so the same instant would look like a string diff.
  const isSameValue = (key: keyof EditableFields, a: string | null, b: string | null): boolean => {
    if (a === b) return true;
    if (key === 'activity_time' && a && b) {
      return new Date(a).getTime() === new Date(b).getTime();
    }
    return false;
  };

  const changedOriginal: Partial<EditableFields> = {};
  const changedCurrent: Partial<EditableFields> = {};

  (Object.keys(oldValues) as (keyof EditableFields)[]).forEach((key) => {
    if (!isSameValue(key, oldValues[key], newValues[key])) {
      (changedOriginal as any)[key] = oldValues[key];
      (changedCurrent as any)[key] = newValues[key];
    }
  });

  if (Object.keys(changedOriginal).length === 0) return;

  // Look for the most recent system message by this user on this activity.
  const cutoff = new Date(Date.now() - THIRTY_MINUTES_MS).toISOString();
  const { data: existing } = await supabase
    .from('messages')
    .select('id, metadata, created_at')
    .eq('activity_id', activityId)
    .eq('user_id', userId)
    .eq('type', 'system')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    // Merge: keep the original "from" values from the first edit in this batch,
    // update the "to" values with the latest ones.
    const prev = (existing.metadata ?? {}) as EditMetadata;
    const mergedOriginal: Partial<EditableFields> = { ...changedOriginal, ...prev.original_values };
    const mergedCurrent: Partial<EditableFields> = { ...prev.current_values, ...changedCurrent };

    // Drop fields where original and current are now equal (user reverted a change).
    (Object.keys(mergedOriginal) as (keyof EditableFields)[]).forEach((key) => {
      if (mergedOriginal[key] === mergedCurrent[key]) {
        delete mergedOriginal[key];
        delete mergedCurrent[key];
      }
    });

    if (Object.keys(mergedOriginal).length === 0) {
      // All changes were reverted — remove the system message entirely.
      await supabase.from('messages').delete().eq('id', existing.id);
      return;
    }

    const newMetadata: EditMetadata = {
      original_values: mergedOriginal,
      current_values: mergedCurrent,
    };

    // Delete the old message and insert a fresh one so it gets a new created_at
    // (moves to the bottom of the chat) and the realtime INSERT path fires correctly.
    await supabase.from('messages').delete().eq('id', existing.id);
    await supabase.from('messages').insert({
      activity_id: activityId,
      user_id: userId,
      type: 'system',
      content: 'event_edited',
      metadata: newMetadata,
    });
  } else {
    const metadata: EditMetadata = {
      original_values: changedOriginal,
      current_values: changedCurrent,
    };

    await supabase.from('messages').insert({
      activity_id: activityId,
      user_id: userId,
      type: 'system',
      content: 'event_edited',
      metadata,
    });
  }
}
