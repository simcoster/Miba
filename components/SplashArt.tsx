import React, { useState, useEffect } from 'react';
import { View, Image, StyleSheet, ImageStyle } from 'react-native';
import { getSplashSource } from '@/lib/splashArt';
import type { SplashPreset } from '@/lib/splashArt';

const DEFAULT_FALLBACK: SplashPreset = 'banner_1';

type SplashArtProps = {
  preset?: SplashPreset | null;
  /** Remote image URI (e.g. place photo). When set, overrides preset. Falls back to preset/fallback on load error. */
  imageUri?: string | null;
  style?: ImageStyle;
  height?: number;
  /** Opacity 0–1. Default 0.2 for background use behind text. */
  opacity?: number;
  /** 'cover' crops to fill; 'contain' scales to fit; 'stretch' stretches to fill (may distort). Default cover. */
  resizeMode?: 'cover' | 'contain' | 'stretch';
};

export function SplashArt({ preset, imageUri, style, height = 120, opacity = 0.2, resizeMode = 'cover' }: SplashArtProps) {
  const [remoteFailed, setRemoteFailed] = useState(false);
  useEffect(() => {
    setRemoteFailed(false);
  }, [imageUri]);
  const useRemote = imageUri && !remoteFailed;
  const fallbackPreset = preset ?? DEFAULT_FALLBACK;
  const localSource = !useRemote ? getSplashSource(fallbackPreset ?? undefined) : null;
  const remoteSource = useRemote ? { uri: imageUri } : null;
  const source = remoteSource ?? localSource;
  if (!source) return null;

  return (
    <View style={[styles.wrapper, { height }]}>
      <Image
        source={source}
        style={[styles.image, { height, opacity }, style]}
        resizeMode={resizeMode}
        onError={() => setRemoteFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { overflow: 'hidden', backgroundColor: '#e5e5e5' },
  image: { width: '100%', height: '100%' },
});
