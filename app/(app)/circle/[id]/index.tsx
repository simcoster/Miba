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
import Colors from '@/constants/Colors';

const EMOJIS = ['👥','🏋️','🎲','🎮','🎵','🏖️','🍕','☕','🎭','🎬','📚','🚴','⚽','🏄','🧗','🎯','🌿','🎸','🏕️','🤿','🎪','🎡','🌮','🍻'];

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

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEmoji, setEditEmoji] = useState('👥');
  const [saveLoading, setSaveLoading] = useState(false);

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

  const handleDelete = () => Alert.alert('Delete Circle', `Permanently delete "${circle?.name}"?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
      const { error } = await supabase.from('circles').delete().eq('id', id);
      if (!error) router.replace('/(app)/circles');
      else Alert.alert('Error', 'Could not delete circle.');
    }},
  ]);

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
    setEditDesc(circle.description ?? '');
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
          description: editDesc.trim() || null,
          emoji: editEmoji,
        })
        .eq('id', id);
      if (error) throw error;
      setCircle(prev => prev ? { ...prev, name: editName.trim(), description: editDesc.trim() || null, emoji: editEmoji } : null);
      setIsEditing(false);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not save changes.');
    } finally {
      setSaveLoading(false);
    }
  };

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
        <ScreenHeader title="Circle" showBack onBack={handleBack} />
        <View style={styles.center}><Text style={styles.loadingText}>Loading…</Text></View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader
        title={isEditing ? 'Edit Circle' : `${circle.emoji} ${circle.name}`}
        subtitle={isEditing ? undefined : (() => {
          const others = members.filter(m => m.user_id !== user?.id);
          return `${others.length} ${others.length === 1 ? 'member' : 'members'}`;
        })()}
        showBack
        onBack={isEditing ? () => setIsEditing(false) : handleBack}
        rightActions={isOwner && !isEditing ? [
          { icon: 'ellipsis-vertical', onPress: () => setShowMenu(true) },
        ] : undefined}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={!isEditing ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} /> : undefined}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isEditing ? (
          <>
            <View style={styles.editSection}>
              <Text style={styles.editLabel}>Pick an emoji</Text>
              <View style={styles.emojiGrid}>
                {EMOJIS.map(e => (
                  <TouchableOpacity
                    key={e}
                    style={[styles.emojiOption, editEmoji === e && styles.emojiOptionSelected]}
                    onPress={() => setEditEmoji(e)}
                  >
                    <Text style={styles.emojiText}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={styles.editSection}>
              <Text style={styles.editLabel}>Circle name *</Text>
              <TextInput
                style={styles.editInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="e.g. Beach crew, Board game night…"
                placeholderTextColor={Colors.textSecondary}
                maxLength={50}
                autoFocus
              />
            </View>
            <View style={styles.editSection}>
              <Text style={styles.editLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.editInput, styles.editTextArea]}
                value={editDesc}
                onChangeText={setEditDesc}
                placeholder="What's this circle for?"
                placeholderTextColor={Colors.textSecondary}
                maxLength={200}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>
          </>
        ) : circle.description ? (
          <View style={styles.descCard}>
            <Text style={styles.descText}>{circle.description}</Text>
          </View>
        ) : null}

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

        {isEditing && (
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
        )}
      </ScrollView>

      {/* ⋮ dropdown menu */}
      <Modal visible={showMenu} transparent animationType="fade" onRequestClose={() => setShowMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMenu(false)}>
          <View style={[styles.menuCard, { top: insets.top + 56 }]}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); startEditing(); }}>
              <Ionicons name="create-outline" size={18} color={Colors.text} />
              <Text style={styles.menuItemText}>Edit</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMenu(false); handleDelete(); }}>
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
              <Text style={[styles.menuItemText, { color: Colors.danger }]}>Delete</Text>
            </TouchableOpacity>
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
  editSection: { marginBottom: 24 },
  editLabel: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  editInput: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: Colors.text },
  editTextArea: { minHeight: 80, paddingTop: 12 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  emojiOption: { width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  emojiOptionSelected: { borderColor: Colors.primary, backgroundColor: Colors.accentLight },
  emojiText: { fontSize: 24 },
  saveBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
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
  menuDivider: { height: 1, backgroundColor: Colors.borderLight },
});
