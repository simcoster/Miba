import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useClearTabHighlightOnFocus } from '@/contexts/TabHighlightContext';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Circle } from '@/lib/types';
import { ensureAllFriendsCircle } from '@/lib/allFriends';
import { CircleCard } from '@/components/CircleCard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import Colors from '@/constants/Colors';
export default function CirclesScreen() {
  useClearTabHighlightOnFocus();
  const { user } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [circles, setCircles] = useState<Circle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCircles = useCallback(async () => {
    if (!user) { console.log('[Circles] fetchCircles skipped — no user'); return; }
    console.log('[Circles] fetchCircles start, user:', user.id);
    setError(null);

    await ensureAllFriendsCircle(user.id);

    const { data, error: fetchError } = await supabase
      .from('circles')
      .select('id, name, emoji, created_by, created_at, is_all_friends')
      .eq('created_by', user.id)
      .order('created_at', { ascending: false });

    if (fetchError) {
      console.error('[Circles] query error:', fetchError.message);
      setError(fetchError.message);
      return;
    }
    console.log('[Circles] query ok, count:', data?.length);

    const sorted = (data ?? []).map((c: any) => ({ ...c, is_owner: true }));
    sorted.sort((a: Circle, b: Circle) => {
      if (a.is_all_friends && !b.is_all_friends) return -1;
      if (!a.is_all_friends && b.is_all_friends) return 1;
      return 0;
    });
    setCircles(sorted);
  }, [user]);

  // Initial load + re-fetch when auth state changes (user becomes non-null after login)
  useEffect(() => {
    console.log('[Circles] useEffect fired, user:', user?.id ?? 'null');
    if (!user) return;
    setLoading(true);
    fetchCircles().finally(() => setLoading(false));
  }, [fetchCircles]);

  // Silent background refresh when screen comes back into focus (e.g. after delete).
  // Skip the very first focus so we don't double-fetch on mount.
  const skipFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocus.current) { skipFirstFocus.current = false; return; }
      if (!user) return;
      fetchCircles();
    }, [fetchCircles, user])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchCircles();
    setRefreshing(false);
  }, [fetchCircles]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>Circles</Text>
          <Text style={styles.headerSubtitle}>Your curated friend groups</Text>
          <Text style={styles.headerHint}>Only you can see who's on a circle.</Text>
          <Text style={styles.headerExamples}>
            Examples: PlayStation buddies 🎮, dog walkers 🐕
          </Text>
        </View>
        <TouchableOpacity style={styles.newButton} onPress={() => router.push('/(app)/circle/new?fromTab=circles')}>
          <Ionicons name="add" size={28} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><Text style={styles.loadingText}>Loading…</Text></View>
      ) : error ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <EmptyState
            emoji="⚠️"
            title="Couldn't load circles"
            subtitle={error}
            action={<Button label="Retry" onPress={onRefresh} />}
          />
        </ScrollView>
      ) : circles.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <EmptyState
            emoji="⭕"
            title="No circles yet"
            subtitle="Create a circle for each group of friends — gym crew, board game pals, spontaneous adventures…"
            action={<Button label="Create your first Circle" onPress={() => router.push('/(app)/circle/new?fromTab=circles')} />}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={circles}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <CircleCard circle={item} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12,
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 24, fontWeight: '800', color: Colors.text },
  headerSubtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  headerHint: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  headerExamples: { fontSize: 13, color: Colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  newButton: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  emptyContainer: { flexGrow: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
});
