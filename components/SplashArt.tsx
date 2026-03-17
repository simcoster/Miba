import React from 'react';
import { View, Image, StyleSheet, ImageStyle } from 'react-native';
import { getSplashSource } from '@/lib/splashArt';
import type { SplashPreset } from '@/lib/splashArt';

type SplashArtProps = {
  preset?: SplashPreset | null;
  /** Remote image URI (e.g. place photo). When set, overrides preset. */
  imageUri?: string | null;
  style?: ImageStyle;
  height?: number;
  /** Opacity 0–1. Default 0.2 for background use behind text. */
  opacity?: number;
};

export function SplashArt({ preset, imageUri, style, height = 120, opacity = 0.2 }: SplashArtProps) {
  const localSource = !imageUri ? getSplashSource(preset ?? undefined) : null;
  const remoteSource = imageUri ? { uri: imageUri } : null;
  const source = remoteSource ?? localSource;
  if (!source) return null;

  return (
    <View style={[styles.wrapper, { height }]}>
      <Image source={source} style={[styles.image, { height, opacity }, style]} resizeMode="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { overflow: 'hidden', backgroundColor: '#e5e5e5' },
  image: { width: '100%', height: '100%' },
});
