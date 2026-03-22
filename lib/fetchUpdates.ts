import AsyncStorage from '@react-native-async-storage/async-storage';
import { isPast } from 'date-fns';
import { supabase } from '@/lib/supabase';
import type { Activity, FriendJoinedUpdate } from '@/lib/types';
import { enrichWithSeenStatus } from '@/lib/enrichWithSeenStatus';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const RSVP_CHANGES_CUTOFF_DAYS = 7;

export type RsvpChangeItem = {
  userName: string;
  status: 'in' | 'maybe' | 'out';
  bucketTime: number;
};

export type UpdateItem =
  | { type: 'new_invite' }
  | { type: 'limited_reopened' }
  | { type: 'new_messages' }
  | { type: 'rsvp_changes'; changes: RsvpChangeItem[] }
  | { type: 'host_ping'; timestamp: number }
  | { type: 'survey_ping'; timestamp: number };

export type EventUpdate = {
  activity: Activity;
  updates: UpdateItem[];
  latestTimestamp: number;
};

export type UpdateEntry =
  | { kind: 'event'; data: EventUpdate }
  | { kind: 'friend_joined'; data: FriendJoinedUpdate };

export async function fetchUpdates(userId: string): Promise<UpdateEntry[]> {
  const { data: activitiesData, error: fetchError } = await supabase
    .from('activities')
    .select(`
      *,
      host:profiles!activities_created_by_fkey(id, full_name, avatar_url),
      rsvps(id, status, user_id, created_at, updated_at, profile:profiles(id, full_name, avatar_url))
    `)
    .eq('status', 'active')
    .order('activity_time', { ascending: true });

  if (fetchError) {
    console.error('[fetchUpdates] error:', fetchError);
    throw new Error(fetchError.message);
  }

  const { data: pendingInvitesData } = await supabase
    .from('rsvps')
    .select(`
      id,
      activity_id,
      user_id,
      status,
      created_at,
      updated_at,
      profile:profiles(id, full_name, avatar_url),
      activity:activities(
        id,
        title,
        description,
        location,
        activity_time,
        status,
        created_by,
        is_limited,
        is_join_me,
        limited_reopened_at,
        host:profiles!activities_created_by_fkey(id, full_name, avatar_url),
        rsvps(id, status, user_id, created_at, updated_at, profile:profiles(id, full_name, avatar_url))
      )
    `)
    .eq('user_id', userId)
    .eq('status', 'pending');

  const existingIds = new Set((activitiesData ?? []).map((a: any) => a.id));
  const missingInviteActivities = (pendingInvitesData ?? [])
    .filter((r: any) => r.activity && !existingIds.has(r.activity.id))
    .map((r: any) => {
      const act = r.activity;
      const myRsvp = act.rsvps?.find((rv: any) => rv.user_id === userId) ?? r;
      return {
        ...act,
        my_rsvp: myRsvp,
        going_count: act.rsvps?.filter((rv: any) => rv.status === 'in').length ?? 0,
      };
    });

  const allActivitiesData = [
    ...(activitiesData ?? []),
    ...missingInviteActivities,
  ];

  const raw = allActivitiesData.map((a: any) => {
    const myRsvp = a.rsvps?.find((r: any) => r.user_id === userId) ?? null;
    return {
      ...a,
      my_rsvp: myRsvp,
      going_count: a.rsvps?.filter((r: any) => r.status === 'in').length ?? 0,
    };
  }) as Activity[];

  const enriched = await enrichWithSeenStatus(raw, userId);

  const pendingActivityIds = (pendingInvitesData ?? [])
    .map((r: any) => {
      const act = Array.isArray(r.activity) ? r.activity[0] : r.activity;
      return act?.id;
    })
    .filter(Boolean) as string[];
  const activityIds = [...new Set([...enriched.map(a => a.id), ...pendingActivityIds])];
  const rsvpSeenKeys = activityIds.map(id => `miba_rsvp_changes_seen_${id}`);
  const activitySeenKeys = activityIds.map(id => `miba_activity_last_seen_${id}`);
  const [rsvpSeenPairs, activitySeenPairs] = await Promise.all([
    AsyncStorage.multiGet(rsvpSeenKeys),
    AsyncStorage.multiGet(activitySeenKeys),
  ]);
  const rsvpSeenMap: Record<string, string | null> = {};
  rsvpSeenPairs.forEach(([key, value]) => {
    const actId = key.replace('miba_rsvp_changes_seen_', '');
    rsvpSeenMap[actId] = value;
  });
  const activityLastSeenMap: Record<string, string | null> = {};
  activitySeenPairs.forEach(([key, value]) => {
    const actId = key.replace('miba_activity_last_seen_', '');
    activityLastSeenMap[actId] = value;
  });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RSVP_CHANGES_CUTOFF_DAYS);
  const cutoffIso = cutoff.toISOString();

  const { data: rsvpChanges } = await supabase
    .from('rsvps')
    .select('activity_id, user_id, status, updated_at, created_at, profile:profiles(full_name)')
    .in('activity_id', activityIds)
    .neq('user_id', userId)
    .in('status', ['in', 'maybe', 'out'])
    .gt('updated_at', cutoffIso);

  type RsvpChangeRow = { activity_id: string; user_id: string; status: string; updated_at: string; created_at: string; profile: { full_name: string | null } | null };
  const rsvpByActivity: Record<string, RsvpChangeItem[]> = {};
  const seenByUserAndBucket = new Map<string, Set<string>>();
  (rsvpChanges ?? []).forEach((r: RsvpChangeRow) => {
    const updated = new Date(r.updated_at).getTime();
    const created = new Date(r.created_at).getTime();
    if (updated <= created) return;
    const lastSeen = rsvpSeenMap[r.activity_id];
    if (lastSeen && updated <= new Date(lastSeen).getTime()) return;
    const bucket = Math.floor(updated / THIRTY_MINUTES_MS) * THIRTY_MINUTES_MS;
    const userBucketKey = `${r.user_id}:${bucket}`;
    if (!seenByUserAndBucket.has(r.activity_id)) seenByUserAndBucket.set(r.activity_id, new Set());
    if (seenByUserAndBucket.get(r.activity_id)!.has(userBucketKey)) return;
    seenByUserAndBucket.get(r.activity_id)!.add(userBucketKey);
    const profile = Array.isArray(r.profile) ? r.profile[0] : r.profile;
    const userName = profile?.full_name?.trim() || 'Someone';
    const status = r.status as 'in' | 'maybe' | 'out';
    if (!rsvpByActivity[r.activity_id]) rsvpByActivity[r.activity_id] = [];
    rsvpByActivity[r.activity_id].push({ userName, status, bucketTime: bucket });
  });

  const hostPingActivityIds = activityIds.filter((aid) => {
    const a = enriched.find((x) => x.id === aid);
    return a && (a.my_rsvp?.status === 'pending' || a.my_rsvp?.status === 'maybe') && !isPast(new Date(a.activity_time));
  });
  const hostPingByActivity: Record<string, string> = {};
  const surveyPingByActivity: Record<string, string> = {};
  if (hostPingActivityIds.length > 0) {
    const { data: hostPingMessages } = await supabase
      .from('messages')
      .select('activity_id, created_at')
      .in('activity_id', hostPingActivityIds)
      .eq('type', 'system')
      .eq('content', 'host_ping')
      .order('created_at', { ascending: false });
    (hostPingMessages ?? []).forEach((m: { activity_id: string; created_at: string }) => {
      if (!hostPingByActivity[m.activity_id]) hostPingByActivity[m.activity_id] = m.created_at;
    });
  }
  if (activityIds.length > 0) {
    const { data: surveyPingMessages } = await supabase
      .from('messages')
      .select('activity_id, created_at')
      .in('activity_id', activityIds)
      .eq('type', 'system')
      .eq('content', 'survey_ping')
      .order('created_at', { ascending: false });
    (surveyPingMessages ?? []).forEach((m: { activity_id: string; created_at: string }) => {
      if (!surveyPingByActivity[m.activity_id]) surveyPingByActivity[m.activity_id] = m.created_at;
    });
  }

  const grouped: EventUpdate[] = [];
  const groupedIds = new Set<string>();

  const pendingFromRsvps = (pendingInvitesData ?? []).filter((r: any) => r.activity);
  for (const r of pendingFromRsvps) {
    const act = Array.isArray(r.activity) ? r.activity[0] : r.activity;
    if (!act || groupedIds.has(act.id)) continue;
    if (isPast(new Date(act.activity_time))) continue;
    const lastSeen = activityLastSeenMap[act.id];
    const inviteCreatedAt = (r as any).created_at;
    const inviteIsNew = lastSeen == null || lastSeen === '' || (inviteCreatedAt && new Date(inviteCreatedAt) > new Date(lastSeen));
    if (!inviteIsNew) continue;
    const activity = enriched.find((a: Activity) => a.id === act.id);
    const actToUse = (activity ?? {
      ...act,
      my_rsvp: act.rsvps?.find((rv: any) => rv.user_id === userId) ?? r,
      going_count: act.rsvps?.filter((rv: any) => rv.status === 'in').length ?? 0,
    }) as Activity;
    const rawRsvp = r as { id: string; activity_id: string; created_at: string; updated_at: string; profile?: unknown };
    const myRsvp: Activity['my_rsvp'] = actToUse.my_rsvp ?? {
      id: rawRsvp.id,
      activity_id: rawRsvp.activity_id,
      user_id: userId,
      status: 'pending',
      created_at: rawRsvp.created_at,
      updated_at: rawRsvp.updated_at ?? rawRsvp.created_at,
      profile: Array.isArray(rawRsvp.profile) ? rawRsvp.profile[0] : rawRsvp.profile,
    } as Activity['my_rsvp'];
    const finalAct: Activity = { ...actToUse, my_rsvp: myRsvp };
    const t = finalAct.my_rsvp?.created_at ? new Date(finalAct.my_rsvp.created_at).getTime() : Date.now();
    grouped.push({ activity: finalAct, updates: [{ type: 'new_invite' }], latestTimestamp: t });
    groupedIds.add(act.id);
  }

  for (const activity of enriched) {
    const updates: UpdateItem[] = [];
    let latestTimestamp = 0;
    const lastSeen = activityLastSeenMap[activity.id];
    const inviteIsNew = lastSeen == null || lastSeen === '' || (activity.my_rsvp?.created_at && new Date(activity.my_rsvp.created_at) > new Date(lastSeen));
    if (activity.my_rsvp?.status === 'pending' && inviteIsNew && !isPast(new Date(activity.activity_time))) {
      updates.push({ type: 'new_invite' });
      const t = new Date(activity.my_rsvp.created_at).getTime();
      if (t > latestTimestamp) latestTimestamp = t;
    }
    const reopenedIsNew = (activity.my_rsvp?.status === 'pending' || activity.my_rsvp?.status === 'maybe') &&
      activity.is_limited && activity.limited_reopened_at &&
      (lastSeen == null || lastSeen === '' || new Date(activity.limited_reopened_at) > new Date(lastSeen)) &&
      !isPast(new Date(activity.activity_time));
    if (reopenedIsNew) {
      updates.push({ type: 'limited_reopened' });
      const t = new Date(activity.limited_reopened_at!).getTime();
      if (t > latestTimestamp) latestTimestamp = t;
    }
    if (activity.has_new_messages) {
      updates.push({ type: 'new_messages' });
      const msgTime = activity.latest_message_at ? new Date(activity.latest_message_at).getTime() : Date.now();
      latestTimestamp = Math.max(latestTimestamp, msgTime);
    }
    const changes = rsvpByActivity[activity.id];
    if (changes?.length) {
      updates.push({ type: 'rsvp_changes', changes });
      const maxBucket = Math.max(...changes.map(c => c.bucketTime));
      if (maxBucket > latestTimestamp) latestTimestamp = maxBucket;
    }
    const hostPingAt = hostPingByActivity[activity.id];
    if (
      hostPingAt &&
      (activity.my_rsvp?.status === 'pending' || activity.my_rsvp?.status === 'maybe') &&
      !isPast(new Date(activity.activity_time))
    ) {
      const hostPingIsNew = lastSeen == null || lastSeen === '' || new Date(hostPingAt) > new Date(lastSeen);
      if (hostPingIsNew) {
        const t = new Date(hostPingAt).getTime();
        updates.push({ type: 'host_ping', timestamp: t });
        if (t > latestTimestamp) latestTimestamp = t;
      }
    }
    const surveyPingAt = surveyPingByActivity[activity.id];
    if (surveyPingAt && !isPast(new Date(activity.activity_time))) {
      const surveyPingIsNew = lastSeen == null || lastSeen === '' || new Date(surveyPingAt) > new Date(lastSeen);
      if (surveyPingIsNew) {
        const t = new Date(surveyPingAt).getTime();
        updates.push({ type: 'survey_ping', timestamp: t });
        if (t > latestTimestamp) latestTimestamp = t;
      }
    }
    if (updates.length > 0) {
      const existing = grouped.find(g => g.activity.id === activity.id);
      if (existing) {
        existing.activity = activity;
        const existingTypes = new Set(existing.updates.map(u => u.type));
        for (const u of updates) {
          if (!existingTypes.has(u.type)) {
            existing.updates.push(u);
            existingTypes.add(u.type);
          }
        }
        existing.latestTimestamp = Math.max(existing.latestTimestamp, latestTimestamp);
      } else {
        grouped.push({ activity, updates, latestTimestamp });
      }
    }
  }
  grouped.sort((a, b) => b.latestTimestamp - a.latestTimestamp);

  const { data: friendJoinedData } = await supabase
    .from('friend_joined_updates')
    .select(`
      id,
      new_user_id,
      contact_import_id,
      created_at,
      new_user:profiles!new_user_id(id, full_name, avatar_url),
      contact_import:contact_imports!contact_import_id(name)
    `)
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false });

  const friendJoinedSeenKeys = (friendJoinedData ?? []).map((f: any) => `miba_friend_joined_seen_${f.id}`);
  const friendJoinedSeenPairs = friendJoinedSeenKeys.length > 0
    ? await AsyncStorage.multiGet(friendJoinedSeenKeys)
    : [];
  const friendJoinedSeenSet = new Set(
    friendJoinedSeenPairs.filter(([, v]) => v != null).map(([k]) => k.replace('miba_friend_joined_seen_', ''))
  );

  const friendJoinedEntries: UpdateEntry[] = (friendJoinedData ?? [])
    .filter((f: any) => !friendJoinedSeenSet.has(f.id))
    .map((f: any) => ({
      kind: 'friend_joined' as const,
      data: {
        id: f.id,
        recipient_id: userId,
        new_user_id: f.new_user_id,
        contact_import_id: f.contact_import_id,
        created_at: f.created_at,
        new_user: Array.isArray(f.new_user) ? f.new_user[0] : f.new_user,
        contact_name: (() => {
          const ci = f.contact_import;
          return (Array.isArray(ci) ? ci[0] : ci)?.name ?? null;
        })(),
      } as FriendJoinedUpdate,
    }));

  const eventEntries: UpdateEntry[] = grouped.map(g => ({ kind: 'event', data: g }));
  const allEntries = [...eventEntries, ...friendJoinedEntries];
  allEntries.sort((a, b) => {
    const ta = a.kind === 'event' ? a.data.latestTimestamp : new Date(a.data.created_at).getTime();
    const tb = b.kind === 'event' ? b.data.latestTimestamp : new Date(b.data.created_at).getTime();
    return tb - ta;
  });
  return allEntries;
}
