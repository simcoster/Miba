import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { subMinutes } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Profile } from '@/lib/types';

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
};

const MipoContext = createContext<MipoContextType>({
  visibleState: { isVisible: false, expiresAt: null },
  setVisible: () => {},
  refreshVisibleState: async () => {},
  nearbyEvents: [],
  refreshNearby: async () => {},
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
          content: { title: 'Friend nearby!', body: `${otherName} is nearby`, sound: 'default' },
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

  return (
    <MipoContext.Provider value={{ visibleState, setVisible, refreshVisibleState, nearbyEvents, refreshNearby }}>
      {children}
    </MipoContext.Provider>
  );
}

export function useMipo() {
  const ctx = useContext(MipoContext);
  if (!ctx) throw new Error('useMipo must be used within MipoProvider');
  return ctx;
}
