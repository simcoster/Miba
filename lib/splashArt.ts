/**
 * Splash art presets for activities.
 * Banners are fetched from Supabase Storage and cached locally (see lib/bannerCache).
 */
export type SplashPreset =
  | 'banner_1' | 'banner_2' | 'banner_3' | 'banner_4' | 'banner_5' | 'banner_6'
  | 'banner_7' | 'banner_8' | 'banner_9' | 'banner_10' | 'banner_11' | 'banner_12'
  | 'join_me_banner';

export const SPLASH_PRESETS: { id: SplashPreset; label: string }[] = [
  { id: 'banner_1', label: 'Banner 1' },
  { id: 'banner_2', label: 'Banner 2' },
  { id: 'banner_3', label: 'Banner 3' },
  { id: 'banner_4', label: 'Banner 4' },
  { id: 'banner_5', label: 'Banner 5' },
  { id: 'banner_6', label: 'Banner 6' },
  { id: 'banner_7', label: 'Banner 7' },
  { id: 'banner_8', label: 'Banner 8' },
  { id: 'banner_9', label: 'Banner 9' },
  { id: 'banner_10', label: 'Banner 10' },
  { id: 'banner_11', label: 'Banner 11' },
  { id: 'banner_12', label: 'Banner 12' },
  { id: 'join_me_banner', label: 'Join me!' },
];

/** Presets for normal (non–join_me) events. Excludes join_me_banner. */
export const SPLASH_PRESETS_REGULAR = SPLASH_PRESETS.filter(p => p.id !== 'join_me_banner');
