import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Clipboard from 'expo-clipboard';

function guessExt(url: string): string {
  const path = url.split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'png';
  if (path.endsWith('.webp')) return 'webp';
  if (path.endsWith('.gif')) return 'gif';
  return 'jpg';
}

/** Copy poster to clipboard as image when supported; otherwise copy the image URL. */
export async function copyPosterToClipboard(posterUrl: string): Promise<'image' | 'link'> {
  const ext = guessExt(posterUrl);
  const dest = `${FileSystem.cacheDirectory}poster-clipboard-${Date.now()}.${ext}`;
  await FileSystem.downloadAsync(posterUrl, dest);
  try {
    const base64 = await FileSystem.readAsStringAsync(dest, { encoding: FileSystem.EncodingType.Base64 });
    await Clipboard.setImageAsync(base64);
    return 'image';
  } catch {
    await Clipboard.setStringAsync(posterUrl);
    return 'link';
  } finally {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }
}

/** Save poster file to the device photo library. */
export async function savePosterToPhotoLibrary(posterUrl: string): Promise<void> {
  const { status } = await MediaLibrary.requestPermissionsAsync(true);
  if (status !== 'granted') {
    throw new Error('PERMISSION_DENIED');
  }
  const ext = guessExt(posterUrl);
  const dest = `${FileSystem.cacheDirectory}poster-save-${Date.now()}.${ext}`;
  const { uri } = await FileSystem.downloadAsync(posterUrl, dest);
  try {
    await MediaLibrary.saveToLibraryAsync(uri);
  } finally {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }
}
