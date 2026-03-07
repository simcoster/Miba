import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { fetchUpdates } from '@/lib/fetchUpdates';
import { useAuth } from '@/contexts/AuthContext';

type UpdatesCountContextValue = {
  count: number;
  refresh: () => Promise<void>;
};

const UpdatesCountContext = createContext<UpdatesCountContextValue | null>(null);

export function UpdatesCountProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const entries = await fetchUpdates(user.id);
      setCount(entries.length);
    } catch {
      // Keep previous count on error
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    refresh();
  }, [user, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && user) {
        refresh();
      }
    });
    return () => sub.remove();
  }, [user, refresh]);

  return (
    <UpdatesCountContext.Provider value={{ count, refresh }}>
      {children}
    </UpdatesCountContext.Provider>
  );
}

export function useUpdatesCount() {
  const ctx = useContext(UpdatesCountContext);
  if (!ctx) throw new Error('useUpdatesCount must be used within UpdatesCountProvider');
  return ctx;
}
