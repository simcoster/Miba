import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Circle, CircleMember } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import Colors from '@/constants/Colors';

export default function CircleDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user || !id) return;
    const [circleRes, membersRes] = await Promise.all([
      supabase.from('circles').select('*').eq('id', id).single(),
      supabase.from('circle_members')
        .select('*, profile:profiles(id, full_name, avatar_url)')
        .eq('circle_id', id),
    ]);

    if (circleRes.data) setCircle(circleRes.data as Circle);
    if (membersRes.data) {
      const mems = membersRes.data as CircleMember[];
      setMembers(mems);
      setIsAdmin(mems.some(m => m.user_id === user.id && m.role === 'admin'));
    }
  }, [user, id]);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const handleDelete = () => Alert.alert('Delete Circle', `Permanently delete "${circle?.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      const { error } = await supabase.from('circles').delete().eq('id', id);
      if (!error) router.replace('/(app)/circles');
      else Alert.alert('Error', 'Could not delete circle.');
    }},
  ]);

  const handleRemoveMember = (memberId: string, userId: string, name: string) => {
    if (userId === user?.id) return; // Can't remove yourself from here (use "Leave" or delete)
    Alert.alert('Remove Member', `Remove ${name} from this circle?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('circle_members').delete().eq('id', memberId);
        if (!error) setMembers(prev => prev.filter(m => m.id !== memberId));
        else Alert.alert('Error', 'Could not remove member.');
      }},
    ]);
  };

  if (loading || !circle) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Circle" showBack />
        <View style={styles.center}><Text style={styles.loadingText}>Loading…</Text></View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={`${circle.emoji} ${circle.name}`}
        subtitle={`${members.length} ${members.length === 1 ? 'member' : 'members'}`}
        showBack
        rightAction={isAdmin ? { icon: 'person-add-outline', onPress: () => router.push(`/(app)/circle/${id}/invite`) } : undefined}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {circle.description ? (
          <View style={styles.descCard}>
            <Text style={styles.descText}>{circle.description}</Text>
          </View>
        ) : null}

        <View style={styles.membersSection}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Members</Text>
            {isAdmin && (
              <TouchableOpacity onPress={() => router.push(`/(app)/circle/${id}/invite`)}>
                <Text style={styles.addLink}>+ Add</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.membersList}>
            {members.map(member => (
              <TouchableOpacity
                key={member.id}
                style={styles.memberRow}
                onLongPress={() => isAdmin && member.user_id !== user?.id
                  ? handleRemoveMember(member.id, member.user_id, member.profile?.full_name ?? 'this member')
                  : undefined}
                activeOpacity={isAdmin && member.user_id !== user?.id ? 0.7 : 1}
              >
                <Avatar uri={member.profile?.avatar_url} name={member.profile?.full_name} size={40} />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.profile?.full_name ?? 'Unknown'}
                    {member.user_id === user?.id ? ' (you)' : ''}
                  </Text>
                  {member.role === 'admin' && (
                    <Text style={styles.memberRole}>Admin</Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
          {isAdmin && (
            <Text style={styles.removeHint}>Long-press a member to remove them</Text>
          )}
        </View>

        <View style={styles.footer}>
          {isAdmin && (
            <Button label="Delete Circle" onPress={handleDelete} variant="danger" />
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
  content: { padding: 20, paddingBottom: 40 },
  descCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: Colors.borderLight },
  descText: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },
  membersSection: { marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  addLink: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  membersList: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '500', color: Colors.text },
  memberRole: { fontSize: 12, color: Colors.primary, fontWeight: '600', marginTop: 1 },
  removeHint: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginTop: 8 },
  footer: { marginTop: 8 },
});
