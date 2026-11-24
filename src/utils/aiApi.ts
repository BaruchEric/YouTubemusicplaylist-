import { getFirebaseIdToken } from './googleAuth';

export const AI_SIGN_IN_REQUIRED_MESSAGE =
  'Sign in with Google (Drive Sync & Transfer) to use AI lookups.';

// A batch run should ride out a short rate limit instead of losing the batches it finished.
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 120_000;

function waitFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * POSTs JSON to one of the server's Gemini endpoints with the user's Firebase ID token, or
 * with no token when signed out; the server decides (the dev server lets this machine in,
 * a deployed one answers 401 with a sign-in message). Throws the server's own error message
 * on failure. A 429 waits for Retry-After (5 seconds
 * when absent, at most 2 minutes) and tries again, up to three times.
 *
 * The result is Partial because it is unvalidated JSON; callers check each field they read.
 */
export async function postAiRequest<T extends object>(
  url: string,
  body: unknown,
  options: { signal?: AbortSignal; fallbackError: (status: number) => string }
): Promise<Partial<T>> {
  for (let attempt = 0; ; attempt++) {
    const idToken = await getFirebaseIdToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: idToken
        ? { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }
        : { 'Content-Type': 'application/json' },
      signal: options.signal,
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<T> & { error?: string };

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfterSec = Number(res.headers.get('Retry-After'));
      const waitMs =
        Number.isFinite(retryAfterSec) && retryAfterSec > 0
          ? Math.min(retryAfterSec * 1000, MAX_RETRY_WAIT_MS)
          : 5000;
      await waitFor(waitMs, options.signal);
      continue;
    }

    if (!res.ok) {
      if (res.status === 401 && !data.error) throw new Error(AI_SIGN_IN_REQUIRED_MESSAGE);
      throw new Error(data.error || options.fallbackError(res.status));
    }
    return data;
  }
}
