/**
 * Shared timeout + bounded-retry wrapper for outbound AI API calls (Gemini, OpenAI)
 * used by the CommonJS backend modules (prod-server.cjs, db/*.cjs, lib/*.cjs).
 *
 * Mirrors the fetchWithRetry helper defined in vite-functions-plugin.js /
 * vite-integrations-plugin.js (those are separate ESM Vite plugin modules with
 * no cross-import, so this is the CJS-side counterpart — keep behavior in sync
 * if either is changed).
 *
 * Retries transient failures only: request timeout/abort, and 429/5xx responses.
 * Non-transient errors (4xx other than 429) return immediately — retrying a bad
 * request or auth failure just wastes quota. Linear backoff between attempts.
 */
async function fetchWithRetry(url, fetchOpts = {}, { retries = 2, timeoutMs = 60000, retryDelayMs = 800 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...fetchOpts, signal: AbortSignal.timeout(timeoutMs) });
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      const transient = e.name === 'AbortError' || e.name === 'TimeoutError' || /timeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(e.message || '');
      if (attempt < retries && transient) {
        await new Promise(r => setTimeout(r, retryDelayMs * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Request failed after retries');
}

module.exports = { fetchWithRetry };
