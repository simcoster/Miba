import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  Linking, Modal, View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Session, User } from '@supabase/supabase-js';
import Colors from '@/constants/Colors';
import { supabase } from '@/lib/supabase';
import { registerForPushNotifications } from '@/lib/mipoNotifications';
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
  const [pushPopup, setPushPopup] = useState<{ title: string; message: string; isError: boolean } | null>(null);

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
      // Linking.getInitialURL() can hang on Android — cap at 2s
      const initialUrl = await Promise.race([
        Linking.getInitialURL(),
        new Promise<string | null>((r) => setTimeout(() => r(null), 2000)),
      ]);
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

    // Failsafe: force loading=false after 5s if init hangs (network, getSession, etc.)
    const failsafe = setTimeout(() => {
      if (!cancelled) {
        console.warn('[Auth] init timeout — forcing loading=false');
        setLoading(false);
      }
    }, 5000);

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
      clearTimeout(failsafe);
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    registerForPushNotifications(user.id).then((result) => {
      // Permission denial is expected — don't surface as an error
      if (!result.success && result.error && !result.error.startsWith('Permission')) {
        setPushPopup({
          title: 'Push registration failed',
          message: result.error ?? 'Unknown error',
          isError: true,
        });
      }
    });
  }, [user]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider value={{ session, user, profile, loading, signOut, refreshProfile }}>
      {children}
      <Modal visible={!!pushPopup} transparent animationType="fade">
        <TouchableOpacity
          style={popupStyles.overlay}
          activeOpacity={1}
          onPress={() => setPushPopup(null)}
        >
          <View style={popupStyles.card} onStartShouldSetResponder={() => true}>
            <View style={popupStyles.header}>
              <Text style={[popupStyles.title, pushPopup?.isError && popupStyles.titleError]}>
                {pushPopup?.title}
              </Text>
              <TouchableOpacity
                onPress={() => setPushPopup(null)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={popupStyles.closeBtn}
              >
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={popupStyles.scroll}
              contentContainerStyle={popupStyles.scrollContent}
              showsVerticalScrollIndicator={true}
            >
              <Text style={popupStyles.message} selectable>
                {pushPopup?.message}
              </Text>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </AuthContext.Provider>
  );
}

const popupStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    maxWidth: 400,
    width: '100%',
    maxHeight: '80%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    flex: 1,
  },
  titleError: {
    color: Colors.danger,
  },
  closeBtn: {
    padding: 4,
  },
  scroll: {
    maxHeight: 300,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 24,
  },
  message: {
    fontSize: 14,
    color: Colors.text,
    lineHeight: 20,
  },
});

export const useAuth = () => useContext(AuthContext);
