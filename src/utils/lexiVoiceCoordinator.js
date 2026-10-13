const STORAGE_KEY = 'companysync:lexi-voice-owner';
const EVENT_NAME = 'companysync:lexi-voice-owner-change';
const OWNER_TTL_MS = 30000;

let broadcastChannel = null;
let listeners = new Set();
let listenersInstalled = false;

function makeToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `lexi_voice_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function readStoredOwner() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const owner = JSON.parse(raw);
    if (!owner?.kind || !owner?.token || owner.expiresAt <= Date.now()) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return owner;
  } catch {
    return null;
  }
}

function notify(owner, reason) {
  const event = { owner, reason };
  listeners.forEach(listener => {
    try { listener(event); } catch (error) { console.warn('[Lexi Voice] Owner listener failed:', error); }
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: event }));
  }
}

function installListeners() {
  if (listenersInstalled || typeof window === 'undefined') return;
  listenersInstalled = true;

  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    let owner = null;
    try { owner = event.newValue ? JSON.parse(event.newValue) : null; } catch {}
    if (owner && owner.expiresAt <= Date.now()) owner = null;
    notify(owner, 'external-change');
  });

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel('companysync-lexi-voice');
    broadcastChannel.onmessage = (event) => {
      const owner = event.data?.owner || null;
      if (owner && owner.expiresAt <= Date.now()) return;
      notify(owner, event.data?.reason || 'external-change');
    };
  }
}

function writeOwner(owner, reason) {
  if (typeof window !== 'undefined') {
    try {
      if (owner) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(owner));
      else window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
  notify(owner, reason);
  try { broadcastChannel?.postMessage({ owner, reason }); } catch {}
}

export function getLexiVoiceOwner() {
  return readStoredOwner();
}

/**
 * Voice modes deliberately use takeover semantics: a user starting one mode
 * should stop the other mode instead of hearing two assistants.
 */
export function acquireLexiVoiceOwner(kind, metadata = {}) {
  installListeners();
  const owner = {
    kind,
    token: makeToken(),
    companyId: metadata.companyId || null,
    startedAt: Date.now(),
    expiresAt: Date.now() + OWNER_TTL_MS,
  };
  writeOwner(owner, 'acquired');
  return owner;
}

export function refreshLexiVoiceOwner(kind, token) {
  const current = readStoredOwner();
  if (!current || current.kind !== kind || current.token !== token) return false;
  writeOwner({ ...current, expiresAt: Date.now() + OWNER_TTL_MS }, 'heartbeat');
  return true;
}

export function releaseLexiVoiceOwner(kind, token) {
  const current = readStoredOwner();
  if (!current || current.kind !== kind || current.token !== token) return false;
  writeOwner(null, 'released');
  return true;
}

export function isLexiVoiceOwner(kind, token = null) {
  const current = readStoredOwner();
  return Boolean(current && current.kind === kind && (!token || current.token === token));
}

export function subscribeToLexiVoiceOwner(listener) {
  installListeners();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startLexiVoiceOwnerHeartbeat(kind, token) {
  const interval = window.setInterval(() => {
    if (!refreshLexiVoiceOwner(kind, token)) window.clearInterval(interval);
  }, OWNER_TTL_MS / 3);
  return () => window.clearInterval(interval);
}