import type { StyleProp, ViewStyle } from 'react-native';

export type LiveLocationPin = {
  user_id: string;
  lat: number;
  lng: number;
  profile?: { full_name?: string; avatar_url?: string | null } | null;
};

export type LiveLocationRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type LiveLocationMapProps = {
  shares: LiveLocationPin[];
  currentUserId?: string;
  initialRegion: LiveLocationRegion;
  style?: StyleProp<ViewStyle>;
};
