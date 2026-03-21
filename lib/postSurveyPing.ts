import { supabase } from '@/lib/supabase';

export type SurveyPingResult = { ok: boolean; error?: string };

/**
 * Creator pings invitees who have not answered the survey.
 * Sends push notification "[host] wants your answer on a survey for [event]".
 * Limited to 1 ping per day per survey (enforced server-side).
 */
export async function postSurveyPing(postId: string): Promise<SurveyPingResult> {
  const { data, error } = await supabase.rpc('survey_ping_unanswered', {
    p_post_id: postId,
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
