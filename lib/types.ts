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
  is_admin?: boolean;
};

export type CircleMember = {
  id: string;
  circle_id: string;
  user_id: string;
  role: 'admin' | 'member';
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
  creator?: Pick<Profile, 'id' | 'full_name' | 'avatar_url'>;
  rsvps?: Rsvp[];
  my_rsvp?: Rsvp | null;
  going_count?: number;
};

export type Rsvp = {
  id: string;
  activity_id: string;
  user_id: string;
  status: 'pending' | 'in' | 'out';
  created_at: string;
  updated_at: string;
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
