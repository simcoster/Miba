import { supabase } from '@/lib/supabase';

export type HostPingResult = { ok: boolean; error?: string };

/**
 * Host pings invitees with pending or maybe RSVP.
 * Sends push notification "[host] wants to know if you're coming to [event]".
 * Limited to 1 ping per day per activity (enforced server-side).
 */
export async function postHostPing(activityId: string): Promise<HostPingResult> {
  const { data, error } = await supabase.rpc('host_ping_invitees', {
    p_activity_id: activityId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const result = data as { ok?: boolean; error?: string } | null;
  if (!result) {
    return { ok: false, error: 'Unknown error' };
  }

  return {
    ok: !!result.ok,
    error: result.error,
  };
}
