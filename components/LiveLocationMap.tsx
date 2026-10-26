import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import type { LiveLocationMapProps } from '@/components/liveLocationMapTypes';

class MapErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError = () => ({ hasError: true });
  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function LiveLocationMap({
  shares,
  currentUserId,
  initialRegion,
  style,
}: LiveLocationMapProps) {
  return (
    <MapErrorBoundary
      fallback={
        <View style={styles.fallback}>
          <Ionicons name="map-outline" size={32} color={Colors.textSecondary} />
          <Text style={styles.fallbackText}>Map unavailable</Text>
        </View>
      }
    >
      <MapView
        key={shares.map((s) => s.user_id).sort().join(',')}
        style={style}
        initialRegion={initialRegion}
      >
        {shares.map((s) => (
          <Marker
            key={s.user_id}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            title={
              s.user_id === currentUserId
                ? 'You'
                : (s.profile?.full_name ?? 'Friend')
            }
            image={s.profile?.avatar_url ? { uri: s.profile.avatar_url } : undefined}
          />
        ))}
      </MapView>
    </MapErrorBoundary>
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.borderLight,
    gap: 8,
  },
  fallbackText: { fontSize: 14, color: Colors.textSecondary },
});
