import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { supabase } from '@/lib/supabase';
import { addUsersToAllFriends } from '@/lib/allFriends';
import { processAuthCallbackUrl } from '@/lib/authCallback';

WebBrowser.maybeCompleteAuthSession();

const CONTACT_IMPORT_OFFERED_KEY = 'miba_contact_import_offered';

export async function hasOfferedImport(): Promise<boolean> {
  const v = await AsyncStorage.getItem(CONTACT_IMPORT_OFFERED_KEY);
  return v === 'true';
}

export async function markImportOffered(): Promise<void> {
  await AsyncStorage.setItem(CONTACT_IMPORT_OFFERED_KEY, 'true');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

const GOOGLE_CONTACTS_SCOPE = 'https://www.googleapis.com/auth/contacts.readonly';

/**
 * Requests Google OAuth with contacts scope and returns the provider access token.
 * Opens the browser for the user to grant permission if needed.
 */
async function requestGoogleContactsAccess(): Promise<string | null> {
  const redirectTo = makeRedirectUri();
  console.warn('[ContactImport] requestGoogleContactsAccess start, redirectTo:', redirectTo);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      scopes: `email profile openid ${GOOGLE_CONTACTS_SCOPE}`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    console.warn('[ContactImport] signInWithOAuth error:', error.message);
    return null;
  }
  if (!data?.url) {
    console.warn('[ContactImport] signInWithOAuth: no URL returned');
    return null;
  }

  console.warn('[ContactImport] Opening browser, expecting redirect to:', redirectTo);
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  console.warn('[ContactImport] Browser returned, type:', result.type, 'url:', result.type === 'success' ? result.url?.slice(0, 80) + '...' : 'n/a');

  if (result.type !== 'success') return null;

  const ok = await processAuthCallbackUrl(result.url);
  console.warn('[ContactImport] processAuthCallbackUrl:', ok ? 'ok' : 'failed');

  if (!ok) return null;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.provider_token ?? null;
  console.warn('[ContactImport] provider_token:', token ? `${token.slice(0, 20)}...` : 'MISSING', 'session keys:', session ? Object.keys(session) : 'no session');
  return token;
}

type GooglePerson = {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string }[];
};

/**
 * Fetches contacts from Google People API and saves to contact_imports.
 * Requests OAuth permission if needed.
 */
export async function importContacts(userId: string): Promise<{ count: number; error?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  let accessToken = session?.provider_token ?? null;
  console.warn('[ContactImport] importContacts start, has provider_token:', !!accessToken);

  if (!accessToken) {
    accessToken = await requestGoogleContactsAccess();
  }

  if (!accessToken) {
    console.warn('[ContactImport] No access token after requestGoogleContactsAccess');
    return { count: 0, error: 'Google contacts permission denied or sign-in was cancelled' };
  }

  const seen = new Set<string>();
  const rows: { user_id: string; email: string | null; phone: string | null; name: string | null }[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections');
    url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.warn('[ContactImport] People API error:', res.status, errBody?.slice(0, 200));
      if (res.status === 401) {
        return { count: 0, error: 'Google sign-in expired. Please try again.' };
      }
      return { count: 0, error: `Google API error: ${res.status}` };
    }

    const json = (await res.json()) as {
      connections?: GooglePerson[];
      nextPageToken?: string;
    };

    for (const person of json.connections ?? []) {
      const name = person.names?.[0]?.displayName ?? null;
      const emails = (person.emailAddresses ?? []).map(e => normalizeEmail(e.value ?? '')).filter(Boolean);
      const phones = (person.phoneNumbers ?? [])
        .map(p => normalizePhone(p.value ?? ''))
        .filter(p => p.length >= 10);

      for (const email of emails) {
        const key = `e:${email}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ user_id: userId, email, phone: null, name });
        }
      }
      for (const phone of phones) {
        const key = `p:${phone}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ user_id: userId, email: null, phone, name });
        }
      }
    }

    pageToken = json.nextPageToken;
  } while (pageToken);

  if (rows.length === 0) return { count: 0 };

  await supabase.from('contact_imports').delete().eq('user_id', userId);

  const { error } = await supabase.from('contact_imports').insert(rows);

  if (error) {
    return { count: 0, error: error.message };
  }

  await addContactsOnMibaToAllFriends(userId, rows);

  return { count: rows.length };
}

function normalizePhoneForMatch(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Finds imported contacts that exist on Miba (profiles) and adds them to All Friends.
 */
async function addContactsOnMibaToAllFriends(
  userId: string,
  importedRows: { email: string | null; phone: string | null }[]
): Promise<void> {
  const emails = new Set(
    importedRows
      .map((r) => r.email?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e))
  );
  const phones = new Set(
    importedRows
      .map((r) => r.phone && normalizePhoneForMatch(r.phone))
      .filter((p): p is string => p != null && p.length >= 10)
  );
  if (emails.size === 0 && phones.size === 0) return;

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, phone')
    .neq('id', userId)
    .or('email.not.is.null,phone.not.is.null')
    .limit(2000);

  const matchingIds = new Set<string>();
  for (const p of profiles ?? []) {
    if (p.email && emails.has(p.email.trim().toLowerCase())) {
      matchingIds.add(p.id);
    } else if (p.phone && phones.has(normalizePhoneForMatch(p.phone))) {
      matchingIds.add(p.id);
    }
  }

  if (matchingIds.size > 0) {
    await addUsersToAllFriends(userId, Array.from(matchingIds));
  }
}
