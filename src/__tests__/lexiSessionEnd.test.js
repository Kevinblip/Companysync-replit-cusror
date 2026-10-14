import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const {
  IDLE_WARN_MS,
  IDLE_CLOSE_MS,
  GOODBYE_FORCE_CLOSE_MS,
  isSessionEndUtterance,
  createLexiSessionCloser,
  GOODBYE_CLOSE_CODE,
  IDLE_CLOSE_CODE,
} = createRequire(import.meta.url)('../../lib/lexiSessionEnd.cjs');

function createClock() {
  let t = 0;
  const timers = [];
  return {
    now: () => t,
    setTimeoutFn(fn, ms) {
      const timer = { at: t + ms, fn, cleared: false, fired: false };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn(timer) {
      if (timer) timer.cleared = true;
    },
    advance(ms) {
      t += ms;
      for (let guard = 0; guard < 30; guard += 1) {
        const due = timers
          .filter((timer) => !timer.cleared && !timer.fired && timer.at <= t)
          .sort((a, b) => a.at - b.at);
        if (due.length === 0) break;
        for (const timer of due) {
          timer.fired = true;
          timer.fn();
        }
      }
    },
  };
}

function createHarness({ handsFree = false } = {}) {
  const clock = createClock();
  const client = [];
  const gemini = [];
  const closed = [];
  const closer = createLexiSessionCloser({
    handsFree,
    sendClient: (message) => client.push(message),
    sendGemini: (payload) => {
      gemini.push(payload);
      return true;
    },
    closeAll: (code, reason) => closed.push({ code, reason }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });
  closer.start();
  return { clock, client, gemini, closed, closer };
}

function prompts(gemini) {
  return gemini.map((payload) => payload.client_content.turns[0].parts[0].text);
}

describe('isSessionEndUtterance', () => {
  it('matches a lone farewell and rejects stop inside a sentence', () => {
    for (const phrase of ['bye', 'Bye!', 'goodbye', 'good bye', 'hang up', 'hangup', "that's all", 'that is all', "that's it", "I'm done", 'all done', 'stop', 'stop please', 'thanks bye', 'ok, bye', 'bye bye bye']) {
      expect(isSessionEndUtterance(phrase), phrase).toBe(true);
    }
    for (const phrase of ['stop the estimate', 'stop talking', 'stop by the store', 'please stop the estimate', 'can you stop estimating', 'I have to go to the store', 'goodbye to the old shingles', '']) {
      expect(isSessionEndUtterance(phrase), phrase).toBe(false);
    }
  });
});

describe('Lexi session closer', () => {
  it('does not hang up when stop is only the first word of a sentence', () => {
    const { clock, client, gemini, closed, closer } = createHarness();
    closer.noteUserSpeech('stop');
    clock.advance(400);
    closer.noteUserSpeech('the estimate');
    clock.advance(1200);
    expect(closer.onTurnComplete()).toBe('continue');
    expect(gemini).toEqual([]);
    expect(closed).toEqual([]);
    expect(client.some((message) => message.type === 'session_end')).toBe(false);
  });

  it('cancels a premature goodbye when the rest of the sentence arrives', () => {
    const { clock, closed, closer } = createHarness();
    closer.noteUserSpeech('stop');
    clock.advance(1200);
    closer.noteUserSpeech('the estimate');
    clock.advance(1200);
    expect(closer.onTurnComplete()).toBe('continue');
    expect(closed).toEqual([]);
  });

  it('waits for a trailing transcript before treating a partial stop as goodbye', () => {
    const { clock, gemini, closed, closer } = createHarness();
    closer.noteUserSpeech('stop');
    expect(closer.onTurnComplete()).toBe('wait-settle');
    closer.noteUserSpeech('the estimate');
    clock.advance(1200);
    expect(closer.onTurnComplete()).toBe('continue');
    expect(gemini).toEqual([]);
    expect(closed).toEqual([]);
  });

  it('says goodbye for a settled farewell and closes on the following turn', () => {
    const { clock, client, gemini, closed, closer } = createHarness();
    closer.noteUserSpeech('bye');
    clock.advance(1200);
    expect(client.map((message) => message.type)).toContain('session_ending');
    expect(prompts(gemini).some((text) => /short goodbye/i.test(text))).toBe(true);
    expect(closed).toEqual([]);
    expect(closer.onTurnComplete()).toBe('skipped');
    expect(closed).toEqual([]);
    expect(closer.onTurnComplete()).toBe('closed');
    expect(closed).toEqual([{ code: GOODBYE_CLOSE_CODE, reason: 'goodbye' }]);
  });

  it('closes after the goodbye when the phrase is detected on turn completion', () => {
    const { clock, closed, closer } = createHarness();
    closer.noteUserSpeech('goodbye');
    clock.advance(200);
    expect(closer.onTurnComplete()).toBe('wait-settle');
    clock.advance(1000);
    expect(closed).toEqual([]);
    expect(closer.onTurnComplete()).toBe('closed');
    expect(closed).toEqual([{ code: GOODBYE_CLOSE_CODE, reason: 'goodbye' }]);
  });

  it('closes even when the goodbye turn never completes', () => {
    const { clock, closed, closer } = createHarness();
    closer.noteUserSpeech('bye');
    clock.advance(1200);
    expect(closed).toEqual([]);
    clock.advance(GOODBYE_FORCE_CLOSE_MS);
    expect(closed).toEqual([{ code: GOODBYE_CLOSE_CODE, reason: 'goodbye' }]);
  });

  it('does not force-close after a mid-sentence stop cancels the goodbye', () => {
    const { clock, closed, closer } = createHarness();
    closer.noteUserSpeech('stop');
    clock.advance(1200);
    closer.noteUserSpeech('the estimate');
    clock.advance(GOODBYE_FORCE_CLOSE_MS);
    expect(closed).toEqual([]);
    expect(closer.onTurnComplete()).toBe('continue');
  });

  it('lets end_session close on the next turn without a second goodbye prompt', () => {
    const { gemini, closed, closer } = createHarness();
    const result = closer.onEndSessionTool();
    expect(result.ending).toBe(true);
    expect(gemini).toEqual([]);
    expect(closer.onTurnComplete()).toBe('closed');
    expect(closed).toEqual([{ code: GOODBYE_CLOSE_CODE, reason: 'goodbye' }]);
  });

  it('warns at 45s and closes at 60s, and the warning does not reset the clock', () => {
    const { clock, client, gemini, closed, closer } = createHarness();
    clock.advance(IDLE_WARN_MS);
    expect(client).toContainEqual({ type: 'idle_warning' });
    expect(prompts(gemini).some((text) => /still here/i.test(text))).toBe(true);
    expect(closer.onTurnComplete()).toBe('warning');
    expect(closed).toEqual([]);
    clock.advance(IDLE_CLOSE_MS - IDLE_WARN_MS);
    expect(closed).toEqual([{ code: IDLE_CLOSE_CODE, reason: 'idle' }]);
  });

  it('resets the silence clock when the user speaks', () => {
    const { clock, closed, closer } = createHarness();
    clock.advance(40000);
    closer.noteUserSpeech('hello');
    clock.advance(20000);
    expect(closed).toEqual([]);
    clock.advance(40000);
    expect(closed).toEqual([{ code: IDLE_CLOSE_CODE, reason: 'idle' }]);
  });

  it('keeps hands-free sessions open through silence but still ends on goodbye', () => {
    const { clock, closed, closer } = createHarness({ handsFree: true });
    clock.advance(IDLE_CLOSE_MS + 1000);
    expect(closed).toEqual([]);
    closer.noteUserSpeech('hang up');
    clock.advance(1200);
    closer.onTurnComplete();
    closer.onTurnComplete();
    expect(closed).toEqual([{ code: GOODBYE_CLOSE_CODE, reason: 'goodbye' }]);
  });
});
