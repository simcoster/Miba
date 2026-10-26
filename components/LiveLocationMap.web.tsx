import type { LiveLocationMapProps } from '@/components/liveLocationMapTypes';

/** Native maps are not bundled for web. The chat screens already hide this on web. */
export function LiveLocationMap(_props: LiveLocationMapProps) {
  return null;
}
