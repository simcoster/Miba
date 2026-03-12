import React, { useCallback, useEffect, useState } from 'react';
import * as Crypto from 'expo-crypto';
import {
  View, Text, TextInput, StyleSheet, ScrollView,
  Alert, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSetTabHighlight } from '@/contexts/TabHighlightContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Circle, Profile } from '@/lib/types';
import { ensureInAllFriends } from '@/lib/allFriends';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/Button';
import { EmojiPickerButton } from '@/components/EmojiPickerButton';
import { Avatar } from '@/components/Avatar';
import Colors from '@/constants/Colors';

export default function NewCircleScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { fromTab } = useLocalSearchParams<{ fromTab?: string }>();
  useSetTabHighlight(fromTab);
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('👥');
  const [loading, setLoading] = useState(false);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Map<string, Profile>>(new Map());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);

  const fetchCircles = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('circles')
      .select('id, name, emoji, created_by, created_at')
      .eq('created_by', user.id)
      .neq('is_all_friends', true)
      .order('created_at', { ascending: false });
    setCircles((data ?? []) as Circle[]);
  }, [user]);

  useEffect(() => {
    fetchCircles();
  }, [fetchCircles]);

  const addFromCircle = async (circle: Circle) => {
    if (!user) return;
    const { data, error } = await supabase
      .from('circle_members')
      .select('user_id, profile:profiles(id, full_name, avatar_url)')
      .eq('circle_id', circle.id)
      .neq('user_id', user.id);
    if (error) return;
    setSelectedMembers(prev => {
      const next = new Map(prev);
      (data ?? []).forEach((m: any) => {
        if (m.profile) next.set(m.user_id, m.profile);
      });
      return next;
    });
  };

  const addFromSearch = (profile: Profile) => {
    setSelectedMembers(prev => new Map(prev).set(profile.id, profile));
    setSearchQuery('');
    setSearchResults([]);
  };

  const removeFromSelected = (userId: string) => {
    setSelectedMembers(prev => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  };

  const handleSearch = async (text: string) => {
    setSearchQuery(text);
    if (text.trim().length < 2) { setSearchResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, username')
      .or(`full_name.ilike.%${text.trim()}%,username.ilike.%${text.trim()}%`)
      .neq('id', user!.id)
      .limit(20);
    setSearchResults((data ?? []) as Profile[]);
    setSearching(false);
  };

  const handleCreate = async () => {
    if (!user || name.trim().length < 2) return;
    try {
      setLoading(true);

      // Generate UUID client-side so we never need RETURNING (avoids RLS timing issue)
      const circleId = Crypto.randomUUID();

      const { error: e1 } = await supabase
        .from('circles')
        .insert({ id: circleId, name: name.trim(), description: null, emoji, created_by: user.id });
      if (e1) {
        console.error('Circle insert error:', e1.code, e1.message, e1.details, e1.hint);
        throw e1;
      }

      const memberIds = [...selectedMembers.keys()];
      if (memberIds.length > 0) {
        const { error: e2 } = await supabase
          .from('circle_members')
          .insert(memberIds.map(user_id => ({ circle_id: circleId, user_id })));
        if (e2) console.error('Circle members insert error:', e2);
        for (const uid of memberIds) {
          await ensureInAllFriends(user.id, uid, circleId);
        }
      }

      if (fromTab) {
        router.replace(`/(app)/circle/${circleId}?fromTab=${encodeURIComponent(fromTab)}`);
      } else {
        router.replace(`/(app)/circle/${circleId}`);
      }
    } catch (error: any) {
      console.error('Create circle failed:', error);
      Alert.alert('Error', `${error.code ?? ''} ${error.message ?? 'Could not create circle.'}`.trim());
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScreenHeader title="New Circle" showBack />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          <Text style={styles.label}>Circle name *</Text>
          <View style={styles.nameRow}>
            <TextInput
              style={styles.input} value={name} onChangeText={setName}
              placeholder="e.g. Beach crew, Board game night…"
              placeholderTextColor={Colors.textSecondary} maxLength={50} autoFocus
            />
            <EmojiPickerButton emoji={emoji} onEmojiSelect={setEmoji} size={48} />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Add members</Text>
          {circles.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.circlesScroll}>
              {circles.map(c => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.circleChip}
                  onPress={() => addFromCircle(c)}
                >
                  <Text style={styles.circleChipEmoji}>{c.emoji}</Text>
                  <Text style={styles.circleChipName} numberOfLines={1}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          <View style={styles.searchBox}>
            <Ionicons name="search" size={18} color={Colors.textSecondary} />
            <TextInput
              style={styles.searchInput}
              value={searchQuery}
              onChangeText={handleSearch}
              placeholder="Search by name or username…"
              placeholderTextColor={Colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searching && <ActivityIndicator size="small" color={Colors.primary} />}
            {searchQuery.length > 0 && !searching && (
              <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchResults([]); }}>
                <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
          {searchResults.length > 0 && (
            <View style={styles.searchResults}>
              {searchResults.map(p => {
                const already = selectedMembers.has(p.id);
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.searchRow}
                    onPress={() => !already && addFromSearch(p)}
                    disabled={already}
                  >
                    <Avatar uri={p.avatar_url} name={p.full_name} size={36} />
                    <View style={styles.searchInfo}>
                      <Text style={styles.searchName}>{p.full_name ?? 'Unknown'}</Text>
                      {p.username && <Text style={styles.searchUsername}>@{p.username}</Text>}
                    </View>
                    {already
                      ? <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
                      : <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          {selectedMembers.size > 0 && (
            <View style={styles.selectedSection}>
              <Text style={styles.selectedLabel}>Selected ({selectedMembers.size})</Text>
              <View style={styles.selectedChips}>
                {[...selectedMembers.values()].map(p => (
                  <View key={p.id} style={styles.selectedChip}>
                    <Avatar uri={p.avatar_url} name={p.full_name} size={28} />
                    <Text style={styles.selectedChipName} numberOfLines={1}>{p.full_name?.split(' ')[0] ?? '?'}</Text>
                    <TouchableOpacity onPress={() => removeFromSelected(p.id)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                      <Ionicons name="close-circle" size={16} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        <Button label="Create Circle" onPress={handleCreate} loading={loading} disabled={name.trim().length < 2} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  section: { marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  input: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 12, fontSize: 16, color: Colors.text },
  circlesScroll: { marginBottom: 12 },
  circleChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1.5, borderColor: Colors.border, marginRight: 8,
  },
  circleChipEmoji: { fontSize: 16 },
  circleChipName: { fontSize: 14, fontWeight: '600', color: Colors.text, maxWidth: 100 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    paddingHorizontal: 12, gap: 8, marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.text, paddingVertical: 12 },
  searchResults: { marginTop: 4 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  searchInfo: { flex: 1 },
  searchName: { fontSize: 16, fontWeight: '600', color: Colors.text },
  searchUsername: { fontSize: 13, color: Colors.textSecondary },
  selectedSection: { marginTop: 12 },
  selectedLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  selectedChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  selectedChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.surface, borderRadius: 12, paddingVertical: 6, paddingLeft: 6, paddingRight: 4, borderWidth: 1, borderColor: Colors.borderLight },
  selectedChipName: { fontSize: 13, color: Colors.text, maxWidth: 60 },
});
