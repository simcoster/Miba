import { supabase } from '@/lib/supabase';
import type { EditSuggestionMetadata } from '@/lib/types';

/**
 * Insert an edit_suggestion system message when an invited user suggests
 * a different time and/or location for an activity.
 */
export async function postEditSuggestionMessage(
  activityId: string,
  userId: string,
  metadata: EditSuggestionMetadata,
): Promise<void> {
  const { suggested_time, suggested_location, note } = metadata;
  if (!suggested_time && !suggested_location) {
    throw new Error('At least one of suggested_time or suggested_location must be provided');
  }
  if (!note?.trim()) {
    throw new Error('Note is required');
  }

  await supabase.from('messages').insert({
    activity_id: activityId,
    user_id: userId,
    type: 'system',
    content: 'edit_suggestion',
    metadata: {
      suggested_time: suggested_time ?? null,
      suggested_location: suggested_location?.trim() || null,
      note: note.trim(),
    },
  });
}
