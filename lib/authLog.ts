type Listener = (lines: string[]) => void;

const lines: string[] = [];
const listeners = new Set<Listener>();
const STORAGE_KEY = 'miba.authLog';
const MAX_LINES = 40;

function persist() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  } catch {
    // Private mode or a full quota should not break sign-in.
  }
}

function load() {
  if (typeof sessionStorage === 'undefined') return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) {
      lines.push(...saved.filter((line) => typeof line === 'string').slice(-MAX_LINES));
    }
  } catch {
    // Ignore a corrupt log.
  }
}

load();

export function authLog(message: string) {
  const stamp = new Date().toISOString().slice(11, 23);
  lines.push(`${stamp} ${message}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
  console.warn('[AuthLog]', message);
  persist();
  const snapshot = [...lines];
  listeners.forEach((listener) => listener(snapshot));
}

export function getAuthLog() {
  return [...lines];
}

export function subscribeAuthLog(listener: Listener) {
  listener([...lines]);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Log where a URL went and which param names it carried, never the token values. */
export function summarizeUrl(url: string) {
  try {
    const parsed = new URL(url);
    const queryKeys = [...parsed.searchParams.keys()];
    const hashParams = parsed.hash ? new URLSearchParams(parsed.hash.slice(1)) : null;
    const hashKeys = hashParams ? [...hashParams.keys()] : [];
    const error = parsed.searchParams.get('error') ?? hashParams?.get('error') ?? '';
    const description =
      parsed.searchParams.get('error_description') ?? hashParams?.get('error_description') ?? '';
    const errorText = error ? ` error=${error}${description ? ` ${description}` : ''}` : '';
    return `${parsed.origin}${parsed.pathname} query=[${queryKeys.join(',')}] hash=[${hashKeys.join(',')}]${errorText}`;
  } catch {
    return url.slice(0, 160);
  }
}
