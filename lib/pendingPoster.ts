/**
 * Holds the local URI of a poster image when creating an event from poster.
 * Cleared after the activity is created or when the user leaves without creating.
 */

let pendingPosterUri: string | null = null;

export function setPendingPosterUri(uri: string) {
  pendingPosterUri = uri;
}

export function getAndClearPendingPosterUri(): string | null {
  const u = pendingPosterUri;
  pendingPosterUri = null;
  return u;
}

export function clearPendingPosterUri() {
  pendingPosterUri = null;
}
