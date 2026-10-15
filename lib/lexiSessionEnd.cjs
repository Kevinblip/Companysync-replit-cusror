'use strict';

// Shared by the dev native-voice plugin and the production Lexi bridge.
// Farewells are matched against a finished utterance, never a streaming fragment.

const IDLE_WARN_MS = 45000;
const IDLE_CLOSE_MS = 60000;
const UTTERANCE_SETTLE_MS = 1200;
// The spoken goodbye must not leave the Gemini socket open if the model never
// emits the following turn boundary.
const GOODBYE_FORCE_CLOSE_MS = 8000;
const GOODBYE_CLOSE_CODE = 4003;
const IDLE_CLOSE_CODE = 4002;
const MAX_END_WORDS = 8;

const FILLER_WORDS = new Set([
  'hey', 'hi', 'hello', 'ok', 'okay', 'please', 'thanks', 'um', 'uh',
  'lexi', 'now', 'alright', 'well',
]);

const END_PHRASES = new Set([
  'bye',
  'bye bye',
  'bye now',
  'bye for now',
  'goodbye',
  'good bye',
  'goodbye now',
  'stop',
  'hang up',
  'hangup',
  'hang up now',
  'thats all',
  'that is all',
  'thats all for now',
  'thats it',
  'that is it',
  'thats it for now',
  'im done',
  'i am done',
  'im finished',
  'i am finished',
  'all done',
  'were done',
  'we are done',
  'end the call',
  'end the session',
  'end call',
  'end session',
  'gotta go',
  'got to go',
  'have to go',
  'i have to go',
  'i gotta go',
  'talk later',
  'talk to you later',
  'see you',
  'see ya',
  'see you later',
]);

const GOODBYE_PROMPT = '[System: The user is ending the call. Say one short goodbye, under 8 words, then stop. Do not ask a question and do not continue the previous topic.]';
const IDLE_WARN_PROMPT = "[System: The user has been silent. Say one short line only: I'm still here — I'll close in a moment if I don't hear you. Do not ask a question.]";
const RETRACT_PROMPT = '[System: The user kept talking and is not ending the call. Ignore the goodbye instruction and answer what they just said.]';

// Kept as one sentence so both bridges stay lockstep with the barge-in rule:
// "stop talking" still means be quiet, while a lone "stop" ends the session.
const SESSION_END_INSTRUCTION = 'If the user explicitly says stop, stop talking, or asks you to be quiet, stop the current response immediately and wait silently for their next request. Do not continue or repeat the interrupted answer. A lone farewell — bye, goodbye, hang up, that\'s all, or the single word stop with nothing after it — means they are done: say one short goodbye under 8 words and call end_session. Do not call end_session when stop is part of a longer request such as stop the estimate or stop talking.';

const END_SESSION_TOOL = {
  name: 'end_session',
  description: 'End the in-app voice session after the user clearly says they are done (bye, goodbye, hang up, that\'s all, or the single word stop). Say a short goodbye before calling this. Do not call it for a longer request such as "stop the estimate" or "stop talking".',
  parameters: { type: 'object', properties: {} },
};

function normalizeUtterance(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/'/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripEdgeFillers(words) {
  let start = 0;
  let end = words.length;
  const eatLeading = () => {
    while (start < end && FILLER_WORDS.has(words[start])) start += 1;
    if (start + 1 < end && words[start] === 'thank' && words[start + 1] === 'you') start += 2;
  };
  const eatTrailing = () => {
    while (end > start && FILLER_WORDS.has(words[end - 1])) end -= 1;
    if (end - 2 >= start && words[end - 2] === 'thank' && words[end - 1] === 'you') end -= 2;
  };
  for (let pass = 0; pass < 4; pass += 1) {
    const before = `${start}:${end}`;
    eatLeading();
    eatTrailing();
    if (`${start}:${end}` === before) break;
  }
  return words.slice(start, end);
}

function isSessionEndUtterance(text) {
  const normalized = normalizeUtterance(text);
  if (!normalized) return false;
  const words = normalized.split(' ').filter(Boolean);
  if (words.length === 0 || words.length > MAX_END_WORDS) return false;
  const rawPhrase = words.join(' ');
  const coreWords = stripEdgeFillers(words);
  if (coreWords.length === 0) return false;
  const core = coreWords.join(' ');
  // "stop the estimate" and "stop talking" are requests, not farewells.
  // "stop stop" is still just the farewell word repeated.
  if (/^stop\s+\S/.test(core) && !coreWords.every((word) => word === 'stop')) return false;
  if (END_PHRASES.has(rawPhrase) || END_PHRASES.has(core)) return true;
  return isRepeatedFarewell(coreWords);
}

function isRepeatedFarewell(words) {
  if (words.length === 0) return false;
  const tokens = [];
  for (let i = 0; i < words.length; i += 1) {
    if (words[i] === 'hang' && words[i + 1] === 'up') {
      tokens.push('hang up');
      i += 1;
    } else if (words[i] === 'good' && words[i + 1] === 'bye') {
      tokens.push('goodbye');
      i += 1;
    } else {
      tokens.push(words[i]);
    }
  }
  return tokens.every((token) => token === 'bye' || token === 'goodbye' || token === 'stop' || token === 'hang up' || token === 'hangup');
}

function createLexiSessionCloser({
  handsFree = false,
  sendClient,
  sendGemini,
  closeAll,
  warnMs = IDLE_WARN_MS,
  closeMs = IDLE_CLOSE_MS,
  settleMs = UTTERANCE_SETTLE_MS,
  goodbyeForceCloseMs = GOODBYE_FORCE_CLOSE_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  let ending = false;
  let goodbyeRequested = false;
  let closeOnTurnComplete = false;
  let skipNextTurnComplete = false;
  let idleWarningPending = false;
  let turnReady = false;
  let utterance = '';
  let settleTimer = null;
  let warnTimer = null;
  let closeTimer = null;
  let forceTimer = null;

  function sendClientSafe(message) {
    try { sendClient?.(message); } catch (err) { /* socket already gone */ }
  }

  function sendGeminiSafe(payload) {
    try {
      return sendGemini?.(payload) !== false;
    } catch (err) {
      return false;
    }
  }

  function clearSettle() {
    if (settleTimer) clearTimeoutFn(settleTimer);
    settleTimer = null;
  }

  function clearIdleTimers() {
    if (warnTimer) clearTimeoutFn(warnTimer);
    if (closeTimer) clearTimeoutFn(closeTimer);
    warnTimer = null;
    closeTimer = null;
  }

  function clearForceClose() {
    if (forceTimer) clearTimeoutFn(forceTimer);
    forceTimer = null;
  }

  function armForceClose() {
    clearForceClose();
    forceTimer = setTimeoutFn(() => {
      forceTimer = null;
      finish('goodbye');
    }, goodbyeForceCloseMs);
  }

  function armIdle() {
    clearIdleTimers();
    if (handsFree || ending || goodbyeRequested) return;
    warnTimer = setTimeoutFn(() => {
      warnTimer = null;
      if (ending || goodbyeRequested) return;
      idleWarningPending = true;
      sendClientSafe({ type: 'idle_warning' });
      // This prompt is assistant speech. Its turnComplete must not re-arm the clock.
      sendGeminiSafe({
        client_content: {
          turns: [{ role: 'user', parts: [{ text: IDLE_WARN_PROMPT }] }],
          turn_complete: true,
        },
      });
    }, warnMs);
    closeTimer = setTimeoutFn(() => {
      closeTimer = null;
      finish('idle');
    }, closeMs);
  }

  function finish(reason) {
    if (ending) return;
    ending = true;
    clearSettle();
    clearIdleTimers();
    clearForceClose();
    const code = reason === 'idle' ? IDLE_CLOSE_CODE : GOODBYE_CLOSE_CODE;
    sendClientSafe({ type: 'session_end', reason });
    try { closeAll?.(code, reason); } catch (err) { /* already closing */ }
  }

  function requestGoodbye({ skipNext }) {
    if (ending || goodbyeRequested) return;
    goodbyeRequested = true;
    clearSettle();
    clearIdleTimers();
    skipNextTurnComplete = !!skipNext;
    closeOnTurnComplete = !skipNext;
    armForceClose();
    sendClientSafe({ type: 'session_ending', reason: 'goodbye' });
    const sent = sendGeminiSafe({
      client_content: {
        turns: [{ role: 'user', parts: [{ text: GOODBYE_PROMPT }] }],
        turn_complete: true,
      },
    });
    if (!sent) finish('goodbye');
  }

  function cancelGoodbye() {
    if (ending || !goodbyeRequested) return;
    goodbyeRequested = false;
    skipNextTurnComplete = false;
    closeOnTurnComplete = false;
    clearForceClose();
    sendClientSafe({ type: 'session_ending', reason: 'goodbye', cancelled: true });
    sendGeminiSafe({
      client_content: {
        turns: [{ role: 'user', parts: [{ text: RETRACT_PROMPT }] }],
        turn_complete: true,
      },
    });
    armIdle();
  }

  function considerSettledUtterance() {
    if (ending || goodbyeRequested) return;
    if (isSessionEndUtterance(utterance)) {
      // A debounce that beats turnComplete still belongs to the user's phrase.
      // Skip that in-flight reply and close on the goodbye that follows it.
      requestGoodbye({ skipNext: !turnReady });
      return;
    }
    if (turnReady) {
      utterance = '';
      if (!handsFree) armIdle();
    }
  }

  function noteUserSpeech(chunk) {
    if (ending) return;
    const piece = String(chunk || '').trim();
    if (!piece) return;
    idleWarningPending = false;
    turnReady = false;
    utterance = utterance ? `${utterance} ${piece}`.replace(/\s+/g, ' ').trim() : piece;
    if (goodbyeRequested && !isSessionEndUtterance(utterance)) cancelGoodbye();
    if (!goodbyeRequested) armIdle();
    clearSettle();
    settleTimer = setTimeoutFn(() => {
      settleTimer = null;
      considerSettledUtterance();
    }, settleMs);
  }

  function onTurnComplete() {
    if (ending) return 'ended';
    if (idleWarningPending && !goodbyeRequested) {
      idleWarningPending = false;
      return 'warning';
    }
    if (!goodbyeRequested) {
      turnReady = true;
      if (settleTimer) return 'wait-settle';
      if (isSessionEndUtterance(utterance)) {
        requestGoodbye({ skipNext: false });
        return 'goodbye-requested';
      }
      utterance = '';
      if (!handsFree) armIdle();
      return 'continue';
    }
    utterance = '';
    clearSettle();
    if (skipNextTurnComplete) {
      skipNextTurnComplete = false;
      closeOnTurnComplete = true;
      return 'skipped';
    }
    if (closeOnTurnComplete) {
      finish('goodbye');
      return 'closed';
    }
    return 'pending';
  }

  function onEndSessionTool() {
    if (ending) return { success: true, ending: true };
    clearSettle();
    clearIdleTimers();
    if (!goodbyeRequested) {
      goodbyeRequested = true;
      sendClientSafe({ type: 'session_ending', reason: 'goodbye' });
    }
    // The model was instructed to speak the goodbye before this call.
    skipNextTurnComplete = false;
    closeOnTurnComplete = true;
    armForceClose();
    return {
      success: true,
      ending: true,
      message: 'Session will close after this goodbye. Do not ask a question.',
    };
  }

  function dispose() {
    clearSettle();
    clearIdleTimers();
    clearForceClose();
  }

  function start() {
    if (!handsFree) armIdle();
  }

  return {
    noteUserSpeech,
    onTurnComplete,
    onEndSessionTool,
    finish,
    dispose,
    start,
    isEnding: () => ending,
  };
}

module.exports = {
  IDLE_WARN_MS,
  IDLE_CLOSE_MS,
  UTTERANCE_SETTLE_MS,
  GOODBYE_FORCE_CLOSE_MS,
  GOODBYE_CLOSE_CODE,
  IDLE_CLOSE_CODE,
  END_SESSION_TOOL,
  SESSION_END_INSTRUCTION,
  GOODBYE_PROMPT,
  isSessionEndUtterance,
  createLexiSessionCloser,
};
