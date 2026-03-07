import { supabase } from '@/lib/supabase';

const ALL_FRIENDS_NAME = 'All Friends';
const ALL_FRIENDS_EMOJI = '👥';

/**
 * Ensures the current user has an All Friends circle. Creates it if missing.
 * Returns the All Friends circle id, or null on error.
 */
export async function ensureAllFriendsCircle(userId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('circles')
    .select('id')
    .eq('created_by', userId)
    .eq('is_all_friends', true)
    .maybeSingle();

  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from('circles')
    .insert({
      name: ALL_FRIENDS_NAME,
      emoji: ALL_FRIENDS_EMOJI,
      description: null,
      is_all_friends: true,
      created_by: userId,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[AllFriends] create error:', error);
    return null;
  }
  return created?.id ?? null;
}

/**
 * Ensures a user is in the owner's All Friends circle.
 * Call after adding someone to any circle (except when adding to All Friends itself).
 */
export async function ensureInAllFriends(
  ownerId: string,
  friendId: string,
  currentCircleId: string
): Promise<void> {
  const { data: currentCircle } = await supabase
    .from('circles')
    .select('is_all_friends')
    .eq('id', currentCircleId)
    .single();

  if (currentCircle?.is_all_friends) return;

  const allFriendsId = await ensureAllFriendsCircle(ownerId);
  if (!allFriendsId) return;

  await supabase.from('circle_members').upsert(
    { circle_id: allFriendsId, user_id: friendId },
    { onConflict: 'circle_id,user_id', ignoreDuplicates: true }
  );
}
