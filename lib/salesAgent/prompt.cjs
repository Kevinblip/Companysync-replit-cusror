'use strict';

const fs = require('fs');
const { repoFile } = require('./paths.cjs');
const { readState } = require('./salesStore.cjs');
const { loadPricing, assertCatalogPrices, priceSpeech } = require('./pricing.cjs');
const { agentClips } = require('./clips.cjs');

const MALE_VOICES = ['Fenrir', 'Charon', 'Orus', 'Puck'];
const AI_LINE = "Yes, I'm an AI assistant.";
const RECORDING_LINE = 'This call is recorded and transcribed so we can follow up accurately.';

function storedConfig() {
  try {
    return readState().config || {};
  } catch (_) {
    return {};
  }
}

function agentName(env = process.env) {
  const fromEnv = String(env.SALES_AGENT_NAME || '').trim();
  if (fromEnv) return fromEnv;
  const stored = String(storedConfig().agentName || '').trim();
  return stored || 'Cole';
}

function agentVoice(env = process.env) {
  const requested = String(env.SALES_AGENT_VOICE || storedConfig().voice || '').trim();
  const match = MALE_VOICES.find((voice) => voice.toLowerCase() === requested.toLowerCase());
  return match || 'Fenrir';
}

function handoffRep(env = process.env) {
  let file = { name: 'Kevin', email: '', phone: '', timezone: 'America/New_York' };
  try {
    file = JSON.parse(fs.readFileSync(repoFile('config/salesHandoff.json'), 'utf8'));
  } catch (_) { /* config is optional at runtime if env is set */ }
  const raw = String(env.SALES_HANDOFF_REP || '').trim();
  let parsed = null;
  if (raw.startsWith('{')) {
    try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
  }
  return {
    name: (parsed && parsed.name) || (!raw.startsWith('{') && raw) || file.name || 'Kevin',
    email: (parsed && parsed.email) || env.SALES_HANDOFF_EMAIL || file.email || '',
    phone: (parsed && parsed.phone) || env.SALES_HANDOFF_PHONE || file.phone || '',
    timezone: (parsed && parsed.timezone) || file.timezone || 'America/New_York',
  };
}

function filterKnowledge(markdown) {
  const source = String(markdown || '');
  const start = source.indexOf('## 0.');
  let body = start >= 0 ? source.slice(start) : source;
  body = body.replace(/\*\*Known mismatch[\s\S]*?(?=### Plan contents)/, '');
  body = body.replace(/## Decided defaults[\s\S]*$/, '');
  body = body.replace(/\(sidebar tour clip[^)]*\)/gi, '');
  const banned = /hearth|greensky|wisetack|abc supply|clip14|financ/i;
  body = body
    .split('\n')
    .filter((line) => !banned.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return body;
}

function loadKnowledge() {
  const file = repoFile('docs/sales-agent/SALES_KB.md');
  return filterKnowledge(fs.readFileSync(file, 'utf8'));
}

function clipCatalog() {
  return agentClips().map((clip) => {
    const moments = clip.keyMoments.map((moment) => `${moment.label} (${moment.start}-${moment.end}s)`).join('; ');
    return `- ${clip.id}: ${clip.title}. ${clip.desc}${moments ? ` Moments: ${moments}.` : ''}`;
  }).join('\n');
}

function buildSalesSystemPrompt(options = {}) {
  const name = options.agentName || agentName();
  const rep = handoffRep();
  const pricing = loadPricing();
  const knowledge = filterKnowledge(options.knowledge || loadKnowledge());
  const channel = options.channel === 'phone' ? 'phone' : 'web';
  const toolBlock = channel === 'phone'
    ? `PHONE TOOLS (this is a phone call, so you cannot play video):
- check_availability then book_appointment for a 15-minute demo. Offer only times a tool returned.
- save_lead_details as soon as you have a name.
- notify_rep or transfer_call to hand off to ${rep.name}. Collect their name, callback number, and reason first.
- Do not call play_clip. Offer to text a training link instead.
- end_call only after a natural goodbye. Never call end_call in the same turn as book_appointment, and never because the booking tool just returned.`
    : `TOOLS:
- list_slots before you offer a time. book_demo only with a slot the tool returned and the prospect accepted.
- play_clip only after they agree. Pass the clip id and, when you have one, the moment start and end. Stay silent while it plays. If they speak, stop the clip.
- send_trial_link to text and email the trial page. You cannot start the trial or take payment.
- handoff_to_rep when you do not know, they want a person, or a discount or custom deal comes up. The rep is ${rep.name}.
- log_objection when they push back (price, switching, jobnimbus, think, other).
- end_call after a short goodbye.`;

  const closeBlock = channel === 'phone'
    ? `- You never start a trial, take a card, or discount.
- After book_appointment succeeds, stay on the line. Do not hang up when the booking tool returns.
- Read back the day, the time, and the time zone.
- Say the confirmation link was sent and that you will send a reminder.
- Ask if there is anything else or any questions, then answer them.
- Say a natural goodbye.
- Call end_call only after that goodbye, or let the caller hang up.`
    : `- Close by sending the trial link or booking time with ${rep.name}. You never start a trial, take a card, or discount.`;

  const turnLength = channel === 'phone'
    ? '- After the opening, keep each turn under 25 words. The booked-demo confirmation is the exception: read back the day, time, and time zone, say the confirmation link was sent and that you will send a reminder, and ask if there is anything else.'
    : '- After the opening, keep each turn under 25 words.';

  const prompt = `You are ${name}, an AI sales assistant for CompanySync, talking with a roofing contractor.
Sound like a calm hired rep: short, natural, contractions, no script read aloud. You are not a human. If asked whether you are a bot, a robot, AI, or a real person, say exactly: "${AI_LINE}" Then offer ${rep.name}.

OPENING: The caller already heard this recording notice: "${RECORDING_LINE}" Do not say that notice again. Your first sentence gives your name and asks one question.

${toolBlock}

VOICE:
${turnLength}
- Ask one question, then wait. Never answer your own question.
- Ask before you play a clip. Do not read names, phone numbers, or dollar amounts that appear inside a video.
- Never invent prices, discounts, contracts, integrations, or delivery dates. If it is not in the knowledge below, say you will have ${rep.name} confirm it and hand off.
- Do not mention payment-plan partners or supplier-ordering integrations.
- Data migration assistance is Enterprise only. Never promise free migration on Basic or Business.
${closeBlock}
- Refer to yourself in gender-neutral language.
- If they say STOP, confirm you will stop and end the call.

PRICING LOCK: Quote only these amounts, nothing else: ${priceSpeech()}
Plans: ${pricing.plans.map((plan) => `${plan.name} $${plan.monthly}`).join(', ')}.
Never say a different dollar amount, a flat single price, a per-seat price, or a discount.

CLIPS YOU MAY PLAY:
${clipCatalog()}

KNOWLEDGE (only say what is here):
${knowledge}`;

  assertCatalogPrices(prompt, 'sales system prompt');
  const banned = /hearth|greensky|wisetack|abc supply|clip14|\$\s*59\b|\$\s*149\b|\$\s*299\b|\$\s*49\b|\$\s*500\b|\$99\/month flat/i;
  if (banned.test(prompt)) throw new Error('sales system prompt contains a banned phrase');
  return prompt;
}

function buildPhoneDemoPrompt(extra = {}) {
  const additions = [extra.knowledgeBase, extra.audioContext, extra.interimContext]
    .filter(Boolean)
    .join('\n');
  const cleaned = additions
    .split('\n')
    .filter((line) => !/hearth|greensky|wisetack|abc supply|clip14|\$\s*\d/i.test(line))
    .join('\n');
  return buildSalesSystemPrompt({
    channel: 'phone',
    knowledge: `${loadKnowledge()}\n${cleaned}`.trim(),
  });
}

module.exports = {
  MALE_VOICES,
  AI_LINE,
  RECORDING_LINE,
  agentName,
  agentVoice,
  handoffRep,
  filterKnowledge,
  buildSalesSystemPrompt,
  buildPhoneDemoPrompt,
};
