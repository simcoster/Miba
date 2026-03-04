import { supabase } from '@/lib/supabase';
import type { RsvpStatus } from '@/lib/types';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;

export type RsvpChangeMetadata = {
  old_status: RsvpStatus;
  new_status: RsvpStatus;
  /** When host changes someone else's RSVP */
  changed_user_id?: string;
};

/**
 * After an RSVP status change, insert a system message.
 * Merges with an existing rsvp_changed message by the same user within 30 minutes.
 */
export async function postRsvpChangeMessage(
  activityId: string,
  actorUserId: string,
  oldStatus: RsvpStatus,
  newStatus: RsvpStatus,
  changedUserId?: string
): Promise<void> {
  const metadata: RsvpChangeMetadata = {
    old_status: oldStatus,
    new_status: newStatus,
    ...(changedUserId && { changed_user_id: changedUserId }),
  };

  const cutoff = new Date(Date.now() - THIRTY_MINUTES_MS).toISOString();
  const { data: existing } = await supabase
    .from('messages')
    .select('id, metadata, created_at')
    .eq('activity_id', activityId)
    .eq('user_id', actorUserId)
    .eq('type', 'system')
    .eq('content', 'rsvp_changed')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const prev = (existing.metadata ?? {}) as RsvpChangeMetadata;
    const merged: RsvpChangeMetadata = {
      old_status: prev.old_status,
      new_status,
      ...(changedUserId && { changed_user_id: changedUserId }),
    };

    await supabase.from('messages').delete().eq('id', existing.id);
    await supabase.from('messages').insert({
      activity_id: activityId,
      user_id: actorUserId,
      type: 'system',
      content: 'rsvp_changed',
      metadata: merged,
    });
  } else {
    await supabase.from('messages').insert({
      activity_id: activityId,
      user_id: actorUserId,
      type: 'system',
      content: 'rsvp_changed',
      metadata,
    });
  }
}
