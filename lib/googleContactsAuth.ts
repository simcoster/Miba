/**
 * Gets a Google access token with contacts scope for importing contacts.
 * Uses direct Google OAuth (bypassing Supabase for this scope) and a Supabase
 * Edge Function to exchange the code for a token (client secret stays server-side).
 * Supabase does not reliably return provider_token for Google OAuth.
 */
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from '@/lib/supabase';

WebBrowser.maybeCompleteAuthSession();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';

export async function getGoogleContactsAccessToken(): Promise<{ accessToken: string } | { error: string }> {
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return { error: 'Google OAuth client ID not configured. Add EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID to .env (same as Supabase Google provider).' };
  }

  const redirectUri = makeRedirectUri();
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', CONTACTS_SCOPE);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  const result = await WebBrowser.openAuthSessionAsync(authUrl.toString(), redirectUri);
  if (result.type !== 'success' || !result.url) {
    return { error: 'Sign-in cancelled' };
  }

  const params = parseUrlParams(result.url);
  const code = params.code;
  if (!code) {
    const error = params.error || 'No authorization code received';
    return { error: error === 'access_denied' ? 'Sign-in cancelled' : error };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { error: 'Not signed in' };
  }

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://qfdxnpryufkgdstergej.supabase.co';
  const funcUrl = `${supabaseUrl}/functions/v1/exchange-google-code`;
  const res = await fetch(funcUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ code, redirect_uri: redirectUri }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    let errMsg = 'Could not complete sign-in';
    try {
      const parsed = JSON.parse(errBody);
      if (parsed.error) errMsg = parsed.error;
    } catch { /* ignore */ }
    return { error: errMsg };
  }

  const data = await res.json();
  const accessToken = data.access_token;
  if (!accessToken) {
    return { error: 'No access token received' };
  }

  return { accessToken };
}

function parseUrlParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};
  const queryIndex = url.indexOf('?');
  if (queryIndex !== -1) {
    const queryStr = url.slice(queryIndex + 1).split('#')[0];
    new URLSearchParams(queryStr).forEach((v, k) => { params[k] = v; });
  }
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    new URLSearchParams(url.slice(hashIndex + 1)).forEach((v, k) => { params[k] = v; });
  }
  return params;
}
