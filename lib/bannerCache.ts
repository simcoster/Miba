/**
 * Fetches banner images from Supabase Storage on first load and caches them
 * locally so they don't need to be re-fetched on subsequent app opens.
 */
import * as FileSystem from 'expo-file-system';
import Constants from 'expo-constants';

const supabaseUrl =
  Constants.expoConfig?.extra?.supabaseUrl ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://qfdxnpryufkgdstergej.supabase.co';

const BANNERS_BUCKET = 'banners';
const CACHE_DIR = `${FileSystem.cacheDirectory}banners/`;

export type SplashPreset =
  | 'banner_1' | 'banner_2' | 'banner_3' | 'banner_4' | 'banner_5' | 'banner_6'
  | 'banner_7' | 'banner_8' | 'banner_9' | 'banner_10' | 'banner_11' | 'banner_12'
  | 'join_me_banner';

const BANNER_FILES: Record<SplashPreset, string> = {
  banner_1: 'banner_1.png',
  banner_2: 'banner_2.png',
  banner_3: 'banner_3.png',
  banner_4: 'banner_4.png',
  banner_5: 'banner_5.png',
  banner_6: 'banner_6.png',
  banner_7: 'banner_7.png',
  banner_8: 'banner_8.png',
  banner_9: 'banner_9.png',
  banner_10: 'banner_10.png',
  banner_11: 'banner_11.png',
  banner_12: 'banner_12.png',
  join_me_banner: 'join_me_banner.jpg',
};

const PRESETS = Object.keys(BANNER_FILES) as SplashPreset[];

function getRemoteUrl(preset: SplashPreset): string {
  const filename = BANNER_FILES[preset];
  return `${supabaseUrl}/storage/v1/object/public/${BANNERS_BUCKET}/${filename}`;
}

function getCachePath(preset: SplashPreset): string {
  const filename = BANNER_FILES[preset];
  return `${CACHE_DIR}${filename}`;
}

/**
 * Returns the best available URI for a banner preset:
 * - Cached file URI if the banner has been downloaded
 * - Remote Supabase URL otherwise (will fetch on first view)
 */
export async function getBannerUri(preset: SplashPreset | null | undefined): Promise<string | null> {
  if (!preset || !(preset in BANNER_FILES)) return null;
  const cachePath = getCachePath(preset as SplashPreset);
  try {
    const info = await FileSystem.getInfoAsync(cachePath, { size: false });
    if (info.exists) {
      const uri = cachePath.startsWith('file://') ? cachePath : `file://${cachePath}`;
      return uri;
    }
  } catch {
    // Ignore; fall back to remote
  }
  return getRemoteUrl(preset as SplashPreset);
}

/**
 * Ensures the banners cache directory exists.
 */
async function ensureCacheDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

/**
 * Downloads a single banner to the cache if not already cached.
 */
async function cacheBanner(preset: SplashPreset): Promise<void> {
  const cachePath = getCachePath(preset);
  const info = await FileSystem.getInfoAsync(cachePath);
  if (info.exists) return;

  const url = getRemoteUrl(preset);
  try {
    await FileSystem.downloadAsync(url, cachePath);
    console.log('[BannerCache] Cached', preset);
  } catch (e) {
    console.warn('[BannerCache] Failed to cache', preset, e);
  }
}

/**
 * Fetches all banners from Supabase and stores them locally.
 * Call this when the app first loads. Runs in the background.
 */
export function ensureBannersCached(): void {
  ensureCacheDir()
    .then(() => Promise.all(PRESETS.map(cacheBanner)))
    .then(() => console.log('[BannerCache] All banners cached'))
    .catch((e) => console.warn('[BannerCache] Cache init failed', e));
}
