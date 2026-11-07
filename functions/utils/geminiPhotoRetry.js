// One extra attempt for a siding photo read that hit the model timeout.
// Other Gemini callers keep their own retry count. This does not stack on it.

export const GEMINI_PHOTO_TIMEOUT_BACKOFF_MS = 2000;

export function isGeminiTimeout(err) {
  const name = err?.name || '';
  const message = String(err?.message || err || '');
  return name === 'TimeoutError'
    || name === 'AbortError'
    || /timeout|timed out|aborted/i.test(message);
}

export const GEMINI_PHOTO_RETRY_TIMEOUT_MS = 120000;

export async function retryTimedOutPhotoRead(read, {
  backoffMs = GEMINI_PHOTO_TIMEOUT_BACKOFF_MS,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  try {
    return { value: await read({ retry: false }), retried: false };
  } catch (err) {
    if (!isGeminiTimeout(err)) throw err;
    await wait(backoffMs);
    return { value: await read({ retry: true }), retried: true };
  }
}
