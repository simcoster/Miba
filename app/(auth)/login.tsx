import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Alert, Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import Colors from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const signInWithGoogle = async () => {
    try {
      setLoading(true);

      // makeRedirectUri handles Expo Go vs standalone (miba://) correctly.
      // PKCE flow (flowType in supabase.ts) uses query params, which Android preserves.
      const redirectTo = makeRedirectUri();
      console.log('[OAuth] redirectTo:', redirectTo);

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });

      if (error) throw error;
      if (!data.url) throw new Error('No OAuth URL returned');

      console.log('[OAuth] data.url:', data.url);
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

      console.log('[OAuth] result type:', result.type);
      if (result.type !== 'success') {
        // User cancelled or something went wrong — just stop loading, no error
        return;
      }

      const url = result.url;

      // Parse both hash fragments (implicit flow) AND query params (PKCE flow)
      const parseUrlParams = (url: string): Record<string, string> => {
        const params: Record<string, string> = {};

        // Query params (?key=value)
        const queryIndex = url.indexOf('?');
        if (queryIndex !== -1) {
          const queryStr = url.slice(queryIndex + 1).split('#')[0];
          new URLSearchParams(queryStr).forEach((v, k) => { params[k] = v; });
        }

        // Hash fragment (#key=value) — Supabase implicit flow
        const hashIndex = url.indexOf('#');
        if (hashIndex !== -1) {
          new URLSearchParams(url.slice(hashIndex + 1)).forEach((v, k) => { params[k] = v; });
        }

        return params;
      };

      const params = parseUrlParams(url);

      if (params.access_token && params.refresh_token) {
        // Implicit flow — tokens are directly in the URL
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (sessionError) throw sessionError;
      } else if (params.code) {
        // PKCE flow — exchange the code for a session
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(url);
        if (exchangeError) throw exchangeError;
      } else {
        throw new Error('No tokens or code found in redirect URL. Check Supabase redirect URL settings.');
      }

      router.replace('/(app)');
    } catch (error: any) {
      Alert.alert('Sign-in failed', error.message ?? 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={[Colors.gradientStart, Colors.gradientEnd]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.container}
    >
      <View style={styles.logoArea}>
        <View style={styles.logoCircle}>
          <Image
            source={require('../../assets/images/icon.png')}
            style={{ width: 64, height: 64, borderRadius: 32 }}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.appName}>Miba</Text>
        <Text style={styles.appNameHebrew}>מי בא?</Text>
      </View>
      <View style={{ height: 36 }} />


      <View style={styles.card}>
        <Text style={styles.cardTitle}>Get started</Text>
        <Text style={styles.cardSubtitle}>Sign in to find your crew for every adventure</Text>

        <TouchableOpacity
          style={[styles.googleButton, loading && styles.buttonDisabled]}
          onPress={signInWithGoogle}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color={Colors.text} size="small" />
          ) : (
            <>
              <View style={styles.googleIconContainer}>
                <Text style={styles.googleIconText}>G</Text>
              </View>
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          By continuing you agree to Miba's Terms of Service and Privacy Policy.
        </Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1, justifyContent: 'center',
    paddingTop: Platform.OS === 'ios' ? 80 : 60,
    paddingBottom: 40, paddingHorizontal: 24,
  },
  logoArea: { alignItems: 'center' },
  logoCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  logoEmoji: { fontSize: 48 },
  appName: { fontSize: 42, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1 },
  appNameHebrew: { fontSize: 22, fontWeight: '600', color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  tagline: { fontSize: 16, color: 'rgba(255,255,255,0.8)', marginTop: 6 },
  valueProps: { gap: 12 },
  valuePropRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  valuePropIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center',
  },
  valuePropText: { flex: 1, fontSize: 15, color: '#FFFFFF', fontWeight: '500' },
  card: {
    backgroundColor: Colors.surface, borderRadius: 24, padding: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  cardTitle: { fontSize: 24, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  cardSubtitle: { fontSize: 14, color: Colors.textSecondary, marginBottom: 24, lineHeight: 20 },
  googleButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 14, paddingVertical: 14, paddingHorizontal: 20,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  buttonDisabled: { opacity: 0.6 },
  googleIconContainer: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center',
  },
  googleIconText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  googleButtonText: { fontSize: 16, fontWeight: '600', color: Colors.text },
  disclaimer: { marginTop: 16, fontSize: 11, color: Colors.textSecondary, textAlign: 'center', lineHeight: 16 },
});
