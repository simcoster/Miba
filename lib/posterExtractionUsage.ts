/**
 * Poster extraction usage tracking — 5 uses per user per day for From Poster AI feature.
 */

import { supabase } from '@/lib/supabase';

const DAILY_LIMIT = 5;

/** Get remaining poster extraction uses for today. */
export async function getPosterUsesRemaining(userId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const { count, error } = await supabase
    .from('poster_extractions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', todayStart.toISOString())
    .lt('created_at', todayEnd.toISOString());

  if (error) {
    console.warn('[posterExtractionUsage] getPosterUsesRemaining error:', error);
    return DAILY_LIMIT;
  }

  const used = count ?? 0;
  return Math.max(0, DAILY_LIMIT - used);
}

/** Record a poster extraction (call after successful extraction, before navigating). */
export async function recordPosterExtraction(userId: string): Promise<void> {
  const { error } = await supabase.from('poster_extractions').insert({
    user_id: userId,
  });

  if (error) {
    console.warn('[posterExtractionUsage] recordPosterExtraction error:', error);
  }
}
