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
