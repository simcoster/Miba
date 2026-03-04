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
  displayName: string;
  formattedAddress: string;
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
  if (!isApiConfigured()) return [];
  const trimmed = input.trim();
  if (trimmed.length < 2) return [];

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
    }),
  });

  if (!res.ok) {
    console.warn('[Places] Autocomplete error:', res.status, await res.text());
    return [];
  }

  const data = await res.json();
  const suggestions = data.suggestions ?? [];
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
  if (!isApiConfigured()) return null;
  const id = placeId.replace(/^places\//, '');

  const url = `${PLACE_DETAILS_URL}/${id}?sessionToken=${encodeURIComponent(sessionToken)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'displayName,formattedAddress',
    },
  });

  if (!res.ok) {
    console.warn('[Places] Place Details error:', res.status, await res.text());
    return null;
  }

  const data = await res.json();
  const displayName = data.displayName?.text ?? '';
  const formattedAddress = data.formattedAddress ?? '';
  // Prefer formatted address if available; otherwise use display name
  const text = formattedAddress || displayName;
  if (!text) return null;

  return {
    displayName,
    formattedAddress: text,
  };
}

export { isApiConfigured };
