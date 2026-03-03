import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl,
  TextInput, ActivityIndicator, Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Activity, Profile, Rsvp } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import Colors from '@/constants/Colors';

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user, profile } = useAuth();
  const router = useRouter();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  const [hasUnread, setHasUnread] = useState(false);

  // Invite-edit state
  const [showAddSearch, setShowAddSearch] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<Profile[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addLoading, setAddLoading] = useState<string | null>(null);

  const isCreator = activity?.created_by === user?.id;

  const fetchActivity = useCallback(async () => {
    if (!id || !user) return;
    const { data, error } = await supabase.from('activities').select(`
      *,
      creator:profiles!activities_created_by_fkey(id, full_name, avatar_url),
      rsvps(id, status, user_id, created_at, updated_at, profile:profiles(id, full_name, avatar_url, is_demo))
    `).eq('id', id).single();

    if (!error && data) {
      setActivity({
        ...data,
        my_rsvp: (data.rsvps as Rsvp[])?.find(r => r.user_id === user.id) ?? null,
        going_count: (data.rsvps as Rsvp[])?.filter(r => r.status === 'in').length ?? 0,
      } as Activity);
    }
  }, [id, user]);

  useEffect(() => { setLoading(true); fetchActivity().finally(() => setLoading(false)); }, [fetchActivity]);
  const onRefresh = useCallback(async () => { setRefreshing(true); await fetchActivity(); setRefreshing(false); }, [fetchActivity]);

  const checkUnread = useCallback(async () => {
    if (!id || !user) return;
    try {
      const stored = await AsyncStorage.getItem(`miba_chat_last_read_${id}`);
      const since = stored ?? '1970-01-01T00:00:00Z';
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('activity_id', id)
        .neq('user_id', user.id)
        .gt('created_at', since);
      setHasUnread((count ?? 0) > 0);
    } catch {
      // non-critical — silently ignore
    }
  }, [id, user]);

  useFocusEffect(useCallback(() => { checkUnread(); }, [checkUnread]));

  const handleRsvp = async (status: 'in' | 'out') => {
    if (!user || !activity) return;
    // Creator is always "in" — their RSVP is locked
    if (activity.created_by === user.id) return;
    try {
      setRsvpLoading(true);
      Haptics.impactAsync(status === 'in' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      const existing = activity.my_rsvp;
      if (existing) {
        if (existing.status === status) {
          await supabase.from('rsvps').update({ status: 'pending' }).eq('id', existing.id);
        } else {
          await supabase.from('rsvps').update({ status }).eq('id', existing.id);
        }
      } else {
        await supabase.from('rsvps').insert({ activity_id: activity.id, user_id: user.id, status });
      }
      await fetchActivity();
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Could not update RSVP.');
    } finally {
      setRsvpLoading(false);
    }
  };

  const handleProxyRsvp = (rsvp: Rsvp) => {
    if (!isCreator || !rsvp.profile?.is_demo) return;
    const name = rsvp.profile.full_name ?? 'them';
    Alert.alert(`RSVP for ${name}`, 'Set their response:', [
      { text: 'Going ✓', onPress: () => applyProxyRsvp(rsvp.id, 'in') },
      { text: "Can't make it ✗", onPress: () => applyProxyRsvp(rsvp.id, 'out') },
      { text: 'Reset to invited', onPress: () => applyProxyRsvp(rsvp.id, 'pending') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const applyProxyRsvp = async (rsvpId: string, status: 'pending' | 'in' | 'out') => {
    try {
      await supabase.from('rsvps').update({ status }).eq('id', rsvpId);
      await fetchActivity();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not update RSVP.');
    }
  };

  const handleAddSearch = async (text: string) => {
    setAddQuery(text);
    if (text.trim().length < 2) { setAddResults([]); return; }
    setAddSearching(true);
    const alreadyInvited = new Set((activity?.rsvps ?? []).map(r => r.user_id));
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, username, is_demo, created_at, updated_at')
      .or(`full_name.ilike.%${text.trim()}%,username.ilike.%${text.trim()}%`)
      .neq('id', user!.id)
      .limit(20);
    setAddResults(((data ?? []) as Profile[]).filter(p => !alreadyInvited.has(p.id)));
    setAddSearching(false);
  };

  const handleAddInvitee = async (profile: Profile) => {
    if (!activity) return;
    try {
      setAddLoading(profile.id);
      const { error } = await supabase.from('rsvps').insert({
        activity_id: activity.id,
        user_id: profile.id,
        status: 'pending',
      });
      if (error) throw error;
      setAddQuery('');
      setAddResults([]);
      await fetchActivity();
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not add invitee.');
    } finally {
      setAddLoading(null);
    }
  };

  const handleRemoveInvitee = (rsvp: Rsvp) => {
    if (!isCreator || rsvp.user_id === user?.id) return;
    const name = rsvp.profile?.full_name ?? 'this person';
    Alert.alert('Remove invitee', `Remove ${name} from this activity?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('rsvps').delete().eq('id', rsvp.id);
        if (error) Alert.alert('Error', error.message);
        else await fetchActivity();
      }},
    ]);
  };

  const handleCancel = () => Alert.alert('Cancel Activity', 'Cancel this activity?', [
    { text: 'No', style: 'cancel' },
    { text: 'Yes', style: 'destructive', onPress: async () => {
      await supabase.from('activities').update({ status: 'cancelled' }).eq('id', id);
      fetchActivity();
    }},
  ]);

  if (loading || !activity) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Activity" showBack />
        <View style={styles.center}><Text style={styles.loadingText}>Loading…</Text></View>
      </View>
    );
  }

  const activityDate = new Date(activity.activity_time);
  const past = isPast(activityDate);
  const myRsvp = activity.my_rsvp;

  const dateLabel = isToday(activityDate) ? `Today at ${format(activityDate, 'h:mm a')}`
    : isTomorrow(activityDate) ? `Tomorrow at ${format(activityDate, 'h:mm a')}`
    : format(activityDate, 'EEEE, MMMM d · h:mm a');

  // Split invitees by status
  const going = activity.rsvps?.filter(r => r.status === 'in') ?? [];
  const notGoing = activity.rsvps?.filter(r => r.status === 'out') ?? [];
  const pending = activity.rsvps?.filter(r => r.status === 'pending') ?? [];

  const headerActions = [
    { icon: 'chatbubble-ellipses-outline' as const, onPress: () => router.push(`/(app)/activity/${id}/chat`), badge: hasUnread },
    ...(isCreator && !past && activity.status === 'active'
      ? [{ icon: 'close-circle-outline' as const, onPress: handleCancel }]
      : []),
  ];

  return (
    <View style={styles.container}>
      <ScreenHeader title="" showBack rightActions={headerActions} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, past && styles.titlePast]}>{activity.title}</Text>

        {activity.status === 'cancelled' && (
          <View style={styles.cancelBanner}>
            <Ionicons name="close-circle" size={16} color={Colors.danger} />
            <Text style={styles.cancelText}>This activity has been cancelled</Text>
          </View>
        )}

        <View style={styles.metaCard}>
          <View style={styles.metaRow}>
            <View style={styles.metaIcon}><Ionicons name="calendar" size={20} color={Colors.primary} /></View>
            <View><Text style={styles.metaLabel}>When</Text><Text style={styles.metaValue}>{dateLabel}</Text></View>
          </View>
          {activity.location && (
            <View style={styles.metaRow}>
              <View style={styles.metaIcon}><Ionicons name="location" size={20} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.metaLabel}>Where</Text><Text style={styles.metaValue}>{activity.location}</Text></View>
            </View>
          )}
          {activity.creator && (
            <View style={styles.metaRow}>
              <View style={styles.metaIcon}><Avatar uri={activity.creator.avatar_url} name={activity.creator.full_name} size={20} /></View>
              <View><Text style={styles.metaLabel}>Posted by</Text><Text style={styles.metaValue}>{activity.creator.full_name}</Text></View>
            </View>
          )}
        </View>

        {activity.description && (
          <View style={styles.descCard}><Text style={styles.descText}>{activity.description}</Text></View>
        )}

        {/* RSVP section */}
        {!past && activity.status === 'active' && (
          <View style={styles.rsvpSection}>
            {isCreator ? (
              <View style={styles.hostBanner}>
                <LinearGradient colors={[Colors.gradientStart, Colors.gradientEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.hostGradient}>
                  <Ionicons name="star" size={18} color="#fff" />
                  <Text style={styles.hostBannerText}>You're hosting — you're always in!</Text>
                </LinearGradient>
              </View>
            ) : (
              <>
                <Text style={[styles.sectionTitle, { marginBottom: 12 }]}>Are you joining?</Text>
                <View style={styles.rsvpButtons}>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, myRsvp?.status === 'in' && styles.rsvpBtnInActive]}
                    onPress={() => handleRsvp('in')} disabled={rsvpLoading} activeOpacity={0.85}
                  >
                    {myRsvp?.status === 'in' ? (
                      <LinearGradient colors={[Colors.gradientStart, Colors.gradientEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.rsvpGradient}>
                        <Ionicons name="checkmark-circle" size={22} color="#fff" />
                        <Text style={styles.rsvpBtnTextActive}>I'm in! 🙌</Text>
                      </LinearGradient>
                    ) : (
                      <><Ionicons name="checkmark-circle-outline" size={22} color={Colors.success} /><Text style={[styles.rsvpBtnText, { color: Colors.success }]}>I'm in</Text></>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rsvpBtn, myRsvp?.status === 'out' && styles.rsvpBtnOutActive]}
                    onPress={() => handleRsvp('out')} disabled={rsvpLoading} activeOpacity={0.85}
                  >
                    <Ionicons name="close-circle-outline" size={22} color={myRsvp?.status === 'out' ? Colors.danger : Colors.textSecondary} />
                    <Text style={[styles.rsvpBtnText, myRsvp?.status === 'out' && { color: Colors.danger }]}>Can't make it</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        {/* Unified invitees list */}
        <View style={styles.attendeesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Invited · {(activity.rsvps ?? []).length}
            </Text>
            {isCreator && activity.status === 'active' && !past && (
              <TouchableOpacity
                style={[styles.addInviteBtn, showAddSearch && styles.addInviteBtnActive]}
                onPress={() => { setShowAddSearch(v => !v); setAddQuery(''); setAddResults([]); }}
              >
                <Ionicons name={showAddSearch ? 'close' : 'person-add-outline'} size={16} color={showAddSearch ? Colors.textSecondary : Colors.primary} />
                <Text style={[styles.addInviteBtnText, showAddSearch && { color: Colors.textSecondary }]}>
                  {showAddSearch ? 'Done' : 'Add'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Inline add-invitee search */}
          {showAddSearch && (
            <View style={styles.addSearchSection}>
              <View style={styles.addSearchBox}>
                <Ionicons name="search" size={16} color={Colors.textSecondary} />
                <TextInput
                  style={styles.addSearchInput}
                  value={addQuery}
                  onChangeText={handleAddSearch}
                  placeholder="Search by name or username…"
                  placeholderTextColor={Colors.textSecondary}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {addSearching
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : addQuery.length > 0 && (
                    <TouchableOpacity onPress={() => { setAddQuery(''); setAddResults([]); }}>
                      <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  )
                }
              </View>
              {addResults.length > 0 && (
                <View style={styles.addResultsList}>
                  {addResults.map(p => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.addResultRow}
                      onPress={() => handleAddInvitee(p)}
                      disabled={addLoading === p.id}
                    >
                      <Avatar uri={p.avatar_url} name={p.full_name} size={36} />
                      <View style={styles.addResultInfo}>
                        <Text style={styles.addResultName}>{p.full_name ?? 'Unknown'}</Text>
                        {p.username && <Text style={styles.addResultUsername}>@{p.username}</Text>}
                      </View>
                      {addLoading === p.id
                        ? <ActivityIndicator size="small" color={Colors.primary} />
                        : <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
                      }
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {addQuery.length >= 2 && !addSearching && addResults.length === 0 && (
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addQuery.trim()) ? (
                  <TouchableOpacity
                    style={styles.inviteEmailBtn}
                    onPress={() => {
                      const email = addQuery.trim();
                      const name = profile?.full_name ?? 'A friend';
                      const subject = encodeURIComponent('Join me on Miba!');
                      const body = encodeURIComponent(
                        `Hey!\n\n${name} is inviting you to join Miba — an app for organising hangouts with friends.\n\nDownload it and we can start planning!\n\nhttps://miba.app\n\n— ${name}`
                      );
                      Linking.openURL(`mailto:${email}?subject=${subject}&body=${body}`);
                    }}
                  >
                    <Ionicons name="mail-outline" size={18} color={Colors.primary} />
                    <Text style={styles.inviteEmailText}>Invite <Text style={{ fontWeight: '700' }}>{addQuery.trim()}</Text> to Miba</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.addNoResults}>No users found for "{addQuery}"</Text>
                )
              )}
            </View>
          )}

          {(activity.rsvps ?? []).length === 0 ? (
            <Text style={styles.noAttendees}>No one invited yet.</Text>
          ) : (
            <View style={styles.attendeeList}>
              {going.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const isHost = isMe && isCreator;
                const canProxy = isCreator && rsvp.profile?.is_demo && activity.status === 'active' && !past;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <TouchableOpacity
                    key={rsvp.id} style={styles.attendeeRow}
                    onPress={canProxy ? () => handleProxyRsvp(rsvp) : undefined}
                    onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                    activeOpacity={canProxy || canRemove ? 0.7 : 1}
                  >
                    <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                    <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                    {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                    {isHost
                      ? <View style={styles.statusBadgeHost}><Text style={styles.statusTextHost}>Host</Text></View>
                      : <View style={styles.statusBadgeGoing}><Text style={styles.statusTextGoing}>{canProxy ? 'Going ✎' : 'Going'}</Text></View>}
                  </TouchableOpacity>
                );
              })}
              {notGoing.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const canProxy = isCreator && rsvp.profile?.is_demo && activity.status === 'active' && !past;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <TouchableOpacity
                    key={rsvp.id} style={[styles.attendeeRow, { opacity: 0.6 }]}
                    onPress={canProxy ? () => handleProxyRsvp(rsvp) : undefined}
                    onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                    activeOpacity={canProxy || canRemove ? 0.7 : 1}
                  >
                    <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                    <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                    {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                    <View style={styles.statusBadgeOut}><Text style={styles.statusTextOut}>{canProxy ? "Can't go ✎" : "Can't go"}</Text></View>
                  </TouchableOpacity>
                );
              })}
              {pending.map(rsvp => {
                const isMe = rsvp.user_id === user?.id;
                const canProxy = isCreator && rsvp.profile?.is_demo && activity.status === 'active' && !past;
                const canRemove = isCreator && !isMe && activity.status === 'active' && !past;
                return (
                  <TouchableOpacity
                    key={rsvp.id} style={[styles.attendeeRow, { opacity: 0.5 }]}
                    onPress={canProxy ? () => handleProxyRsvp(rsvp) : undefined}
                    onLongPress={canRemove ? () => handleRemoveInvitee(rsvp) : undefined}
                    activeOpacity={canProxy || canRemove ? 0.7 : 1}
                  >
                    <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                    <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                    {isMe && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                    <View style={styles.statusBadgePending}><Text style={styles.statusTextPending}>{canProxy ? 'Invited ✎' : 'Invited'}</Text></View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* Chat entry */}
        <TouchableOpacity
          style={styles.chatEntry}
          onPress={() => router.push(`/(app)/activity/${id}/chat`)}
          activeOpacity={0.8}
        >
          <View style={styles.chatEntryIcon}>
            <Ionicons name="chatbubble-ellipses" size={22} color={Colors.primary} />
          </View>
          <View style={styles.chatEntryText}>
            <Text style={styles.chatEntryTitle}>Group Chat</Text>
            <Text style={styles.chatEntrySubtitle}>Chat with everyone who's invited</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  content: { padding: 20, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.text, lineHeight: 34, marginBottom: 12 },
  titlePast: { color: Colors.textSecondary },
  cancelBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.dangerLight, borderRadius: 12, padding: 12, marginBottom: 12 },
  cancelText: { fontSize: 14, color: Colors.danger, fontWeight: '600' },
  metaCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, gap: 14, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 12 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  metaIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  metaLabel: { fontSize: 11, color: Colors.textSecondary, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  metaValue: { fontSize: 15, color: Colors.text, fontWeight: '600', marginTop: 1 },
  descCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.borderLight, marginBottom: 12 },
  descText: { fontSize: 15, color: Colors.text, lineHeight: 22 },
  rsvpSection: { marginVertical: 8 },
  hostBanner: { marginBottom: 20, borderRadius: 14, overflow: 'hidden' },
  hostGradient: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 16 },
  hostBannerText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  rsvpButtons: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  rsvpBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, paddingVertical: 14, overflow: 'hidden' },
  rsvpBtnInActive: { borderColor: Colors.primary, padding: 0 },
  rsvpBtnOutActive: { borderColor: Colors.danger, backgroundColor: Colors.dangerLight },
  rsvpGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 8 },
  rsvpBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  rsvpBtnTextActive: { fontSize: 15, fontWeight: '700', color: '#fff' },
  attendeesSection: { marginTop: 8, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  addInviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  addInviteBtnActive: { borderColor: Colors.border, backgroundColor: Colors.surface },
  addInviteBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  addSearchSection: { marginBottom: 12 },
  addSearchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 10, gap: 8, marginBottom: 6 },
  addSearchInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 10 },
  addResultsList: { backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  addResultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  addResultInfo: { flex: 1 },
  addResultName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  addResultUsername: { fontSize: 12, color: Colors.textSecondary },
  addNoResults: { fontSize: 13, color: Colors.textSecondary, paddingHorizontal: 4 },
  inviteEmailBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2, backgroundColor: Colors.accentLight, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed', paddingHorizontal: 12, paddingVertical: 10 },
  inviteEmailText: { flex: 1, fontSize: 13, color: Colors.primaryDark },
  noAttendees: { fontSize: 14, color: Colors.textSecondary },
  attendeeList: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  attendeeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  attendeeName: { flex: 1, fontSize: 15, fontWeight: '500', color: Colors.text },
  youBadge: { backgroundColor: Colors.accentLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  youText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  statusBadgeGoing: { backgroundColor: Colors.successLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextGoing: { fontSize: 11, fontWeight: '600', color: Colors.success },
  statusBadgeOut: { backgroundColor: Colors.dangerLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextOut: { fontSize: 11, fontWeight: '600', color: Colors.danger },
  statusBadgePending: { backgroundColor: Colors.borderLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextPending: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  statusBadgeHost: { backgroundColor: Colors.accentLight, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  statusTextHost: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  chatEntry: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, padding: 14 },
  chatEntryIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  chatEntryText: { flex: 1 },
  chatEntryTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  chatEntrySubtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 1 },
});
