import AsyncStorage from '@react-native-async-storage/async-storage';

const HIDDEN_KEY = 'miba_hidden_activities';

export async function getHiddenActivityIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(HIDDEN_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

export async function toggleHidden(activityId: string): Promise<boolean> {
  const ids = await getHiddenActivityIds();
  const isCurrentlyHidden = ids.has(activityId);
  if (isCurrentlyHidden) {
    ids.delete(activityId);
  } else {
    ids.add(activityId);
  }
  await AsyncStorage.setItem(HIDDEN_KEY, JSON.stringify([...ids]));
  return !isCurrentlyHidden; // returns new hidden state (true = now hidden, false = now visible)
}

export function isHidden(activityId: string, hiddenIds: Set<string>): boolean {
  return hiddenIds.has(activityId);
}
