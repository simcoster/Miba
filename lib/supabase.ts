import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, Session } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://qfdxnpryufkgdstergej.supabase.co';
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmZHhucHJ5dWZrZ2RzdGVyZ2VqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzE0MzEsImV4cCI6MjA4Nzk0NzQzMX0.dVnuYQgYaTwFm0p7ndDYTVA6Cifx1Awo1GXuUbO_J7E';

/**
 * The latest session we know about, updated synchronously on every auth-state
 * change. Used as a fallback when getSession() deadlocks (see patch below).
 */
let _latestKnownSession: Session | null = null;

/**
 * Wraps fetch with an 8-second abort timeout so any request silently dropped
 * by the OS / firewall fails with an error rather than hanging forever.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : (input as Request).url;
  const short = url.replace(/^https:\/\/[^/]+/, '').split('?')[0];
  console.log('[fetch] →', short);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.warn('[fetch] TIMEOUT (8 s):', short);
    controller.abort();
  }, 8_000);

  return fetch(input, { ...init, signal: controller.signal })
    .then(r  => { console.log('[fetch] ✓', short, r.status); return r; })
    .catch(e => { console.warn('[fetch] ✗', short, e.message); throw e; })
    .finally(() => clearTimeout(timer));
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: async (_name, _acquireTimeout, fn) => fn(),
  },
  global: {
    fetch: fetchWithTimeout,
  },
});

/**
 * Patch getSession() with a 3-second timeout fallback.
 *
 * Root cause: after a fresh OAuth SIGNED_IN, supabase-js calls
 * auth.getSession() internally before every REST request to obtain the auth
 * header. In gotrue-js v2, getSession() awaits `initializePromise` which can
 * deadlock during the SIGNED_IN event flow — causing every REST call to hang
 * forever even though the session is already in memory.
 *
 * Fix: if getSession() hasn't resolved within 3 s, return _latestKnownSession
 * (which is always up-to-date because we update it synchronously on every
 * auth-state change, before AuthContext's async callback runs).
 */
const _originalGetSession = supabase.auth.getSession.bind(supabase.auth);
(supabase.auth as any).getSession = () =>
  Promise.race([
    _originalGetSession(),
    new Promise<{ data: { session: Session | null }; error: null }>(resolve =>
      setTimeout(() => {
        if (_latestKnownSession) {
          // Only warn in dev; this is expected during the OAuth code-exchange flow
          console.log('[supabase] getSession slow — using cached session');
        }
        resolve({ data: { session: _latestKnownSession }, error: null });
      }, 200)
    ),
  ]);

// Keep _latestKnownSession in sync.  This listener is registered before
// AuthContext's listener, so it runs first — meaning _latestKnownSession is
// already populated with the fresh token before AuthContext's async code runs.
supabase.auth.onAuthStateChange((_event, session) => {
  _latestKnownSession = session;
});

// Pause/resume token refresh when app goes to background.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
