/**
 * Google Places API (New) with session token support for cost-effective billing.
 *
 * Session flow:
 * - Generate a new session token when user starts typing
 * - Pass same token with every autocomplete request
 * - When user selects a Place, call Place Details with the same token
 * - Google bills: 1 Place Details (Essentials) instead of per autocomplete request
 *
 * Requires EXPO_PUBLIC_GOOGLE_PLACES_API_KEY and Places API (New) enabled in Google Cloud.
 */

const API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';
const AUTocomplete_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';

export interface PlacePrediction {
  placeId: string;
  place: string; // resource name
  mainText: string;
  secondaryText: string;
  fullText: string;
}

export interface PlaceDetails {
  placeId: string;
  displayName: string;
  formattedAddress: string;
  /** Google Places API photo resource name (places/PLACE_ID/photos/PHOTO_ID) for first photo */
  placePhotoName?: string;
  /** Lat/lng for Street View fallback when no place photo */
  location?: { latitude: number; longitude: number };
}

function isApiConfigured(): boolean {
  return !!API_KEY.trim();
}

/**
 * Fetch autocomplete suggestions. Uses session token for billing.
 * Call with the same sessionToken for each keystroke in a session.
 */
export async function fetchAutocomplete(
  input: string,
  sessionToken: string
): Promise<PlacePrediction[]> {
  if (!isApiConfigured()) {
    console.log('[Places] Autocomplete skipped: API key not configured');
    return [];
  }
  const trimmed = input.trim();
  if (trimmed.length < 2) {
    console.log('[Places] Autocomplete skipped: input too short (< 2 chars)');
    return [];
  }

  console.log('[Places] Autocomplete request:', { input: trimmed, sessionToken: sessionToken.slice(0, 8) + '…' });
  const res = await fetch(AUTocomplete_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
    },
    body: JSON.stringify({
      input: trimmed,
      sessionToken,
      includeQueryPredictions: false,
      regionCode: 'IL',
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn('[Places] Autocomplete error:', res.status, errText);
    return [];
  }

  const data = await res.json();
  const suggestions = data.suggestions ?? [];
  console.log('[Places] Autocomplete response:', suggestions.length, 'suggestions');
  const predictions: PlacePrediction[] = [];

  for (const s of suggestions) {
    const pp = s.placePrediction;
    if (!pp) continue;
    const placeId = pp.placeId ?? pp.place?.replace?.('places/', '') ?? '';
    const place = pp.place ?? `places/${placeId}`;
    const text = pp.text?.text ?? '';
    const main = pp.structuredFormat?.mainText?.text ?? text;
    const secondary = pp.structuredFormat?.secondaryText?.text ?? '';
    predictions.push({
      placeId,
      place,
      mainText: main,
      secondaryText: secondary,
      fullText: text || `${main} ${secondary}`.trim(),
    });
  }

  return predictions;
}

/**
 * Fetch place details for a selected prediction. Use the SAME sessionToken
 * from the autocomplete session so Google bills as one Place Details request.
 */
export async function fetchPlaceDetails(
  placeId: string,
  sessionToken: string
): Promise<PlaceDetails | null> {
  if (!isApiConfigured()) {
    console.log('[Places] Place Details skipped: API key not configured');
    return null;
  }
  const id = placeId.replace(/^places\//, '');

  console.log('[Places] Place Details request:', { placeId: id });
  const url = `${PLACE_DETAILS_URL}/${id}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'displayName,formattedAddress,photos,location',
    },
  });

  if (!res.ok) {
    console.warn('[Places] Place Details error:', res.status, await res.text());
    return null;
  }

  const data = await res.json();
  console.log('[Places] Place Details response:', data.displayName?.text ?? data.formattedAddress ?? 'ok');
  const displayName = data.displayName?.text ?? '';
  const formattedAddress = data.formattedAddress ?? '';
  // Prefer formatted address if available; otherwise use display name
  const text = formattedAddress || displayName;
  if (!text) return null;

  const photos = data.photos ?? [];
  const firstPhoto = Array.isArray(photos) ? photos[0] : null;
  const placePhotoName = firstPhoto?.name ?? undefined;
  const loc = data.location;
  const location =
    loc != null && typeof loc.latitude === 'number' && typeof loc.longitude === 'number'
      ? { latitude: loc.latitude, longitude: loc.longitude }
      : undefined;

  return {
    placeId: id,
    displayName,
    formattedAddress: text,
    placePhotoName,
    location,
  };
}

/**
 * Build the URL for a Places API photo. Use at render time (API key is in env).
 */
export function buildPlacePhotoUrl(placePhotoName: string, maxWidthPx = 800): string {
  if (!API_KEY) return '';
  return `https://places.googleapis.com/v1/${placePhotoName}/media?key=${API_KEY}&maxWidthPx=${maxWidthPx}`;
}

const STREETVIEW_PREFIX = 'streetview:';

/**
 * Build cover image URL. Handles both Places API photos and Street View fallback.
 * For addresses with no place photo, placePhotoName may be "streetview:lat,lng" or "streetview:address".
 */
export function getCoverImageUrl(placePhotoName: string, maxWidthPx = 800): string {
  if (!placePhotoName || !API_KEY) return '';
  if (placePhotoName.startsWith(STREETVIEW_PREFIX)) {
    const location = placePhotoName.slice(STREETVIEW_PREFIX.length).trim();
    if (!location) return '';
    const params = new URLSearchParams({
      size: `${maxWidthPx}x400`,
      location,
      key: API_KEY,
    });
    return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
  }
  return buildPlacePhotoUrl(placePhotoName, maxWidthPx);
}

/**
 * Build full-size (uncropped) location image URL for popup display.
 */
export function getFullLocationImageUrl(placePhotoName: string): string {
  if (!placePhotoName || !API_KEY) return '';
  if (placePhotoName.startsWith(STREETVIEW_PREFIX)) {
    const location = placePhotoName.slice(STREETVIEW_PREFIX.length).trim();
    if (!location) return '';
    const params = new URLSearchParams({
      size: '1920x1080',
      location,
      key: API_KEY,
    });
    return `https://maps.googleapis.com/maps/api/streetview?${params.toString()}`;
  }
  return buildPlacePhotoUrl(placePhotoName, 1920);
}

export { isApiConfigured };
