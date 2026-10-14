/**
 * lib/spokenBrandName.cjs
 *
 * How a voice model should SAY a company name.
 *
 * Gemini Live reads a tight all-caps token like "YICN" as a word ("Yipcn")
 * or drops letters ("icn", "YCN"). Hyphens ("Y-I-C-N") are not enough — the
 * model still lexicalizes the cluster. Periods with spaces ("Y. I. C. N.")
 * plus the spoken letter names ("why, eye, see, en") make each initial its
 * own syllable.
 *
 * Used by Lexi's native voice prompt and by the phone receptionist
 * (vite-twilio-ws-plugin.js and prod-server.cjs). One copy, so the two
 * servers cannot drift.
 *
 * An explicit per-company override (AssistantSettings.spoken_name) always
 * wins. Returns '' from deriveSpokenBrandName when the written name is
 * already fine to say (caller can skip injecting a pronunciation note).
 */

'use strict';

const LETTER_NAMES = {
  A: 'ay', B: 'bee', C: 'see', D: 'dee', E: 'ee', F: 'ef', G: 'jee',
  H: 'aitch', I: 'eye', J: 'jay', K: 'kay', L: 'el', M: 'em', N: 'en',
  O: 'oh', P: 'pee', Q: 'cue', R: 'ar', S: 'ess', T: 'tee', U: 'you',
  V: 'vee', W: 'double-you', X: 'ex', Y: 'why', Z: 'zee',
};

function spellLetters(letters) {
  return `${letters.split('').join('. ')}.`;
}

function letterName(letter) {
  return LETTER_NAMES[letter] || letter;
}

/** All-caps 2–5 letter token, optionally dotted or hyphenated ("YICN", "Y.I.C.N"). */
function acronymLetters(raw) {
  const token = String(raw || '');
  if (/[a-z0-9]/.test(token)) return null;
  const letters = token.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2 || letters.length > 5) return null;
  if (letters !== letters.toUpperCase()) return null;
  return letters;
}

/** A single capital, alone or with a period/comma ("Y", "Y.", "Y,"). */
function singleCapital(raw) {
  return /^[A-Z][.,]?$/.test(String(raw || ''));
}

function spellCompanyName(companyName) {
  const name = (companyName || '').trim();
  if (!name) return '';
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) out.push(spellLetters(run.join('')));
    else if (run.length === 1) out.push(run[0]);
    run = [];
  };
  for (const raw of name.split(/\s+/)) {
    if (singleCapital(raw)) {
      run.push(raw[0]);
      continue;
    }
    flush();
    const letters = acronymLetters(raw);
    if (letters) out.push(spellLetters(letters));
    else out.push(raw);
  }
  flush();
  return out.join(' ');
}

function acronymsInName(companyName) {
  const name = (companyName || '').trim();
  if (!name) return [];
  const found = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) found.push(run.join(''));
    run = [];
  };
  for (const raw of name.split(/\s+/)) {
    if (singleCapital(raw)) {
      run.push(raw[0]);
      continue;
    }
    flush();
    const letters = acronymLetters(raw);
    if (letters) found.push(letters);
  }
  flush();
  return found;
}

/**
 * @param {string} spokenNameSetting AssistantSettings.spoken_name override
 * @param {string} companyName written company name
 * @returns {string} spoken form, or '' when no change is needed
 */
function deriveSpokenBrandName(spokenNameSetting, companyName) {
  const override = (spokenNameSetting || '').toString().trim();
  const name = (companyName || '').trim();
  if (override) return override === name ? '' : override;
  if (!name) return '';
  const spoken = spellCompanyName(name);
  return spoken === name ? '' : spoken;
}

function pronunciationBlock(companyName, spokenBrand) {
  const name = (companyName || '').trim();
  const spoken = (spokenBrand || '').trim();
  if (!name || !spoken || spoken === name) return '';
  // Letter-name coaching only for the automatic spelling. A custom
  // spoken_name (for example a phonetic rewrite) must be said as written.
  const auto = deriveSpokenBrandName('', name);
  const phonetic = auto && spoken === auto
    ? acronymsInName(name)
      .map((letters) => `${letters.split('').join(' ')} sounds like ${letters.split('').map(letterName).join(', ')}`)
      .join('; ')
    : '';
  const phoneticLine = phonetic
    ? `\nSay each initial as its own letter name, slowly, with a pause between letters: ${phonetic}.`
    : '';
  return `\n\nPRONUNCIATION — required every time you say the company name, including the greeting:\nThe company is written "${name}". Never read that spelling as a word.\nSay it exactly as: "${spoken}".${phoneticLine}\nDo not blend the initials into one word. Do not drop a letter. Do not shorten them.`;
}

function rewriteVoiceText(text, companyName, spokenBrand) {
  if (!text || !spokenBrand) return text || '';
  const name = (companyName || '').trim();
  const spoken = String(spokenBrand).trim();
  if (!name || spoken === name) return text;
  let out = String(text).split(name).join(spoken);
  // Only auto-spelling should also rewrite a bare acronym left in the
  // knowledge base. A custom spoken_name is applied to the full name only,
  // so an override that mentions the written initials is left intact.
  const auto = deriveSpokenBrandName('', name);
  if (!auto || spoken !== auto) return out;
  for (const letters of acronymsInName(name)) {
    if (letters.length < 2) continue;
    const spelled = spellLetters(letters);
    out = out.replace(new RegExp(`\\b${letters}\\b`, 'g'), spelled);
  }
  return out;
}

/** Rewrite the written name inside a voice prompt, then append the rule. */
function applySpokenCompanyName(text, companyName, spokenBrand) {
  const name = (companyName || '').trim();
  const spoken = (spokenBrand || '').trim();
  if (!text || !spoken || !name || spoken === name) return text || '';
  return rewriteVoiceText(text, name, spoken) + pronunciationBlock(name, spoken);
}

module.exports = {
  deriveSpokenBrandName,
  pronunciationBlock,
  rewriteVoiceText,
  applySpokenCompanyName,
  spellCompanyName,
};
