import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { format, isToday, isTomorrow, isPast } from 'date-fns';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Activity, Rsvp } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import Colors from '@/constants/Colors';

export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  const fetchActivity = useCallback(async () => {
    if (!id || !user) return;
    const { data, error } = await supabase.from('activities').select(`
      *,
      creator:profiles!activities_created_by_fkey(id, full_name, avatar_url),
      rsvps(id, status, user_id, created_at, updated_at, profile:profiles(id, full_name, avatar_url))
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

  const handleRsvp = async (status: 'in' | 'out') => {
    if (!user || !activity) return;
    try {
      setRsvpLoading(true);
      Haptics.impactAsync(status === 'in' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
      const existing = activity.my_rsvp;
      if (existing) {
        // Toggle off if same status, otherwise update
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
  const isCreator = activity.created_by === user?.id;
  const myRsvp = activity.my_rsvp;

  const dateLabel = isToday(activityDate) ? `Today at ${format(activityDate, 'h:mm a')}`
    : isTomorrow(activityDate) ? `Tomorrow at ${format(activityDate, 'h:mm a')}`
    : format(activityDate, 'EEEE, MMMM d · h:mm a');

  // Split invitees by status
  const going = activity.rsvps?.filter(r => r.status === 'in') ?? [];
  const notGoing = activity.rsvps?.filter(r => r.status === 'out') ?? [];
  const pending = activity.rsvps?.filter(r => r.status === 'pending') ?? [];

  return (
    <View style={styles.container}>
      <ScreenHeader title="" showBack
        rightAction={isCreator && !past && activity.status === 'active'
          ? { icon: 'close-circle-outline', onPress: handleCancel } : undefined}
      />
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

        {/* RSVP buttons */}
        {!past && activity.status === 'active' && (
          <View style={styles.rsvpSection}>
            <Text style={styles.sectionTitle}>Are you joining?</Text>
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
          </View>
        )}

        {/* Unified invitees list */}
        <View style={styles.attendeesSection}>
          <Text style={styles.sectionTitle}>
            Invited · {(activity.rsvps ?? []).length}
          </Text>
          {(activity.rsvps ?? []).length === 0 ? (
            <Text style={styles.noAttendees}>No one invited yet.</Text>
          ) : (
            <View style={styles.attendeeList}>
              {going.map(rsvp => (
                <View key={rsvp.id} style={styles.attendeeRow}>
                  <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                  <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                  {rsvp.user_id === user?.id && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                  <View style={styles.statusBadgeGoing}><Text style={styles.statusTextGoing}>Going</Text></View>
                </View>
              ))}
              {notGoing.map(rsvp => (
                <View key={rsvp.id} style={[styles.attendeeRow, { opacity: 0.6 }]}>
                  <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                  <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                  {rsvp.user_id === user?.id && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                  <View style={styles.statusBadgeOut}><Text style={styles.statusTextOut}>Can't go</Text></View>
                </View>
              ))}
              {pending.map(rsvp => (
                <View key={rsvp.id} style={[styles.attendeeRow, { opacity: 0.5 }]}>
                  <Avatar uri={rsvp.profile?.avatar_url} name={rsvp.profile?.full_name} size={38} />
                  <Text style={styles.attendeeName}>{rsvp.profile?.full_name ?? 'Someone'}</Text>
                  {rsvp.user_id === user?.id && <View style={styles.youBadge}><Text style={styles.youText}>You</Text></View>}
                  <View style={styles.statusBadgePending}><Text style={styles.statusTextPending}>Invited</Text></View>
                </View>
              ))}
            </View>
          )}
        </View>
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
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  rsvpButtons: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  rsvpBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.surface, paddingVertical: 14, overflow: 'hidden' },
  rsvpBtnInActive: { borderColor: Colors.primary, padding: 0 },
  rsvpBtnOutActive: { borderColor: Colors.danger, backgroundColor: Colors.dangerLight },
  rsvpGradient: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 8 },
  rsvpBtnText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  rsvpBtnTextActive: { fontSize: 15, fontWeight: '700', color: '#fff' },
  attendeesSection: { marginTop: 8, marginBottom: 16 },
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
});
