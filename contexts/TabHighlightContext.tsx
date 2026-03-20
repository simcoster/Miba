import React, { createContext, useContext, useEffect, useState } from 'react';
import { useFocusEffect, usePathname } from 'expo-router';

/** Tab names that appear in the bottom tab bar */
export type TabName = 'index' | 'events' | 'circles' | 'profile' | 'chats' | 'mipo';

/** Maps fromTab param (e.g. from events filter) to the actual tab name */
function fromTabToTabName(fromTab: string | undefined): TabName | null {
  if (!fromTab) return null;
  const lower = fromTab.toLowerCase();
  if (['upcoming', 'invited', 'past', 'declined'].includes(lower)) return 'events';
  if (lower === 'updates') return 'index';
  if (['chats', 'mipo', 'index', 'events', 'circles', 'profile'].includes(lower)) return lower as TabName;
  return null;
}

type TabHighlightContextType = {
  /** When on activity/[id]/index or activity/[id]/chat, which tab should appear selected */
  effectiveTab: TabName | null;
  setEffectiveTab: (tab: TabName | null) => void;
};

const TabHighlightContext = createContext<TabHighlightContextType>({
  effectiveTab: null,
  setEffectiveTab: () => {},
});

export function TabHighlightProvider({ children }: { children: React.ReactNode }) {
  const [effectiveTab, setEffectiveTabState] = useState<TabName | null>(null);
  const setEffectiveTab = React.useCallback((tab: TabName | null) => {
    setEffectiveTabState(tab);
  }, []);

  return (
    <TabHighlightContext.Provider value={{ effectiveTab: effectiveTab, setEffectiveTab }}>
      {children}
    </TabHighlightContext.Provider>
  );
}

export function useTabHighlight() {
  return useContext(TabHighlightContext);
}

/** Call from activity/[id]/index or activity/[id]/chat to set which tab should be highlighted */
export function useSetTabHighlight(fromTab: string | undefined) {
  const { setEffectiveTab } = useTabHighlight();
  useEffect(() => {
    const tab = fromTabToTabName(fromTab);
    setEffectiveTab(tab);
    return () => setEffectiveTab(null);
  }, [fromTab, setEffectiveTab]);
}

/** Call from main tab screens (index, events, circles, profile, chats, mipo) to clear highlight when user taps that tab */
export function useClearTabHighlightOnFocus() {
  const { setEffectiveTab } = useTabHighlight();
  const pathname = usePathname();
  useFocusEffect(
    React.useCallback(() => {
      // Defer clear so that when navigating to a child (e.g. circle/[id], activity/[id]),
      // the child's useSetTabHighlight runs first. If we lose focus before the timeout,
      // we cancel the clear so the highlight stays.
      const id = setTimeout(() => {
        // Don't clear when we're on a nested route (activity, circle) — the child screen
        // set the effectiveTab and we should preserve it.
        const isNestedRoute = pathname?.includes('/activity/') || pathname?.includes('/circle/');
        if (!isNestedRoute) {
          setEffectiveTab(null);
        }
      }, 0);
      return () => clearTimeout(id);
    }, [setEffectiveTab, pathname])
  );
}
