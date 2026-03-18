/**
 * Holds the local URI of a poster image when creating an event from poster.
 * Cleared after the activity is created or when the user leaves without creating.
 */

let pendingPosterUri: string | null = null;

/** Activity ID -> poster URI, for activity detail to pick up and upload in background */
let pendingPosterForActivity: { activityId: string; uri: string } | null = null;

export function setPendingPosterUri(uri: string) {
  pendingPosterUri = uri;
}

export function getPendingPosterUri(): string | null {
  return pendingPosterUri;
}

export function getAndClearPendingPosterUri(): string | null {
  const u = pendingPosterUri;
  pendingPosterUri = null;
  return u;
}

export function clearPendingPosterUri() {
  pendingPosterUri = null;
}

/** Store poster for activity detail to upload in background after create. */
export function setPendingPosterForActivity(activityId: string, uri: string) {
  pendingPosterForActivity = { activityId, uri };
}

/** Get and clear pending poster for this activity. Returns uri if match. */
export function getAndClearPendingPosterForActivity(activityId: string): string | null {
  if (!pendingPosterForActivity || pendingPosterForActivity.activityId !== activityId) return null;
  const uri = pendingPosterForActivity.uri;
  pendingPosterForActivity = null;
  return uri;
}
