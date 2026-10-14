'use strict';
/**
 * Gemini Live API health-check probe.
 *
 * Opens a real WebSocket session, sends a minimal setup, waits for
 * setupComplete, sends one silence audio frame (audio/pcm;rate=16000),
 * then holds the socket open for a quiet window.  Any close or error
 * during the quiet window is reported as failure so a MIME/format
 * regression is caught rather than masked.
 *
 * Accepts an optional `WebSocketClass` override so the probe can be
 * unit-tested with a mock transport without starting a live server.
 *
 * Returns { ok, errorReason, closeCode, latencyMs } — never throws.
 */

const { WebSocket: NativeWebSocket } = require('ws');
const { geminiLiveModel } = require('./geminiLiveModel.cjs');

const SETUP_TIMEOUT_MS   = 20000;
const QUIET_WINDOW_MS    = 4000;
const SILENCE_FRAME_B64  = Buffer.alloc(320).toString('base64');

async function probeGeminiLiveApi({
  apiKey     = process.env.GOOGLE_GEMINI_API_KEY,
  model      = geminiLiveModel(),
  WebSocketClass = NativeWebSocket,
} = {}) {
  if (!apiKey) {
    return { ok: false, errorReason: 'GOOGLE_GEMINI_API_KEY not set', closeCode: null, latencyMs: 0 };
  }

  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  const startMs = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let ws;
    let postAudioTimer = null;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (postAudioTimer) { clearTimeout(postAudioTimer); postAudioTimer = null; }
      try { if (ws && ws.readyState === WebSocketClass.OPEN) ws.close(); } catch (_) {}
      resolve({ ...result, latencyMs: Date.now() - startMs });
    };

    // Hard outer timeout covers the full handshake + quiet window
    const timeoutHandle = setTimeout(() => {
      settle({ ok: false, errorReason: `Timeout waiting for setupComplete (model: ${model})`, closeCode: null });
    }, SETUP_TIMEOUT_MS);

    try {
      ws = new WebSocketClass(url);

      ws.on('open', () => {
        try {
          ws.send(JSON.stringify({
            setup: {
              model,
              generation_config: { response_modalities: ['AUDIO'] },
              system_instruction: { parts: [{ text: 'Health probe — do not respond.' }] },
            },
          }));
        } catch (e) {
          clearTimeout(timeoutHandle);
          settle({ ok: false, errorReason: `Setup send error: ${e.message}`, closeCode: null });
        }
      });

      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.setupComplete && !postAudioTimer) {
            // Send one silence audio frame in the expected format.
            // If the send itself throws (socket state race) settle as failure
            // immediately — do NOT start the quiet-window timer on a failed send.
            let sendOk = false;
            try {
              ws.send(JSON.stringify({
                realtime_input: { audio: { data: SILENCE_FRAME_B64, mimeType: 'audio/pcm;rate=16000' } },
              }));
              sendOk = true;
            } catch (sendErr) {
              clearTimeout(timeoutHandle);
              settle({ ok: false, errorReason: `Audio frame send error: ${sendErr.message}`, closeCode: null });
            }
            if (sendOk) {
              // Hold the connection open. A MIME/protocol rejection arrives as a
              // close/error event; a clean acceptance keeps the socket open until
              // the quiet window expires and we settle ok.
              postAudioTimer = setTimeout(() => {
                clearTimeout(timeoutHandle);
                settle({ ok: true, errorReason: null, closeCode: null });
              }, QUIET_WINDOW_MS);
            }
          }
        } catch (_) {}
      });

      ws.on('close', (code, reason) => {
        clearTimeout(timeoutHandle);
        const reasonStr = reason ? reason.toString() : '';
        // Any close before the quiet window completes is a failure (incl. 1007/1008)
        settle({
          ok: false,
          errorReason: `WebSocket closed (code ${code})${reasonStr ? ': ' + reasonStr : ''}`,
          closeCode: code,
        });
      });

      ws.on('error', (e) => {
        clearTimeout(timeoutHandle);
        settle({ ok: false, errorReason: `WebSocket error: ${e.message}`, closeCode: null });
      });
    } catch (e) {
      clearTimeout(timeoutHandle);
      settle({ ok: false, errorReason: `Failed to open WebSocket: ${e.message}`, closeCode: null });
    }
  });
}

/**
 * Normalise a list of staff_profile rows (each with user_email and/or email
 * columns) into a deduplicated array of non-empty address strings.
 *
 * Exported so unit tests can verify the COALESCE/empty-string fallback logic
 * without a live database.
 *
 * @param {Array<{user_email?: string, email?: string}>} rows
 * @returns {string[]}
 */
function normalizeRecipientEmails(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    // Mirror the SQL: COALESCE(NULLIF(user_email,''), NULLIF(email,''))
    const addr = ((row.user_email || '').trim() || (row.email || '').trim()).trim();
    if (addr && !seen.has(addr)) {
      seen.add(addr);
      result.push(addr);
    }
  }
  return result;
}

module.exports = { probeGeminiLiveApi, normalizeRecipientEmails };
