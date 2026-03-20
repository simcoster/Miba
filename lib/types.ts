/** Sentinel value for Join me "now" events. Never treated as past. */
export const JOIN_ME_NOW_ACTIVITY_TIME = '9999-12-31T23:59:59.999Z';
const SENTINEL_MS = new Date(JOIN_ME_NOW_ACTIVITY_TIME).getTime();

export function isJoinMeNow(activity: { activity_time: string; is_join_me?: boolean }): boolean {
  if (!activity.is_join_me) return false;
  const t = activity.activity_time;
  if (t === JOIN_ME_NOW_ACTIVITY_TIME) return true;
  // Supabase/PostgreSQL may return +00:00 instead of Z, or other equivalent formats
  try {
    return new Date(t).getTime() === SENTINEL_MS;
  } catch {
    return false;
  }
}

export type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  email?: string | null;
  phone?: string | null;
  created_at: string;
  updated_at: string;
};

export type Circle = {
  id: string;
  name: string;
  emoji: string;
  created_by: string | null;
  created_at: string;
  is_all_friends?: boolean;
  member_count?: number;
  is_owner?: boolean;
};

export type CircleMember = {
  id: string;
  circle_id: string;
  user_id: string;
  role: 'member';
  joined_at: string;
  profile?: Profile;
};

export type Activity = {
  id: string;
  created_by: string | null;
  title: string;
  description: string | null;
  location: string | null;
  activity_time: string;
  status: 'active' | 'cancelled';
  created_at: string;
  /** Limited event: max_participants = spots for friends (excluding host) */
  is_limited?: boolean;
  max_participants?: number | null;
  limited_closed_at?: string | null;
  limited_reopened_at?: string | null;
  /** Optional splash art preset: banner_1 through banner_12, join_me_banner */
  splash_art?: 'banner_1' | 'banner_2' | 'banner_3' | 'banner_4' | 'banner_5' | 'banner_6' | 'banner_7' | 'banner_8' | 'banner_9' | 'banner_10' | 'banner_11' | 'banner_12' | 'join_me_banner' | null;
  /** Join me event: timer-based, mandatory location, auto-deleted when timer expires */
  is_join_me?: boolean;
  /** When the join me event auto-deletes. Null for non-join_me or Mipo-linked with unlimited timer. */
  join_me_expires_at?: string | null;
  /** True when created from Mipo "invite to join"; event is deleted when Mipo visible mode turns off. */
  join_me_mipo_linked?: boolean;
  /** Google Places API photo resource name. When set, used as cover instead of splash_art. */
  place_photo_name?: string | null;
  /** Supabase Storage URL of original poster image (low res), when event was created from poster. */
  poster_image_url?: string | null;
  /** Host profile (from created_by). Host is the event creator. */
  host?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
  /** Last host ping per activity (for 24h cooldown). Host can read via RLS. */
  host_pings?: { pinged_at: string }[];
  rsvps?: Rsvp[];
  my_rsvp?: Rsvp | null;
  going_count?: number;
  /** True if the current user has never opened this activity */
  is_new?: boolean;
  /** True if there are chat messages newer than the user's last view */
  has_new_messages?: boolean;
  /** ISO timestamp of latest message from others (when has_new_messages) */
  latest_message_at?: string;
};

export type RsvpStatus = 'pending' | 'in' | 'out' | 'maybe';

export type Rsvp = {
  id: string;
  activity_id: string;
  user_id: string;
  status: RsvpStatus;
  note?: string | null;
  created_at: string;
  updated_at: string;
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
};

export type ActivityExclusion = {
  id: string;
  activity_id: string;
  user_id: string | null;
  circle_id: string | null;
  created_at: string;
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
  circle?: Pick<Circle, 'id' | 'name' | 'emoji'>;
};

export type EditableFields = {
  title: string;
  description: string | null;
  location: string | null;
  activity_time: string;
  splash_art?: 'banner_1' | 'banner_2' | 'banner_3' | 'banner_4' | 'banner_5' | 'banner_6' | 'banner_7' | 'banner_8' | 'banner_9' | 'banner_10' | 'banner_11' | 'banner_12' | 'join_me_banner' | null;
  place_photo_name?: string | null;
};

export type EditMetadata = {
  /** The "from" values at the start of this edit batch (preserved across merges). */
  original_values: Partial<EditableFields>;
  /** The "to" values after the most recent edit in the batch. */
  current_values: Partial<EditableFields>;
};

export type EditSuggestionMetadata = {
  suggested_time: string | null;
  suggested_location: string | null;
  note: string;
};

export type Message = {
  id: string;
  activity_id: string;
  user_id: string;
  content: string;
  type: 'user' | 'system';
  metadata?: EditMetadata | null;
  created_at: string;
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
  /** When set, message belongs to a live location post chat; when null, Mipo activity chat */
  post_id?: string | null;
};

export type Post = {
  id: string;
  activity_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
  post_type?: 'text' | 'live_location';
  creator_expires_at?: string | null;
  chat_closed_at?: string | null;
};

export type PostComment = {
  id: string;
  post_id: string;
  activity_id?: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
};

export type MipoProximityEvent = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
  other_profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
};

export type CircleInvite = {
  id: string;
  circle_id: string;
  invited_by: string | null;
  invited_user_id: string | null;
  invite_code: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  expires_at: string;
  inviter?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
};

export type ContactImport = {
  id: string;
  user_id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  created_at: string;
};

export type FriendJoinedUpdate = {
  id: string;
  recipient_id: string;
  new_user_id: string;
  contact_import_id: string | null;
  created_at: string;
  new_user?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
  contact_name?: string | null;
};
