import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Activity } from '@/lib/types';
import { ActivityCard } from '@/components/ActivityCard';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/Button';
import Colors from '@/constants/Colors';

type Filter = 'upcoming' | 'past';

export default function HomeScreen() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [error, setError] = useState<string | null>(null);

  const fetchActivities = useCallback(async () => {
    if (!user) return;
    setError(null);
    const now = new Date().toISOString();
    const isUpcoming = filter === 'upcoming';

    const { data, error: fetchError } = await supabase
      .from('activities')
      .select(`
        *,
        creator:profiles!activities_created_by_fkey(id, full_name, avatar_url),
        rsvps(id, status, user_id, created_at, updated_at, profile:profiles(id, full_name, avatar_url))
      `)
      .eq('status', 'active')
      .order('activity_time', { ascending: isUpcoming })
      .filter('activity_time', isUpcoming ? 'gte' : 'lt', now);

    if (fetchError) {
      console.error('[Home] error:', fetchError);
      setError(fetchError.message);
      return;
    }

    setActivities(
      (data ?? []).map((a: any) => ({
        ...a,
        my_rsvp: a.rsvps?.find((r: any) => r.user_id === user.id) ?? null,
        going_count: a.rsvps?.filter((r: any) => r.status === 'in').length ?? 0,
      })) as Activity[]
    );
  }, [user, filter]);

  // Initial load + re-fetch when auth state changes
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    fetchActivities().finally(() => setLoading(false));
  }, [fetchActivities]);

  // Silent background refresh when screen regains focus (after creating/editing an activity)
  const skipFirstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (skipFirstFocus.current) { skipFirstFocus.current = false; return; }
      if (!user) return;
      fetchActivities();
    }, [fetchActivities, user])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActivities();
    setRefreshing(false);
  }, [fetchActivities]);

  const hour = new Date().getHours();
  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const greeting = `${hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}${firstName ? `, ${firstName}` : ''} 👋`;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.subtitle}>What are you doing today?</Text>
        </View>
        <TouchableOpacity style={styles.newButton} onPress={() => router.push('/(app)/activity/new')}>
          <Ionicons name="add" size={28} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        {(['upcoming', 'past'] as Filter[]).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
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
            title="Couldn't load activities"
            subtitle={error}
            action={<Button label="Retry" onPress={onRefresh} />}
          />
        </ScrollView>
      ) : activities.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <EmptyState
            emoji={filter === 'upcoming' ? '🌅' : '📅'}
            title={filter === 'upcoming' ? 'Nothing planned yet' : 'No past activities'}
            subtitle={filter === 'upcoming' ? 'Post an activity to a Circle and see who joins!' : 'Your attended activities will appear here.'}
            action={filter === 'upcoming' ? <Button label="Post an activity" onPress={() => router.push('/(app)/activity/new')} /> : undefined}
          />
        </ScrollView>
      ) : (
        <FlatList
          data={activities}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <ActivityCard activity={item} />}
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
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16, paddingTop: 12,
  },
  greeting: { fontSize: 24, fontWeight: '800', color: Colors.text },
  subtitle: { fontSize: 14, color: Colors.textSecondary, marginTop: 2 },
  newButton: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center',
  },
  filterRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 12 },
  filterTab: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.borderLight },
  filterTabActive: { backgroundColor: Colors.primary },
  filterText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  filterTextActive: { color: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  emptyContainer: { flexGrow: 1 },
  list: { paddingHorizontal: 20, paddingBottom: 100 },
});
