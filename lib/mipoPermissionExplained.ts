import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'miba_mipo_permission_explained';

export async function hasMipoPermissionBeenExplained(): Promise<boolean> {
  const v = await AsyncStorage.getItem(KEY);
  return v === 'true';
}

export async function markMipoPermissionExplained(): Promise<void> {
  await AsyncStorage.setItem(KEY, 'true');
}
