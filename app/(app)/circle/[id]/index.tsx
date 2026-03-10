import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Modal, BackHandler,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useGlobalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Circle, CircleMember } from '@/lib/types';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmojiPickerButton } from '@/components/EmojiPickerButton';
import { importContacts } from '@/lib/contactImport';
import Colors from '@/constants/Colors';

export default function CircleDetailScreen() {
  const localParams = useLocalSearchParams<{ id: string; fromTab?: string }>();
  const globalParams = useGlobalSearchParams<{ fromTab?: string }>();
  const { id } = localParams;
  // useGlobalSearchParams as fallback — hidden tab screens may not get local query params
  const fromTab = localParams.fromTab ?? globalParams.fromTab;
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [circle, setCircle] = useState<Circle | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Remove from All Friends flow
  const [removeTarget, setRemoveTarget] = useState<{ memberId: string; userId: string; name: string } | null>(null);
  const [removeStep, setRemoveStep] = useState<1 | 2>(1);
  const [upcomingEventCount, setUpcomingEventCount] = useState(0);
  const [removeLoading, setRemoveLoading] = useState(false);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('👥');
  const [saveLoading, setSaveLoading] = useState(false);

  // Import from phone
  const [phoneImportLoading, setPhoneImportLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user || !id) return;
    const [circleRes, membersRes] = await Promise.all([
      supabase.from('circles').select('*').eq('id', id).single(),
      // Fetch members without embed — profile embed can fail and return empty (e.g. ambiguous FK)
      supabase.from('circle_members').select('id, circle_id, user_id, role, joined_at').eq('circle_id', id),
    ]);

    if (circleRes.data) {
      const c = circleRes.data as Circle;
      setCircle(c);
      setIsOwner(c.created_by === user.id);
    }
    if (membersRes.data && (membersRes.data as any[]).length > 0) {
      const memberRows = membersRes.data as { id: string; circle_id: string; user_id: string; role: string; joined_at: string }[];
      const userIds = [...new Set(memberRows.map(m => m.user_id))];
      const { data: profilesData } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', userIds);
      const profileMap = new Map((profilesData ?? []).map((p: any) => [p.id, p]));
      const members: CircleMember[] = memberRows.map(m => ({
        ...m,
        role: m.role as 'member',
        profile: profileMap.get(m.user_id) ?? undefined,
      }));
      setMembers(members);
    } else {
      setMembers(membersRes.data ? (membersRes.data as CircleMember[]) : []);
    }
  }, [user, id]);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  useEffect(() => { setIsEditing(false); }, [id]);

  // Refetch when returning from invite screen (e.g. after adding members)
  const skipFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocus.current) {
        skipFirstFocus.current = false;
        return;
      }
      if (!user || !id) return;
      fetchAll();
    }, [fetchAll, user, id])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  }, [fetchAll]);

  const handleDelete = () => {
    if (circle?.is_all_friends) return;
    Alert.alert('Delete Circle', `Permanently delete "${circle?.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('circles').delete().eq('id', id);
        if (!error) router.replace('/(app)/circles');
        else Alert.alert('Error', 'Could not delete circle.');
      }},
    ]);
  };

  const handleBack = useCallback(() => {
    const tab = typeof fromTab === 'string' ? fromTab : undefined;
    if (tab === 'circles') {
      router.replace('/(app)/circles');
    } else if (tab === 'events') {
      router.replace('/(app)/events');
    } else if (tab === 'profile') {
      router.replace('/(app)/profile');
    } else if (tab === 'updates') {
      router.replace('/(app)');
    } else {
      router.back();
    }
  }, [fromTab, router]);

  // Android back button: cancel edit first, then navigate
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isEditing) {
        setIsEditing(false);
        return true;
      }
      handleBack();
      return true;
    });
    return () => sub.remove();
  }, [handleBack, isEditing]);

  const startEditing = () => {
    if (!circle) return;
    setEditName(circle.name);
    setEditEmoji(circle.emoji);
    setIsEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!circle || editName.trim().length < 2) return;
    try {
      setSaveLoading(true);
      const { error } = await supabase
        .from('circles')
        .update({
          name: editName.trim(),
          description: null,
          emoji: editEmoji,
        })
        .eq('id', id);
      if (error) throw error;
      setCircle(prev => prev ? { ...prev, name: editName.trim(), description: null, emoji: editEmoji } : null);
      setIsEditing(false);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save changes.');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleRemoveMember = (memberId: string, targetUserId: string, name: string) => {
    if (targetUserId === user?.id) return;
    if (circle?.is_all_friends) {
      setRemoveTarget({ memberId, userId: targetUserId, name });
      setRemoveStep(1);
      (async () => {
        const now = new Date().toISOString();
        const { data: activities } = await supabase
          .from('activities')
          .select('id')
          .eq('created_by', user!.id)
          .eq('status', 'active')
          .gt('activity_time', now);
        const activityIds = (activities ?? []).map((a: { id: string }) => a.id);
        if (activityIds.length > 0) {
          const { count } = await supabase
            .from('rsvps')
            .select('*', { count: 'exact', head: true })
            .in('activity_id', activityIds)
            .eq('user_id', targetUserId);
          setUpcomingEventCount(count ?? 0);
        } else {
          setUpcomingEventCount(0);
        }
      })();
      return;
    }
    Alert.alert('Remove Member', `Remove ${name} from this circle?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('circle_members').delete().eq('id', memberId);
        if (!error) setMembers(prev => prev.filter(m => m.id !== memberId));
        else Alert.alert('Error', 'Could not remove member.');
      }},
    ]);
  };

  const handleRemoveFromAllFriendsConfirm = async () => {
    if (!removeTarget || !user) return;
    setRemoveLoading(true);
    try {
      const { data: myCircles } = await supabase
        .from('circles')
        .select('id')
        .eq('created_by', user.id);
      const circleIds = (myCircles ?? []).map((c: { id: string }) => c.id);
      if (circleIds.length > 0) {
        const { error } = await supabase
          .from('circle_members')
          .delete()
          .eq('user_id', removeTarget.userId)
          .in('circle_id', circleIds);
        if (error) throw error;
      }
      setMembers(prev => prev.filter(m => m.user_id !== removeTarget.userId));
      if (upcomingEventCount > 0) {
        setRemoveStep(2);
      } else {
        setRemoveTarget(null);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not remove member.');
      setRemoveTarget(null);
    } finally {
      setRemoveLoading(false);
    }
  };

  const handleUninviteFromEvents = async () => {
    if (!removeTarget || !user) return;
    setRemoveLoading(true);
    try {
      const now = new Date().toISOString();
      const { data: activities } = await supabase
        .from('activities')
        .select('id')
        .eq('created_by', user.id)
        .eq('status', 'active')
        .gt('activity_time', now);
      const activityIds = (activities ?? []).map((a: { id: string }) => a.id);
      if (activityIds.length > 0) {
        await supabase
          .from('rsvps')
          .delete()
          .in('activity_id', activityIds)
          .eq('user_id', removeTarget.userId);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not uninvite from events.');
    } finally {
      setRemoveLoading(false);
      setRemoveTarget(null);
    }
  };

  const handleRemoveModalCancel = () => {
    setRemoveTarget(null);
    setRemoveStep(1);
  };

  const handleImportFromPhone = async () => {
    if (!user) return;
    setPhoneImportLoading(true);
    try {
      const { count, error: err } = await importContacts(user.id);
      if (err) {
        Alert.alert('Import failed', err);
      } else if (count > 0) {
        Alert.alert('Imported', `Imported ${count} contact${count === 1 ? '' : 's'} from your phone.`);
        fetchAll();
      } else {
        Alert.alert('No contacts', 'No contacts with emails or phone numbers were found.');
      }
    } catch (e: any) {
      Alert.alert('Import failed', e.message ?? 'Could not import contacts.');
    } finally {
      setPhoneImportLoading(false);
    }
  };

  if (loading || !circle) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Circle" showBack onBack={handleBack} />
        <View style={styles.center}><Text style={styles.loadingText}>Loading…</Text></View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader
        title={`${circle.emoji} ${circle.name}`}
        subtitle={(() => {
          const others = members.filter(m => m.user_id !== user?.id);
          return `${others.length} ${others.length === 1 ? 'member' : 'members'}`;
        })()}
        showBack
        onBack={isEditing ? () => setIsEditing(false) : handleBack}
        onTitlePress={isOwner && !circle.is_all_friends && !isEditing ? startEditing : undefined}
        rightActions={isOwner && !circle.is_all_friends ? [
          { icon: 'ellipsis-vertical', onPress: () => setShowMenu(true) },
        ] : undefined}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {circle.is_all_friends && (
          <>
            <Text style={styles.allFriendsExplanation}>
              Everyone added to any circle will be here too.
            </Text>
            {isOwner && (
              <TouchableOpacity
                style={[styles.importPhoneBtn, phoneImportLoading && styles.importPhoneBtnDisabled]}
                onPress={handleImportFromPhone}
                disabled={phoneImportLoading}
              >
                {phoneImportLoading ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <>
                    <Ionicons name="phone-portrait-outline" size={20} color={Colors.primary} />
                    <Text style={styles.importPhoneBtnText}>Import contacts from phone</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </>
        )}
        {isEditing && (
          <View style={styles.editSection}>
            <Text style={styles.editLabel}>Circle name *</Text>
            <View style={styles.editNameRow}>
              <TextInput
                style={styles.editInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="e.g. Beach crew, Board game night…"
                placeholderTextColor={Colors.textSecondary}
                maxLength={50}
                autoFocus
              />
              <EmojiPickerButton emoji={editEmoji} onEmojiSelect={setEditEmoji} size={48} />
            </View>
            <TouchableOpacity
              style={[styles.saveBtn, (saveLoading || editName.trim().length < 2) && styles.saveBtnDisabled]}
              onPress={handleSaveEdit}
              disabled={saveLoading || editName.trim().length < 2}
            >
              {saveLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Save changes</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.membersSection}>
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>Members</Text>
            {isOwner && (
              <TouchableOpacity onPress={() => router.push(`/(app)/circle/${id}/invite`)}>
                <Text style={styles.addLink}>+ Add</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.membersList}>
            {members.filter(m => m.user_id !== user?.id).map(member => (
              <TouchableOpacity
                key={member.id}
                style={styles.memberRow}
                onLongPress={() => isOwner ? handleRemoveMember(member.id, member.user_id, member.profile?.full_name ?? 'this member') : undefined}
                activeOpacity={isOwner ? 0.7 : 1}
              >
                <Avatar uri={member.profile?.avatar_url} name={member.profile?.full_name} size={40} />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName} numberOfLines={1}>
                    {member.profile?.full_name ?? 'Unknown'}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
          {isOwner && (
            <Text style={styles.removeHint}>Long-press a member to remove them</Text>
          )}
        </View>

      </ScrollView>

      {/* ⋮ dropdown menu — hidden for All Friends */}
      {!circle.is_all_friends && (
        <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
          <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
            <View style={[styles.menuCard, { top: insets.top + 56 }]}>
              <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); handleDelete(); }}>
                <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                <Text style={[styles.menuItemText, { color: Colors.danger }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Remove from All Friends confirmation modal */}
      <Modal visible={!!removeTarget} transparent animationType="fade" onRequestClose={handleRemoveModalCancel}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={handleRemoveModalCancel}>
          <View style={styles.removeModalCard} onStartShouldSetResponder={() => true}>
            {removeStep === 1 ? (
              <>
                <Text style={styles.removeModalTitle}>Remove from All Friends?</Text>
                <Text style={styles.removeModalBody}>
                  This will remove {removeTarget?.name} from All Friends and from every other circle. They will no longer appear in your invite lists. You can add them back manually later.
                </Text>
                <View style={styles.removeModalButtons}>
                  <TouchableOpacity style={styles.removeModalBtnCancel} onPress={handleRemoveModalCancel}>
                    <Text style={styles.removeModalBtnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.removeModalBtnRemove, removeLoading && styles.removeModalBtnDisabled]}
                    onPress={handleRemoveFromAllFriendsConfirm}
                    disabled={removeLoading}
                  >
                    {removeLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.removeModalBtnRemoveText}>Remove</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.removeModalTitle}>Uninvite from events?</Text>
                <Text style={styles.removeModalBody}>
                  {removeTarget?.name} is invited to {upcomingEventCount} upcoming {upcomingEventCount === 1 ? 'event' : 'events'}. Uninvite them from all? (They will not be notified.)
                </Text>
                <View style={styles.removeModalButtons}>
                  <TouchableOpacity style={styles.removeModalBtnCancel} onPress={handleRemoveModalCancel}>
                    <Text style={styles.removeModalBtnCancelText}>Skip</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.removeModalBtnRemove, removeLoading && styles.removeModalBtnDisabled]}
                    onPress={handleUninviteFromEvents}
                    disabled={removeLoading}
                  >
                    {removeLoading ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.removeModalBtnRemoveText}>Uninvite from all</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  content: { padding: 20, paddingBottom: 40 },
  allFriendsExplanation: {
    fontSize: 15, color: Colors.textSecondary, lineHeight: 22,
    marginBottom: 12, paddingHorizontal: 4,
  },
  importPhoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
  },
  importPhoneBtnDisabled: { opacity: 0.7 },
  importPhoneBtnText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  editSection: { marginBottom: 24 },
  editLabel: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  editNameRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editInput: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: Colors.text },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  membersSection: { marginBottom: 24 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  addLink: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  membersList: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '500', color: Colors.text },
  removeHint: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center', marginTop: 8 },
  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  menuCard: {
    position: 'absolute', right: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14, borderWidth: 1, borderColor: Colors.borderLight,
    minWidth: 180,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12,
    elevation: 8,
    overflow: 'hidden',
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  menuItemText: { fontSize: 15, fontWeight: '500', color: Colors.text },
  removeModalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    marginHorizontal: 24,
    padding: 20,
    maxWidth: 400,
    alignSelf: 'center',
  },
  removeModalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  removeModalBody: { fontSize: 15, color: Colors.textSecondary, lineHeight: 22, marginBottom: 20 },
  removeModalButtons: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
  removeModalBtnCancel: { paddingVertical: 12, paddingHorizontal: 20 },
  removeModalBtnCancelText: { fontSize: 16, fontWeight: '600', color: Colors.textSecondary },
  removeModalBtnRemove: { backgroundColor: Colors.danger, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 20, minWidth: 100, alignItems: 'center' },
  removeModalBtnRemoveText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  removeModalBtnDisabled: { opacity: 0.7 },
});
