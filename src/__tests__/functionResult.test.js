import { describe, it, expect } from 'vitest';
import { fnData, fnError, fnOk, fnNumber } from '../lib/functionResult.js';

// Mirrors the real round trip.
//
// Server (/api/functions/invoke) always wraps:      { data: <handler return> }
// Client (invokeLocalFunction) passes that through, because `.data` is defined.
// So the envelope the UI sees is ALWAYS exactly one level deep, even when the
// handler's own return value happens to contain a `data` key.
const ok = (handlerReturn) => {
  const serverBody = { data: handlerReturn };
  // invokeLocalFunction: `return result.data !== undefined ? result : { data: result }`
  return serverBody.data !== undefined ? serverBody : { data: serverBody };
};
const fail = (message) => ({ error: message, data: {} });

describe('fnData', () => {
  it('unwraps the handler payload from a success envelope', () => {
    const envelope = ok({ totalCalls: 3, avgCallDuration: 4.25 });
    expect(fnData(envelope)).toEqual({ totalCalls: 3, avgCallDuration: 4.25 });
  });

  it('unwraps exactly one level when the handler itself returned a data key', () => {
    // Handler returned { data: { rows } }; the server wraps it once more, so the
    // envelope is { data: { data: { rows } } } and the caller must get back the
    // handler's own value — { data: { rows } } — NOT the inner rows object.
    const envelope = ok({ data: { rows: [1, 2] } });
    expect(envelope).toEqual({ data: { data: { rows: [1, 2] } } });
    expect(fnData(envelope)).toEqual({ data: { rows: [1, 2] } });
  });

  it('returns an empty object for a failure envelope', () => {
    expect(fnData(fail('boom'))).toEqual({});
  });

  it('never returns undefined/null for junk input', () => {
    expect(fnData(undefined)).toEqual({});
    expect(fnData(null)).toEqual({});
    expect(fnData('nope')).toEqual({});
    expect(fnData({ data: null })).toEqual({});
  });

  it('preserves array payloads', () => {
    expect(fnData(ok([1, 2, 3]))).toEqual([1, 2, 3]);
  });
});

describe('fnError', () => {
  it('returns null when the call succeeded', () => {
    expect(fnError(ok({ success: true }))).toBeNull();
  });

  it('surfaces a transport/handler error', () => {
    expect(fnError(fail('QuickBooks is not connected'))).toBe('QuickBooks is not connected');
  });

  it('surfaces a soft error reported inside the payload', () => {
    expect(fnError(ok({ error: 'no fields detected' }))).toBe('no fields detected');
  });

  it('is null for junk input rather than throwing', () => {
    expect(fnError(undefined)).toBeNull();
    expect(fnError(null)).toBeNull();
  });
});

describe('fnOk', () => {
  it('is true only when no error is present', () => {
    expect(fnOk(ok({ success: true }))).toBe(true);
    expect(fnOk(fail('nope'))).toBe(false);
    expect(fnOk(ok({ error: 'soft' }))).toBe(false);
  });
});

describe('fnNumber', () => {
  it('passes finite numbers through', () => {
    expect(fnNumber(4.25)).toBe(4.25);
    expect(fnNumber(0)).toBe(0);
  });

  it('coerces numeric strings', () => {
    expect(fnNumber('12.5')).toBe(12.5);
  });

  it('falls back to 0 for undefined/null/NaN/Infinity', () => {
    // This is the exact crash that took down the AI workspace:
    // undefined.toFixed(1) instead of (0).toFixed(1).
    expect(fnNumber(undefined)).toBe(0);
    expect(fnNumber(null)).toBe(0);
    expect(fnNumber('abc')).toBe(0);
    expect(fnNumber(Infinity)).toBe(0);
    expect(fnNumber(NaN)).toBe(0);
  });

  it('honours a custom fallback', () => {
    expect(fnNumber(undefined, 1)).toBe(1);
  });

  it('produces a value that is always safe to call .toFixed() on', () => {
    for (const v of [undefined, null, 'abc', NaN, Infinity, '3.7', 9]) {
      expect(() => fnNumber(v).toFixed(1)).not.toThrow();
    }
  });
});

describe('the regression that crashed the AI workspace', () => {
  // The handler returns stats at the top level; invoke() wraps them in .data.
  const handlerReturn = {
    comms: [{ id: 'c1' }],
    totalCalls: 2,
    inboundCalls: 1,
    totalSMS: 5,
    avgCallDuration: 3.5,
    emergencies: 0,
    aiHandled: 1,
  };

  it('reading the envelope directly yields undefined and throws on toFixed', () => {
    const envelope = ok(handlerReturn);
    expect(envelope.avgCallDuration).toBeUndefined();
    expect(() => envelope.avgCallDuration.toFixed(1)).toThrow(TypeError);
  });

  it('reading through fnData yields the real numbers', () => {
    const stats = fnData(ok(handlerReturn));
    expect(stats.avgCallDuration).toBe(3.5);
    expect(fnNumber(stats.avgCallDuration).toFixed(1)).toBe('3.5');
    // the live-conversations list was silently empty for the same reason
    expect(stats.comms).toHaveLength(1);
  });

  it('a partial payload renders 0 instead of crashing', () => {
    const stats = fnData(ok({ totalCalls: 2 }));
    expect(fnNumber(stats.avgCallDuration).toFixed(1)).toBe('0.0');
  });
});
