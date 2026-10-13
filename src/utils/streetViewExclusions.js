/**
 * streetViewExclusions.js
 *
 * Persistence for "don't use this Street View photo" vetoes.
 *
 * The AI's per-frame usability verdict is good but not perfect: a frame where
 * the subject house is half-hidden behind a parked truck, or where a similar
 * looking neighbouring house fills the frame, can still pass and quietly skew
 * wall width and opening counts.  When the estimator vetoes such a frame the
 * decision has to survive a later re-run, otherwise the bad frame silently
 * comes back and the measurement drifts again.
 *
 * Vetoes are stored per property address (the frames are address-specific) in
 * localStorage.  Storage failures are non-fatal — the veto still applies to the
 * current session, it just is not remembered.
 */

import { streetViewFrameKey } from './sidingPhotoList.js';

const STORAGE_KEY = 'aiEstimatorExcludedStreetViewFrames';

// Keep the store bounded — an estimator can touch a lot of addresses.
const MAX_REMEMBERED_ADDRESSES = 50;

/** Normalize a property address into a stable storage key. */
export function streetViewAddressKey(address) {
  return String(address || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function readStore() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.debug('Could not read Street View exclusions:', error);
    return {};
  }
}

function writeStore(store) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch (error) {
    // Quota or private-mode failure. The in-memory veto still holds for this
    // session; only the "remembered next time" half is lost.
    console.debug('Could not persist Street View exclusions:', error);
  }
}

/**
 * Read the vetoed frame keys for one address.
 * @param {string} address
 * @returns {string[]}
 */
export function readStreetViewExclusions(address) {
  const addressKey = streetViewAddressKey(address);
  if (!addressKey) return [];
  const entry = readStore()[addressKey];
  if (!Array.isArray(entry)) return [];
  return [...new Set(entry.map(streetViewFrameKey))];
}

/**
 * Persist the vetoed frame keys for one address. Passing an empty list clears
 * the address so an estimator who un-vetoes everything leaves no residue.
 *
 * @param {string} address
 * @param {string[]} keys
 * @returns {string[]} the normalized keys that were stored
 */
export function writeStreetViewExclusions(address, keys) {
  const addressKey = streetViewAddressKey(address);
  const normalized = [...new Set((keys || []).map(streetViewFrameKey))];
  if (!addressKey) return normalized;

  const store = readStore();
  if (normalized.length === 0) {
    delete store[addressKey];
  } else {
    // Re-insert last so the oldest address is the first one pruned.
    delete store[addressKey];
    store[addressKey] = normalized;
  }

  const addressKeys = Object.keys(store);
  if (addressKeys.length > MAX_REMEMBERED_ADDRESSES) {
    for (const stale of addressKeys.slice(0, addressKeys.length - MAX_REMEMBERED_ADDRESSES)) {
      delete store[stale];
    }
  }

  writeStore(store);
  return normalized;
}

/**
 * Toggle one frame's veto for an address and persist the result.
 *
 * @param {string} address
 * @param {string[]} currentKeys
 * @param {object|string} frame
 * @returns {{ keys: string[], excluded: boolean }} new key list and the frame's new state
 */
export function toggleStreetViewExclusion(address, currentKeys, frame) {
  const frameKey = streetViewFrameKey(frame);
  const current = new Set((currentKeys || []).map(streetViewFrameKey));
  const excluded = !current.has(frameKey);
  if (excluded) current.add(frameKey);
  else current.delete(frameKey);
  return { keys: writeStreetViewExclusions(address, [...current]), excluded };
}
