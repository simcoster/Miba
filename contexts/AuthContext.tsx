import React, { createContext, useContext, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isAuthCallbackUrl, processAuthCallbackUrl } from '@/lib/authCallback';
import { Profile } from '@/lib/types';

type AuthContextType = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (userId: string) => {
    console.log('[Auth] fetchProfile start', userId);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    console.log('[Auth] fetchProfile done', { ok: !error, error: error?.message });
    if (!error && data) setProfile(data as Profile);
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl && isAuthCallbackUrl(initialUrl)) {
        console.log('[Auth] Processing initial URL (OAuth callback from cold start)');
        await processAuthCallbackUrl(initialUrl);
        if (!cancelled) setLoading(false);
        return;
      }

      console.log('[Auth] init — calling getSession');
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      console.log('[Auth] getSession returned, user:', session?.user?.id ?? 'none');
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => {
          if (!cancelled) {
            console.log('[Auth] setLoading(false) via getSession path');
            setLoading(false);
          }
        });
      } else {
        console.log('[Auth] setLoading(false) — no session');
        setLoading(false);
      }
    };
    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        console.log('[Auth] onAuthStateChange event:', _event, 'user:', session?.user?.id ?? 'none');
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
        } else {
          setProfile(null);
        }
        console.log('[Auth] setLoading(false) via onAuthStateChange');
        setLoading(false);
      }
    );

    const linkSub = Linking.addEventListener('url', ({ url }) => {
      if (isAuthCallbackUrl(url)) {
        console.log('[Auth] Processing URL from Linking event (app brought to foreground)');
        processAuthCallbackUrl(url);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
