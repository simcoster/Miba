import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Contacts from 'expo-contacts';
import { supabase } from '@/lib/supabase';
import { addUsersToAllFriends } from '@/lib/allFriends';

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

type ImportRow = { user_id: string; email: string | null; phone: string | null; name: string | null };

async function fetchGoogleContacts(accessToken: string): Promise<ImportRow[]> {
  const seen = new Set<string>();
  const rows: ImportRow[] = [];

  let pageToken: string | undefined;
  const personFields = 'names,emailAddresses,phoneNumbers';

  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections');
    url.searchParams.set('personFields', personFields);
    url.searchParams.set('pageSize', '500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('GOOGLE_SCOPE_REQUIRED');
    }
    if (!res.ok) {
      throw new Error(`Google People API returned ${res.status}`);
    }

    const data = await res.json();
    const connections: Array<{
      names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
      emailAddresses?: Array<{ value?: string }>;
      phoneNumbers?: Array<{ value?: string }>;
    }> = data.connections ?? [];

    for (const p of connections) {
      const name = p.names?.[0]?.displayName
        ?? [p.names?.[0]?.givenName, p.names?.[0]?.familyName].filter(Boolean).join(' ')
        ?? null;
      const emails = (p.emailAddresses ?? []).map(e => normalizeEmail(e.value ?? '')).filter(Boolean);
      const phones = (p.phoneNumbers ?? [])
        .map(ph => normalizePhone(ph.value ?? ''))
        .filter(ph => ph.length >= 10);

      for (const email of emails) {
        const key = `e:${email}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ user_id: '', email, phone: null, name });
        }
      }
      for (const phone of phones) {
        const key = `p:${phone}`;
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ user_id: '', email: null, phone, name });
        }
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return rows;
}

export type ImportGoogleResult =
  | { count: number }
  | { count: 0; error: string; needsReauth?: boolean };

export async function importGoogleContacts(
  userId: string,
  accessToken?: string | null
): Promise<ImportGoogleResult> {
  const token = accessToken ?? (await supabase.auth.getSession()).data.session?.provider_token;

  if (!token) {
    return {
      count: 0,
      error: 'Google contacts access is needed. Sign in again when prompted.',
      needsReauth: true,
    };
  }

  try {
    const fetched = await fetchGoogleContacts(token);
    const rows = fetched.map(r => ({ ...r, user_id: userId }));

    if (rows.length === 0) return { count: 0 };

    await supabase.from('contact_imports').delete().eq('user_id', userId);
    const { error } = await supabase.from('contact_imports').insert(rows);

    if (error) {
      return { count: 0, error: error.message };
    }

    await addContactsOnMibaToAllFriends(userId, rows);
    return { count: rows.length };
  } catch (e: any) {
    if (e.message === 'GOOGLE_SCOPE_REQUIRED') {
      return {
        count: 0,
        error: 'Google contacts access is needed. Sign in again when prompted.',
        needsReauth: true,
      };
    }
    return {
      count: 0,
      error: e.message ?? 'Could not import Google contacts.',
    };
  }
}

export async function importContacts(userId: string): Promise<{ count: number; error?: string }> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    return { count: 0, error: 'Contacts permission denied' };
  }

  const { data } = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Emails, Contacts.Fields.PhoneNumbers],
  });

  const seen = new Set<string>();
  const rows: { user_id: string; email: string | null; phone: string | null; name: string | null }[] = [];

  for (const contact of data) {
    const name = contact.name ?? null;
    const emails = (contact.emails ?? []).map(e => normalizeEmail(e.email ?? '')).filter(Boolean);
    const phones = (contact.phoneNumbers ?? [])
      .map(p => normalizePhone(p.number ?? ''))
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

  if (rows.length === 0) return { count: 0 };

  await supabase.from('contact_imports').delete().eq('user_id', userId);

  const { error } = await supabase.from('contact_imports').insert(rows);

  if (error) {
    return { count: 0, error: error.message };
  }

  // Add all contacts who are on Miba to the All Friends circle
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
