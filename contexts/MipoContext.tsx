import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import Toast from 'react-native-toast-message';
import * as Notifications from 'expo-notifications';
import { subMinutes } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Profile } from '@/lib/types';
import { hasLocationPermission, isMipoLocationHeartbeatStale, turnOffMipoVisibleMode } from '@/lib/mipoLocation';

export type MipoVisibleState = {
  isVisible: boolean;
  expiresAt: Date | null;
};

export type ProximityEventWithProfile = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
  other_profile: Pick<Profile, 'id' | 'full_name' | 'avatar_url'> | null;
};

type MipoContextType = {
  visibleState: MipoVisibleState;
  setVisible: (visible: boolean, expiresAt?: Date | null) => void;
  refreshVisibleState: () => Promise<void>;
  nearbyEvents: ProximityEventWithProfile[];
  refreshNearby: () => Promise<void>;
  /** Call when app foregrounds or Mipo tab gains focus to detect if service was killed (e.g. user swiped notification) */
  checkAndTurnOffIfServiceStopped: () => Promise<void>;
};

const MipoContext = createContext<MipoContextType>({
  visibleState: { isVisible: false, expiresAt: null },
  setVisible: () => {},
  refreshVisibleState: async () => {},
  nearbyEvents: [],
  refreshNearby: async () => {},
  checkAndTurnOffIfServiceStopped: async () => {},
});

export function MipoProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [visibleState, setVisibleState] = useState<MipoVisibleState>({
    isVisible: false,
    expiresAt: null,
  });
  const [nearbyEvents, setNearbyEvents] = useState<ProximityEventWithProfile[]>([]);
  const lastNotifiedEventId = useRef<string | null>(null);

  const refreshVisibleState = useCallback(async () => {
    if (!user) {
      setVisibleState({ isVisible: false, expiresAt: null });
      return;
    }
    const { data } = await supabase
      .from('mipo_visible_sessions')
      .select('expires_at')
      .eq('user_id', user.id)
      .single();
    if (data) {
      const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
      const isExpired = expiresAt ? expiresAt <= new Date() : false;
      setVisibleState({
        isVisible: !isExpired,
        expiresAt: expiresAt,
      });
    } else {
      setVisibleState({ isVisible: false, expiresAt: null });
    }
  }, [user]);

  const setVisible = useCallback((visible: boolean, expiresAt?: Date | null) => {
    setVisibleState({
      isVisible: visible,
      expiresAt: expiresAt ?? null,
    });
  }, []);

  const refreshNearby = useCallback(async (fromRealtime?: boolean) => {
    if (!user) return;
    const cutoff = subMinutes(new Date(), 30).toISOString();
    const { data } = await supabase.rpc('mipo_nearby_events', {
      p_user_id: user.id,
      p_cutoff: cutoff,
    });
    const events: ProximityEventWithProfile[] = (data ?? []).map((row: any) => {
      const otherId = row.user_a_id === user.id ? row.user_b_id : row.user_a_id;
      return {
        id: row.id,
        user_a_id: row.user_a_id,
        user_b_id: row.user_b_id,
        created_at: row.created_at,
        other_profile: { id: row.other_id, full_name: row.other_full_name, avatar_url: row.other_avatar_url },
      };
    });
    setNearbyEvents(events);
    if (fromRealtime && events.length > 0) {
      const newest = events[0];
      if (newest.id !== lastNotifiedEventId.current) {
        lastNotifiedEventId.current = newest.id;
        const otherName = newest.other_profile?.full_name ?? 'A friend';
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Friend nearby!',
            body: `${otherName} is nearby`,
            sound: 'match_playful.mp3',
            ...(Platform.OS === 'android' && { channelId: 'mipo-proximity' }),
          },
          trigger: null,
        }).catch(() => {});
      }
    }
  }, [user]);

  useEffect(() => {
    refreshVisibleState();
  }, [user, refreshVisibleState]);

  // Realtime subscription - always active when logged in (not tied to Mipo screen mount)
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('mipo_nearby')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mipo_proximity_events' }, () => refreshNearby(true))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'mipo_visible_sessions' }, () => refreshNearby())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mipo_visible_sessions' }, () => refreshNearby())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, refreshNearby]);

  // Fetch nearby only when visible (initial fetch + periodic refetch)
  useEffect(() => {
    if (!visibleState.isVisible || !user) return;
    refreshNearby();
    const interval = setInterval(() => refreshNearby(), 30000);
    return () => clearInterval(interval);
  }, [visibleState.isVisible, user, refreshNearby]);

  const checkAndTurnOffIfServiceStopped = useCallback(async () => {
    if (!user || !visibleState.isVisible) return;
    try {
      const hasPermission = await hasLocationPermission();
      if (!hasPermission) {
        await turnOffMipoVisibleMode(user.id);
        setVisible(false, null);
        refreshVisibleState();
        Toast.show({
          type: 'info',
          text1: 'Mipo visible mode turned off',
          text2: 'Location disabled. Re-enable in Mipo tab.',
        });
        return;
      }
      const stale = await isMipoLocationHeartbeatStale(user.id);
      if (stale) {
        await turnOffMipoVisibleMode(user.id);
        setVisible(false, null);
        refreshVisibleState();
        Toast.show({
          type: 'info',
          text1: 'Mipo visible mode turned off',
          text2: 'Tracking stopped. Re-enable in Mipo tab.',
        });
      }
    } catch {
      // Ignore errors
    }
  }, [user, visibleState.isVisible, setVisible, refreshVisibleState]);

  // When app returns from background: run heartbeat + permission check
  useEffect(() => {
    if (!user || !visibleState.isVisible) return;
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') checkAndTurnOffIfServiceStopped();
    };
    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => sub.remove();
  }, [user, visibleState.isVisible, checkAndTurnOffIfServiceStopped]);

  // Periodic check while visible: detect if user disabled location while still on Mipo screen
  useEffect(() => {
    if (!user || !visibleState.isVisible) return;
    const interval = setInterval(checkAndTurnOffIfServiceStopped, 10_000);
    return () => clearInterval(interval);
  }, [user, visibleState.isVisible, checkAndTurnOffIfServiceStopped]);

  return (
    <MipoContext.Provider value={{ visibleState, setVisible, refreshVisibleState, nearbyEvents, refreshNearby, checkAndTurnOffIfServiceStopped }}>
      {children}
    </MipoContext.Provider>
  );
}

export function useMipo() {
  const ctx = useContext(MipoContext);
  if (!ctx) throw new Error('useMipo must be used within MipoProvider');
  return ctx;
}
