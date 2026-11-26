/**
 * The browser fetches a screen's code the first time that screen opens. A deploy replaces
 * those files, so a tab opened before the deploy can ask for a file that is gone. Reloading
 * the page fetches the new ones. This module decides when a reload is worth it and remembers
 * the last one, so an outage cannot make the page reload in a loop.
 */

/** After a reload for missing code, no second one for this long. */
export const STALE_CODE_RELOAD_PAUSE_MS = 60_000;
const LAST_RELOAD_KEY = 'cratesync_stale_code_reload_at_v1';

export function shouldReloadForStaleCode(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null || lastReloadAt > now) return true;
  return now - lastReloadAt > STALE_CODE_RELOAD_PAUSE_MS;
}

function readLastReloadAt(): number | null {
  try {
    const raw = sessionStorage.getItem(LAST_RELOAD_KEY);
    const at = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
}

let quietFetches = 0;

/**
 * Runs a fetch of screen code that nobody is waiting for. A failure inside it never reloads
 * the page: the person at the screen did not ask for anything, and the network may be down.
 */
export async function fetchCodeQuietly(fetchCode: () => Promise<unknown>): Promise<void> {
  quietFetches++;
  try {
    await fetchCode();
  } catch {
    // The screen fetches its code again when somebody opens it.
  } finally {
    quietFetches--;
  }
}

/**
 * Reloads the page when a screen's code cannot be fetched. Vite reports that as the window
 * event vite:preloadError. Without a reload the event's error reaches the screen, which
 * shows its own message with a reload button.
 */
export function reloadWhenCodeIsStale(): void {
  window.addEventListener('vite:preloadError', (event) => {
    if (quietFetches > 0 || !navigator.onLine) return;
    const now = Date.now();
    if (!shouldReloadForStaleCode(readLastReloadAt(), now)) return;
    try {
      sessionStorage.setItem(LAST_RELOAD_KEY, String(now));
    } catch {
      // With no place to remember the reload, a second one could not be stopped.
      return;
    }
    event.preventDefault();
    window.location.reload();
  });
}
