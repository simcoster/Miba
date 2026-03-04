/**
 * Pre-loaded splash art presets for activities.
 * Uses local images from assets/images/banners.
 */
export type SplashPreset =
  | 'banner_1' | 'banner_2' | 'banner_3' | 'banner_4' | 'banner_5' | 'banner_6'
  | 'banner_7' | 'banner_8' | 'banner_9' | 'banner_10' | 'banner_11' | 'banner_12';

export const SPLASH_PRESETS: { id: SplashPreset; label: string; source: number }[] = [
  { id: 'banner_1', label: 'Banner 1', source: require('../assets/images/banners/banner_1.png') },
  { id: 'banner_2', label: 'Banner 2', source: require('../assets/images/banners/banner_2.png') },
  { id: 'banner_3', label: 'Banner 3', source: require('../assets/images/banners/banner_3.png') },
  { id: 'banner_4', label: 'Banner 4', source: require('../assets/images/banners/banner_4.png') },
  { id: 'banner_5', label: 'Banner 5', source: require('../assets/images/banners/banner_5.png') },
  { id: 'banner_6', label: 'Banner 6', source: require('../assets/images/banners/banner_6.png') },
  { id: 'banner_7', label: 'Banner 7', source: require('../assets/images/banners/banner_7.png') },
  { id: 'banner_8', label: 'Banner 8', source: require('../assets/images/banners/banner_8.png') },
  { id: 'banner_9', label: 'Banner 9', source: require('../assets/images/banners/banner_9.png') },
  { id: 'banner_10', label: 'Banner 10', source: require('../assets/images/banners/banner_10.png') },
  { id: 'banner_11', label: 'Banner 11', source: require('../assets/images/banners/banner_11.png') },
  { id: 'banner_12', label: 'Banner 12', source: require('../assets/images/banners/banner_12.png') },
];

export function getSplashSource(preset: SplashPreset | null | undefined): number | null {
  if (!preset) return null;
  return SPLASH_PRESETS.find(p => p.id === preset)?.source ?? null;
}
