export type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type Circle = {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  created_by: string | null;
  created_at: string;
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

export type EditableFields = {
  title: string;
  description: string | null;
  location: string | null;
  activity_time: string;
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
