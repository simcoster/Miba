import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, FlatList,
  TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Profile } from '@/lib/types';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import Colors from '@/constants/Colors';

export default function InviteScreen() {
  const { id: circleId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [inviting, setInviting] = useState<string | null>(null);

  useEffect(() => {
    if (!circleId) return;
    supabase.from('circle_members').select('user_id').eq('circle_id', circleId)
      .then(({ data }) => setMemberIds((data ?? []).map((m: any) => m.user_id)));
  }, [circleId]);

  const search = async (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase.from('profiles').select('id, full_name, avatar_url, username')
      .or(`full_name.ilike.%${text.trim()}%,username.ilike.%${text.trim()}%`).neq('id', user!.id).limit(20);
    setResults((data ?? []) as Profile[]);
    setSearching(false);
  };

  const handleAdd = async (profile: Profile) => {
    if (!circleId) return;
    try {
      setInviting(profile.id);
      const { error } = await supabase.from('circle_members').insert({ circle_id: circleId, user_id: profile.id });
      if (error) {
        if (error.code === '23505') Alert.alert('Already a member', `${profile.full_name} is already in this circle.`);
        else throw error;
      } else {
        setMemberIds(prev => [...prev, profile.id]);
        Alert.alert('Added!', `${profile.full_name} has been added.`);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message ?? 'Could not add member.');
    } finally {
      setInviting(null);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Add Members" showBack />
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput} value={query} onChangeText={search}
          placeholder="Search by name or username…" placeholderTextColor={Colors.textSecondary}
          autoFocus autoCapitalize="none" autoCorrect={false}
        />
        {searching && <ActivityIndicator size="small" color={Colors.primary} />}
        {query.length > 0 && !searching && (
          <TouchableOpacity onPress={() => { setQuery(''); setResults([]); }}>
            <Ionicons name="close-circle" size={18} color={Colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {query.length < 2 ? (
        <View style={styles.hint}><Text style={styles.hintText}>Type at least 2 characters to search</Text></View>
      ) : results.length === 0 && !searching ? (
        <View style={styles.hint}><Text style={styles.hintText}>No users found for "{query}"</Text></View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const isMember = memberIds.includes(item.id);
            const isInviting = inviting === item.id;
            return (
              <View style={styles.row}>
                <Avatar uri={item.avatar_url} name={item.full_name} size={44} />
                <View style={styles.info}>
                  <Text style={styles.name}>{item.full_name ?? 'Unknown'}</Text>
                  {item.username && <Text style={styles.username}>@{item.username}</Text>}
                </View>
                <TouchableOpacity
                  style={[styles.addBtn, isMember && styles.addBtnDone]}
                  onPress={() => !isMember && handleAdd(item)}
                  disabled={isMember || isInviting}
                >
                  {isInviting ? <ActivityIndicator size="small" color="#fff" />
                    : isMember ? <Ionicons name="checkmark" size={18} color={Colors.success} />
                    : <Ionicons name="add" size={20} color="#fff" />
                  }
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface,
    borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    marginHorizontal: 20, marginVertical: 16, paddingHorizontal: 12, gap: 8,
  },
  searchInput: { flex: 1, fontSize: 16, color: Colors.text, paddingVertical: 12 },
  hint: { padding: 40, alignItems: 'center' },
  hintText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' },
  list: { paddingHorizontal: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  info: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: Colors.text },
  username: { fontSize: 13, color: Colors.textSecondary },
  addBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  addBtnDone: { backgroundColor: Colors.successLight },
});
