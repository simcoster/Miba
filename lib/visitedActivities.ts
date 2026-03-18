import AsyncStorage from '@react-native-async-storage/async-storage';

const VISITED_KEY = 'miba_visited_activity_details';

export async function getVisitedActivityIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(VISITED_KEY);
  if (!raw) return new Set();
  try {
    const arr = JSON.parse(raw) as string[];
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

export async function markActivityVisited(activityId: string): Promise<void> {
  const ids = await getVisitedActivityIds();
  if (ids.has(activityId)) return;
  ids.add(activityId);
  await AsyncStorage.setItem(VISITED_KEY, JSON.stringify([...ids]));
}
