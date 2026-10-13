import assert from 'node:assert/strict';
import { claimLexiDailyGreeting } from '../src/utils/lexiGreeting.js';

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
};

assert.equal(claimLexiDailyGreeting('Kevin@example.com', storage, '2026-08-23'), true);
assert.equal(claimLexiDailyGreeting('kevin@example.com', storage, '2026-08-23'), false);
assert.equal(claimLexiDailyGreeting('kevin@example.com', storage, '2026-08-24'), true);
assert.equal(claimLexiDailyGreeting('', storage, '2026-08-24'), false);

console.log('Lexi daily greeting regression checks passed.');