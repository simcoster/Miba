import { getCoverImageUrl } from '@/lib/placesApi';
import type { SplashPreset } from '@/lib/splashArt';

type ActivityCover = {
  place_photo_name?: string | null;
  splash_art?: SplashPreset | string | null;
  poster_image_url?: string | null;
};

/** Get SplashArt props for an activity. Prefers place photo > splash preset > poster image. */
export function getActivityCoverProps(activity: ActivityCover | null | undefined): {
  preset?: SplashPreset;
  imageUri?: string;
} | null {
  if (!activity) return null;
  if (activity.place_photo_name) {
    const uri = getCoverImageUrl(activity.place_photo_name);
    return uri ? { imageUri: uri } : null;
  }
  if (activity.splash_art) {
    return { preset: activity.splash_art as SplashPreset };
  }
  if (activity.poster_image_url && String(activity.poster_image_url).trim()) {
    return { imageUri: activity.poster_image_url };
  }
  return null;
}

/** Whether the activity has a cover (place photo, splash preset, or poster). */
export function hasActivityCover(activity: ActivityCover | null | undefined): boolean {
  return !!(activity?.place_photo_name || activity?.splash_art || (activity?.poster_image_url && String(activity.poster_image_url).trim()));
}
