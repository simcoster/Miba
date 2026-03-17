/**
 * Resolve a raw location string to the first Google Places suggestion (address + place photo).
 * Simulates user typing the text and selecting the first autocomplete result.
 * When the main place has subDestinations (e.g. Hangar 11, Terminal 2) and the poster mentions
 * one of them, uses that sub-destination's info and photo instead of the generic address.
 */

import * as Crypto from 'expo-crypto';
import { fetchAutocomplete, fetchPlaceDetails, fetchNearbySearch } from '@/lib/placesApi';
import { buildLocationWithPlace } from '@/lib/locationUtils';

export interface ResolvedLocation {
  location: string;
  placePhotoName?: string;
}

/** Normalize for fuzzy match: lowercase, trim, collapse spaces */
function normalizeForMatch(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Check if poster text mentions a sub-destination (e.g. "Hangar 11" in "Tel Aviv Port, Hangar 11") */
function posterMentionsSub(posterText: string, subDisplayName: string): boolean {
  const p = normalizeForMatch(posterText);
  const s = normalizeForMatch(subDisplayName);
  if (!s) return false;
  return p.includes(s) || s.includes(p);
}

/** Check if venue name matches poster text (for nearby-search fallback). Requires venue name ≥ 3 chars. */
function venueNameMatches(posterText: string, venueDisplayName: string): boolean {
  const p = normalizeForMatch(posterText);
  const v = normalizeForMatch(venueDisplayName);
  if (!v || v.length < 3) return false;
  return p.includes(v) || v.includes(p);
}

/**
 * Resolve raw location text to first Google Places result.
 * Returns location string (with place metadata if resolved) and optional placePhotoName for cover.
 * If the place has subDestinations and the poster text mentions one, uses that sub's info and photo.
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

  // If subDestinations exist and poster mentions one, use that sub's info and photo
  const subs = details.subDestinations ?? [];
  if (subs.length > 0) {
    console.log('[resolveLocation] subDestinations:', subs.map((s) => ({ id: s.id, name: s.name })));
    const subDetails = await Promise.all(
      subs.slice(0, 5).map((s) => fetchPlaceDetails(s.id, sessionToken))
    );
    const matched = subDetails.find(
      (d) => d && posterMentionsSub(trimmed, d.displayName)
    );
    if (matched) {
      console.log('[resolveLocation] selected sub-destination:', matched.displayName, matched.placeId);
      const location = buildLocationWithPlace(
        details.formattedAddress,
        matched.placeId,
        matched.displayName
      );
      let placePhotoName = matched.placePhotoName;
      if (!placePhotoName && (matched.location || matched.formattedAddress)) {
        if (matched.location) {
          placePhotoName = `streetview:${matched.location.latitude},${matched.location.longitude}`;
        } else {
          placePhotoName = `streetview:${matched.formattedAddress}`;
        }
      }
      return { location, placePhotoName };
    }
    console.log('[resolveLocation] no sub-destination matched for poster text:', trimmed);
  }

  // Fallback: no place photo and no sub-destinations — try nearby search (5m) for a matching venue
  if (!details.placePhotoName && details.location && subs.length === 0) {
    const nearby = await fetchNearbySearch(
      details.location.latitude,
      details.location.longitude,
      5
    );
    console.log('[resolveLocation] nearby-search returned', nearby.length, 'places:');
    nearby.forEach((n, i) => {
      console.log(`  [${i}] ${n.displayName} | placeId=${n.placeId} | address=${n.formattedAddress ?? '-'} | hasPhoto=${!!n.placePhotoName}`);
    });
    const matched = nearby.find((np) => venueNameMatches(trimmed, np.displayName));
    if (matched) {
      console.log('[resolveLocation] nearby-search matched venue:', matched.displayName);
      const location = buildLocationWithPlace(
        matched.formattedAddress || details.formattedAddress,
        matched.placeId,
        matched.displayName
      );
      let placePhotoName = matched.placePhotoName;
      if (!placePhotoName && (matched.location || matched.formattedAddress)) {
        if (matched.location) {
          placePhotoName = `streetview:${matched.location.latitude},${matched.location.longitude}`;
        } else {
          placePhotoName = `streetview:${matched.formattedAddress}`;
        }
      }
      return { location, placePhotoName };
    }
    if (nearby.length > 0) {
      console.log('[resolveLocation] nearby-search: no venue matched poster text:', trimmed);
    }
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
