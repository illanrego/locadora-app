const KEY = 'locadora:quick-watch:v1:enabled';

export function readQuickWatchEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeQuickWatchEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(KEY, String(enabled));
  } catch {
    // The in-memory preference still applies for the active session.
  }
}
