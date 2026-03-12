import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'miba_tutorial_completed';

export async function hasTutorialCompleted(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY);
  return v === 'true';
}

export async function markTutorialCompleted(): Promise<void> {
  await AsyncStorage.setItem(KEY, 'true');
}

export async function resetTutorial(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
