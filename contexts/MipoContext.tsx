import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type MipoVisibleState = {
  isVisible: boolean;
  expiresAt: Date | null;
};

type MipoContextType = {
  visibleState: MipoVisibleState;
  setVisible: (visible: boolean, expiresAt?: Date | null) => void;
  refreshVisibleState: () => Promise<void>;
};

const MipoContext = createContext<MipoContextType>({
  visibleState: { isVisible: false, expiresAt: null },
  setVisible: () => {},
  refreshVisibleState: async () => {},
});

export function MipoProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [visibleState, setVisibleState] = useState<MipoVisibleState>({
    isVisible: false,
    expiresAt: null,
  });

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

  useEffect(() => {
    refreshVisibleState();
  }, [user, refreshVisibleState]);

  return (
    <MipoContext.Provider value={{ visibleState, setVisible, refreshVisibleState }}>
      {children}
    </MipoContext.Provider>
  );
}

export function useMipo() {
  const ctx = useContext(MipoContext);
  if (!ctx) throw new Error('useMipo must be used within MipoProvider');
  return ctx;
}
