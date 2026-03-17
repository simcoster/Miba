/**
 * Resolve a raw location string to the first Google Places suggestion (address + place photo).
 * Simulates user typing the text and selecting the first autocomplete result.
 */

import * as Crypto from 'expo-crypto';
import { fetchAutocomplete, fetchPlaceDetails } from '@/lib/placesApi';
import { buildLocationWithPlace } from '@/lib/locationUtils';

export interface ResolvedLocation {
  location: string;
  placePhotoName?: string;
}

/**
 * Resolve raw location text to first Google Places result.
 * Returns location string (with place metadata if resolved) and optional placePhotoName for cover.
 */
export async function resolveLocationFromText(rawText: string): Promise<ResolvedLocation> {
  const trimmed = rawText?.trim() ?? '';
  if (!trimmed) {
    return { location: '' };
  }

  const sessionToken = Crypto.randomUUID();
  const predictions = await fetchAutocomplete(trimmed, sessionToken);

  if (predictions.length === 0) {
    return { location: trimmed };
  }

  const first = predictions[0];
  const details = await fetchPlaceDetails(first.placeId, sessionToken);

  if (!details) {
    return { location: first.fullText || trimmed };
  }

  const location = buildLocationWithPlace(
    details.formattedAddress,
    details.placeId,
    details.displayName
  );

  // Use Place photo when available; otherwise use Street View for addresses
  let placePhotoName = details.placePhotoName;
  if (!placePhotoName && (details.location || details.formattedAddress)) {
    if (details.location) {
      placePhotoName = `streetview:${details.location.latitude},${details.location.longitude}`;
    } else {
      placePhotoName = `streetview:${details.formattedAddress}`;
    }
  }

  return {
    location,
    placePhotoName,
  };
}
