import { localToday } from './localDate.js';

function greetingKey(email) {
  return `lexi:last-greeting:${String(email || '').trim().toLowerCase()}`;
}

/**
 * Claims the once-per-local-day Lexi welcome for one staff member.
 * Returns true only for their first Lexi chat opening of the local day.
 */
export function claimLexiDailyGreeting(email, storage = window.localStorage, today = localToday()) {
  if (!email || !storage) return false;
  const key = greetingKey(email);
  if (storage.getItem(key) === today) return false;
  storage.setItem(key, today);
  return true;
}