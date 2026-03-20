/**
 * Central error reporting. In production, sends to Firebase Crashlytics.
 * In dev, logs to console. Use in catch blocks for errors you want to track.
 */
let crashlytics: { (): { recordError: (e: Error) => void; setAttribute: (k: string, v: string) => void } } | null = null;
try {
  crashlytics = require('@react-native-firebase/crashlytics').default;
} catch {
  // Expo Go or crashlytics not available
}

export function reportError(error: unknown, context?: Record<string, string | number | boolean>) {
  const err = error instanceof Error ? error : new Error(String(error));
  if (__DEV__) {
    console.error('[reportError]', err.message, err.stack, context);
  }
  if (!__DEV__ && crashlytics) {
    const c = crashlytics();
    c.recordError(err);
    if (context) {
      c.setAttribute('context', JSON.stringify(context));
    }
  }
}

/**
 * Install global handler for unhandled errors. Call once at app startup.
 * Catches errors that slip through try/catch (e.g. unhandled promise rejections).
 */
export function installGlobalErrorHandler() {
  const ErrorUtils = (global as any).ErrorUtils;
  if (!ErrorUtils?.getGlobalHandler) return;
  const defaultHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    reportError(error, { isFatal: !!isFatal });
    defaultHandler(error, isFatal);
  });
}
