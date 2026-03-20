/**
 * Emits events when location permission is denied (e.g. from background task).
 * The app subscribes and shows a toast.
 */
import { DeviceEventEmitter } from 'react-native';

export const LOCATION_PERMISSION_DENIED_EVENT = 'miba:location-permission-denied';

export type LocationPermissionDeniedSource = 'mipo' | 'live_location';

export function emitLocationPermissionDenied(source: LocationPermissionDeniedSource): void {
  DeviceEventEmitter.emit(LOCATION_PERMISSION_DENIED_EVENT, { source });
}

export function isLocationPermissionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '').toLowerCase();
  return (
    /permission.*denied|denied.*permission|not authorized|location.*disabled|location services/i.test(msg) ||
    /couldn't start.*foreground|foreground service/i.test(msg) ||
    /accuracy|precise|coarse|fine.*location|location.*accuracy/i.test(msg) ||
    /unsatisfied.*device|device.*settings|location request failed/i.test(msg)
  );
}
