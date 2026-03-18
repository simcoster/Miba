import React, { useState, useEffect } from 'react';
import { View, Image, StyleSheet, ImageStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getBannerUri } from '@/lib/bannerCache';
import type { SplashPreset } from '@/lib/splashArt';
import Colors from '@/constants/Colors';

const DEFAULT_FALLBACK: SplashPreset = 'banner_1';

type SplashArtProps = {
  preset?: SplashPreset | null;
  /** Remote image URI (e.g. place photo). When set, overrides preset. Falls back to placeholder on load error. */
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
  const [bannerFailed, setBannerFailed] = useState(false);
  const [bannerUri, setBannerUri] = useState<string | null>(null);

  useEffect(() => {
    setRemoteFailed(false);
  }, [imageUri]);

  // Fetch cached or remote banner URI when using preset (and no imageUri)
  useEffect(() => {
    if (imageUri) return;
    setBannerFailed(false);
    const p = preset ?? DEFAULT_FALLBACK;
    getBannerUri(p).then(setBannerUri);
  }, [preset, imageUri]);

  const useRemote = imageUri && !remoteFailed;
  const hasBannerSource = !useRemote && !bannerFailed && bannerUri;

  // Priority: imageUri (place photo etc) > cached/remote banner URI > placeholder
  const source = useRemote ? { uri: imageUri } : hasBannerSource ? { uri: bannerUri } : null;

  if (!source) {
    return (
      <View style={[styles.wrapper, styles.placeholder, { height }]}>
        <Ionicons name="image-outline" size={32} color={Colors.textSecondary} />
      </View>
    );
  }

  return (
    <View style={[styles.wrapper, { height }]}>
      <Image
        source={source}
        style={[styles.image, { height, opacity }, style]}
        resizeMode={resizeMode}
        onError={() => {
          if (imageUri) setRemoteFailed(true);
          else setBannerFailed(true);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { overflow: 'hidden', backgroundColor: '#e5e5e5' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
