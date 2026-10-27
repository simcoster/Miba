import { authLog } from '@/lib/authLog';
import { supabase } from '@/lib/supabase';

/**
 * Parse auth params from a Supabase OAuth redirect URL (hash fragment or query params).
 */
function parseUrlParams(url: string): Record<string, string> {
  const params: Record<string, string> = {};

  const queryIndex = url.indexOf('?');
  if (queryIndex !== -1) {
    const queryStr = url.slice(queryIndex + 1).split('#')[0];
    new URLSearchParams(queryStr).forEach((v, k) => {
      params[k] = v;
    });
  }

  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) {
    new URLSearchParams(url.slice(hashIndex + 1)).forEach((v, k) => {
      params[k] = v;
    });
  }

  return params;
}

/**
 * Check if a URL looks like a Supabase OAuth callback (has tokens or code).
 */
export function isAuthCallbackUrl(url: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const params = parseUrlParams(url);
  return !!(params.access_token && params.refresh_token) || !!params.code;
}

/**
 * Process a Supabase OAuth callback URL and set the session.
 * Used when the app opens from a redirect (e.g. Expo Go cold start) and
 * openAuthSessionAsync's promise was lost.
 */
const pendingExchanges = new Map<string, Promise<boolean>>();

export async function processAuthCallbackUrl(url: string): Promise<boolean> {
  authLog('processing auth callback');
  const params = parseUrlParams(url);
  if (params.error) {
    authLog(`callback error: ${params.error}${params.error_description ? ` ${params.error_description}` : ''}`);
    return false;
  }
  if (params.access_token && params.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) {
      authLog(`setSession failed: ${error.message}`);
      return false;
    }
    authLog('setSession success');
    return true;
  }
  if (params.code) {
    const existing = pendingExchanges.get(params.code);
    if (existing) return existing;
    const exchange = (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(params.code);
      if (error) {
        authLog(`exchangeCodeForSession failed: ${error.message}`);
        return false;
      }
      authLog('exchangeCodeForSession success');
      return true;
    })();
    pendingExchanges.set(params.code, exchange);
    return exchange;
  }
  authLog('callback had no code or tokens');
  return false;
}
