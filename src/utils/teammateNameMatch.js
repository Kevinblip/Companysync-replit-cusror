// ── Spoken teammate-name resolution ──────────────────────────────────────────
// Turns a spoken utterance ("uh, send this to Vicky") into a confident single
// teammate, a short ambiguous set, or nothing at all.
//
// The hard rule: NEVER fall back to a silent best guess. A weak top score is
// reported as `none` and a close race is reported as `ambiguous` so the caller
// can read the options back to the user.

/** Score a candidate must clear before it is considered a hit at all. */
export const MATCH_THRESHOLD = 68;
/** Candidates within this many points of the leader make the result ambiguous. */
export const AMBIGUITY_DELTA = 6;
/** Most options ever read back to the user in one breath. */
export const MAX_AMBIGUOUS_CANDIDATES = 3;

// Words a driver says around the name. Stripped before matching so
// "send a message to vicky" resolves the same as "vicky".
const ADDRESSING_FILLER = new Set([
  'send', 'sending', 'sent', 'a', 'an', 'the', 'message', 'msg', 'voice', 'note',
  'to', 'for', 'tell', 'let', 'know', 'hey', 'hi', 'hello', 'um', 'uh', 'er',
  'please', 'my', 'teammate', 'text', 'this', 'that', 'it', 'is', 'okay', 'ok',
  'lexi', 'record', 'recording', 'over', 'and', 'out', 'talk',
]);

const CONFIRM_WORDS = [
  'send', 'send it', 'send that', 'sent', 'yes', 'yeah', 'yep', 'yup', 'yes send it',
  'okay', 'ok', 'confirm', 'confirmed', 'deliver', 'deliver it', 'do it', 'go',
  'go ahead', 'correct', 'right', 'affirmative', 'sure',
];

const CANCEL_WORDS = [
  'cancel', 'cancel it', 'no', 'nope', 'stop', 'stop it', 'discard', 'delete',
  'delete it', 'never mind', 'nevermind', 'forget it', 'abort', 'scrap it',
  'throw it away', 'quit', 'exit', 'wrong',
];

export function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc']/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Drop the words a person wraps a name in, keeping the name itself. */
export function stripAddressingFiller(spoken) {
  const words = normalizeName(spoken).split(' ').filter(Boolean);
  const kept = words.filter((w) => !ADDRESSING_FILLER.has(w));
  return (kept.length > 0 ? kept : words).join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) prev[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

export function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  if (!longest) return 0;
  return 1 - levenshtein(a, b) / longest;
}

// Classic Soundex — catches the mishearings speech recognition actually makes
// ("Vicki"/"Vicky", "Sean"/"Shawn", "Karen"/"Caron").
export function soundex(word) {
  const s = normalizeName(word).replace(/[^a-z]/g, '');
  if (!s) return '';
  const codes = { b: 1, f: 1, p: 1, v: 1, c: 2, g: 2, j: 2, k: 2, q: 2, s: 2, x: 2, z: 2, d: 3, t: 3, l: 4, m: 5, n: 5, r: 6 };
  let out = s[0].toUpperCase();
  let prev = codes[s[0]] || 0;
  for (let i = 1; i < s.length && out.length < 4; i += 1) {
    const ch = s[i];
    const code = codes[ch] || 0;
    if (code && code !== prev) out += String(code);
    // h and w are transparent: they do not reset the previous code
    if (ch !== 'h' && ch !== 'w') prev = code;
  }
  return (out + '000').slice(0, 4);
}

function contactTokens(contact) {
  const nameTokens = normalizeName(contact?.name).split(' ').filter(Boolean);
  const local = String(contact?.email || '').split('@')[0] || '';
  const localTokens = normalizeName(local.replace(/[._\-+0-9]+/g, ' ')).split(' ').filter(Boolean);
  return {
    nameNorm: nameTokens.join(' '),
    nameTokens,
    localNorm: localTokens.join(' '),
    localTokens,
    allTokens: [...new Set([...nameTokens, ...localTokens])],
  };
}

function scoreToken(spokenToken, token, isFirstName) {
  let score = 0;
  if (spokenToken === token) {
    score = isFirstName ? 92 : 86;
  } else if (token.length >= 3 && spokenToken.length >= 3 && (token.startsWith(spokenToken) || spokenToken.startsWith(token))) {
    score = 74;
  } else {
    const sim = similarity(spokenToken, token);
    if (sim >= 0.7) score = Math.round(45 + 40 * sim);
    else if (token.length >= 3 && spokenToken.length >= 3 && soundex(spokenToken) === soundex(token)) score = 70;
  }
  if (score > 0 && !isFirstName) score -= 2;
  return Math.max(0, score);
}

export function scoreContactAgainstSpoken(spokenNorm, spokenTokens, contact) {
  const { nameNorm, nameTokens, localNorm, allTokens } = contactTokens(contact);
  if (!nameNorm && !localNorm) return 0;

  let best = 0;
  if (spokenNorm && spokenNorm === nameNorm) best = 100;
  else if (spokenNorm && spokenNorm === localNorm) best = 96;
  else if (spokenTokens.length >= 2 && nameTokens.length >= 2 && similarity(spokenNorm, nameNorm) >= 0.8) best = 95;

  const firstName = nameTokens[0] || '';
  for (const spokenToken of spokenTokens) {
    for (const token of allTokens) {
      best = Math.max(best, scoreToken(spokenToken, token, token === firstName));
    }
  }
  return best;
}

/**
 * Resolve a spoken utterance to a teammate.
 *
 * @param {string} spoken       raw transcript
 * @param {Array<{email:string,name:string}>} roster
 * @returns {{status:'match'|'ambiguous'|'none', spoken:string, match?:object, candidates:Array}}
 */
export function resolveTeammateName(spoken, roster, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : MATCH_THRESHOLD;
  const cleaned = stripAddressingFiller(spoken);
  const heard = String(spoken || '').trim();
  if (!cleaned) return { status: 'none', spoken: heard, candidates: [] };

  const spokenTokens = cleaned.split(' ').filter(Boolean);
  const scored = (Array.isArray(roster) ? roster : [])
    .filter((c) => c && c.email)
    .map((contact) => ({ contact, score: scoreContactAgainstSpoken(cleaned, spokenTokens, contact) }))
    .filter((entry) => entry.score >= threshold)
    .sort((a, b) => b.score - a.score || String(a.contact.name || '').localeCompare(String(b.contact.name || '')));

  if (scored.length === 0) return { status: 'none', spoken: heard, candidates: [] };

  const leader = scored[0];
  const rivals = scored.slice(1).filter((entry) => leader.score - entry.score <= AMBIGUITY_DELTA);
  const decorate = (entry) => ({ ...entry.contact, score: entry.score });

  // A close race is always read back — never silently resolved to the leader,
  // even when the leader is an exact match (two people can share a name).
  if (rivals.length > 0) {
    return {
      status: 'ambiguous',
      spoken: heard,
      candidates: [leader, ...rivals].slice(0, MAX_AMBIGUOUS_CANDIDATES).map(decorate),
    };
  }

  return { status: 'match', spoken: heard, match: decorate(leader), candidates: [decorate(leader)] };
}

/** "Mike Adams or Mike Chen" — for reading an ambiguous set back aloud. */
export function describeCandidates(candidates) {
  const names = (candidates || []).map((c) => c?.name || c?.email).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

function phraseMatches(spoken, phrases) {
  const norm = normalizeName(spoken);
  if (!norm) return false;
  return phrases.some((phrase) => norm === phrase || norm.startsWith(`${phrase} `) || norm.endsWith(` ${phrase}`));
}

export function matchesConfirmation(spoken) {
  if (matchesCancellationWords(spoken)) return false;
  return phraseMatches(spoken, CONFIRM_WORDS);
}

function matchesCancellationWords(spoken) {
  return phraseMatches(spoken, CANCEL_WORDS);
}

export function matchesCancellation(spoken) {
  return matchesCancellationWords(spoken);
}

/** 'confirm' | 'cancel' | 'unclear' — the three outcomes of the spoken gate. */
export function classifyConfirmation(spoken) {
  if (matchesCancellationWords(spoken)) return 'cancel';
  if (phraseMatches(spoken, CONFIRM_WORDS)) return 'confirm';
  return 'unclear';
}
