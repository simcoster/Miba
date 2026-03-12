/**
 * Utilities for location strings that may include Google Place metadata.
 * Format: "address" or "address|||placeId|||displayName"
 */

const DELIMITER = '|||';

export interface ParsedLocation {
  address: string;
  placeId?: string;
  displayName?: string;
}

export function parseLocation(location: string | null | undefined): ParsedLocation | null {
  if (!location || !location.trim()) return null;
  const parts = location.split(DELIMITER);
  if (parts.length >= 3 && parts[1]?.trim() && parts[2]?.trim()) {
    return {
      address: parts[0].trim(),
      placeId: parts[1].trim(),
      displayName: parts[2].trim(),
    };
  }
  return { address: location };
}

export function buildLocationWithPlace(address: string, placeId: string, displayName: string): string {
  return `${address}${DELIMITER}${placeId}${DELIMITER}${displayName}`;
}

/** Build a Google Maps URL that opens the place. Requires both query and query_place_id per Maps URLs API. */
export function buildGoogleMapsUrl(placeId: string, query: string): string {
  const params = new URLSearchParams({
    api: '1',
    query: query || placeId,
    query_place_id: placeId,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
