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
  /** Optional splash art preset: banner_1 through banner_12 */
  splash_art?: 'banner_1' | 'banner_2' | 'banner_3' | 'banner_4' | 'banner_5' | 'banner_6' | 'banner_7' | 'banner_8' | 'banner_9' | 'banner_10' | 'banner_11' | 'banner_12' | null;
  /** Google Places API photo resource name. When set, used as cover instead of splash_art. */
  place_photo_name?: string | null;
  /** Host profile (from created_by). Host is the event creator. */
  host?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
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
  splash_art?: 'banner_1' | 'banner_2' | 'banner_3' | 'banner_4' | 'banner_5' | 'banner_6' | 'banner_7' | 'banner_8' | 'banner_9' | 'banner_10' | 'banner_11' | 'banner_12' | null;
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
};

export type Post = {
  id: string;
  activity_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
  profile?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
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
