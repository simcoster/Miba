import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { parseLocation, buildGoogleMapsUrl } from '@/lib/locationUtils';
import Colors from '@/constants/Colors';

interface LocationDisplayProps {
  location: string | null | undefined;
  /** Layout variant */
  variant?: 'card' | 'detail' | 'inline';
  /** Show the location icon (default true for card, false when parent provides icon) */
  showIcon?: boolean;
  /** When true, allow full text wrap without line limit */
  allowFullWrap?: boolean;
}

export function LocationDisplay({ location, variant = 'card', showIcon = true, allowFullWrap = false }: LocationDisplayProps) {
  const parsed = parseLocation(location);
  if (!parsed) return null;

  const openMaps = () => {
    if (parsed.placeId) {
      Linking.openURL(buildGoogleMapsUrl(parsed.placeId, parsed.displayName ?? parsed.address));
    }
  };

  const isCompact = variant === 'card' || variant === 'inline';
  const lines = isCompact ? 1 : 2;

  return (
    <View style={[styles.container, isCompact && styles.compact]}>
      {showIcon && (
        <Ionicons
          name="location-outline"
          size={variant === 'detail' ? 20 : 14}
          color={Colors.textSecondary}
        />
      )}
      <View style={styles.textBlock}>
        <Text style={[styles.address, variant === 'detail' && styles.addressDetail]} {...(!allowFullWrap && { numberOfLines: lines })}>
          {parsed.address}
        </Text>
        {parsed.placeId && parsed.displayName && (
          <TouchableOpacity style={styles.linkRow} onPress={openMaps} activeOpacity={0.7}>
            <Ionicons name="open-outline" size={12} color={Colors.primary} />
            <Text style={styles.linkText}>{parsed.displayName}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  compact: { alignItems: 'center' },
  textBlock: { flex: 1 },
  address: { fontSize: 13, color: Colors.textSecondary },
  addressDetail: { fontSize: 15, color: Colors.text },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  linkText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.primary,
  },
});
