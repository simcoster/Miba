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

/**
 * Text for location inputs and summaries: show Google's place name when we have a resolved place,
 * otherwise the free-text / formatted-address line (first segment or whole string).
 */
export function getLocationDisplayText(location: string | null | undefined): string {
  const p = parseLocation(location);
  if (!p) return (location ?? '').trim();
  if (p.placeId && p.displayName?.trim()) return p.displayName.trim();
  return p.address;
}

export function buildLocationWithPlace(address: string, placeId: string, displayName: string): string {
  return `${address}${DELIMITER}${placeId}${DELIMITER}${displayName}`;
}

/**
 * Build a Google Maps URL that opens the specific place.
 * Using the official Search action: https://www.google.com/maps/search/?api=1...
 */
export function buildGoogleMapsUrl(placeId: string, displayName: string, address: string): string {
  const params = new URLSearchParams({
    api: '1',
    // Using displayName + address makes the fallback more accurate
    query: `${displayName}, ${address}`,
    query_place_id: placeId,
  });

  // Official universal URL
  return `https://www.google.com/maps/search/?${params.toString()}`;
}
