import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Colors from '@/constants/Colors';

type AvatarProps = {
  uri?: string | null;
  name?: string | null;
  size?: number;
};

export function Avatar({ uri, name, size = 40 }: AvatarProps) {
  const initials = getInitials(name);
  const fontSize = size * 0.4;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
      />
    );
  }

  return (
    <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize }]}>{initials}</Text>
    </View>
  );
}

function getInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?';
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}

const styles = StyleSheet.create({
  image: { backgroundColor: Colors.borderLight },
  placeholder: {
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: Colors.primaryDark,
    fontWeight: '700',
  },
});
