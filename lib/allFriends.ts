import { supabase } from '@/lib/supabase';

const ALL_FRIENDS_NAME = 'All Friends';
const ALL_FRIENDS_EMOJI = '👯';

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
 * Adds multiple users to the owner's All Friends circle.
 * Used after contact import to add all contacts who are on Miba.
 */
export async function addUsersToAllFriends(
  ownerId: string,
  userIds: string[]
): Promise<void> {
  const ids = userIds.filter((id) => id !== ownerId);
  if (ids.length === 0) return;

  const allFriendsId = await ensureAllFriendsCircle(ownerId);
  if (!allFriendsId) return;

  await supabase.from('circle_members').upsert(
    ids.map((user_id) => ({ circle_id: allFriendsId, user_id })),
    { onConflict: 'circle_id,user_id', ignoreDuplicates: true }
  );
}

/**
 * Returns the set of user IDs in the owner's All Friends circle.
 * Use to check if participants are friends before showing "To friends".
 */
export async function getAllFriendsMemberIds(ownerId: string): Promise<Set<string>> {
  const allFriendsId = await ensureAllFriendsCircle(ownerId);
  if (!allFriendsId) return new Set();
  const { data } = await supabase.from('circle_members').select('user_id').eq('circle_id', allFriendsId);
  return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
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
