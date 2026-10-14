'use strict';

/**
 * Tenant-scoped caller memory for Alex (phone) and Lexi (in-app).
 * Every read and write requires company_id. Rows are unique per
 * (company_id, phone_key) so the same number in two companies never shares memory.
 */

const FLASH_MODEL = 'gemini-2.5-flash';
const MEMORY_WORD_MAX = 800;
const RECENT_WORDS = 450;
const LONG_CALL_WORDS = 1200;
const FACT_FIELDS = [
  'name',
  'address',
  'roof_issue',
  'insurance_carrier',
  'claim_number',
  'appointment',
  'preferences',
  'last_outcome',
];

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS caller_memories (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  phone_key TEXT NOT NULL,
  customer_id TEXT,
  lead_id TEXT,
  contact_name TEXT,
  summary TEXT NOT NULL DEFAULT '',
  facts JSONB NOT NULL DEFAULT '{}',
  recent_excerpt TEXT,
  older_summary TEXT,
  source_call_id TEXT,
  word_count INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (company_id, phone_key)
);
CREATE INDEX IF NOT EXISTS caller_memories_company_customer_idx ON caller_memories (company_id, customer_id);
CREATE INDEX IF NOT EXISTS caller_memories_company_lead_idx ON caller_memories (company_id, lead_id);
`;

const schemaReady = new WeakMap();

function words(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

function clipWords(text, max) {
  const list = words(text);
  if (list.length <= max) return list.join(' ');
  return list.slice(0, max).join(' ');
}

function phoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function assertCompany(companyId) {
  const id = String(companyId || '').trim();
  if (!id) {
    const err = new Error('company_id is required for caller memory');
    err.code = 'CALLER_MEMORY_COMPANY_REQUIRED';
    throw err;
  }
  return id;
}

function packTranscript(transcript) {
  const list = words(transcript);
  if (list.length <= LONG_CALL_WORDS) {
    return { older: '', recent: list.join(' '), compressed: false };
  }
  return {
    older: list.slice(0, -RECENT_WORDS).join(' '),
    recent: list.slice(-RECENT_WORDS).join(' '),
    compressed: true,
  };
}

function olderPrompt(older) {
  return `Summarize the OLDER portion of a roofing company phone call in at most 180 words.
Keep only facts the speakers actually said: names, addresses, roof issues, insurance carrier, claim numbers, appointments, preferences, and outcomes.
Do not invent details. Return plain text only.

OLDER TRANSCRIPT:
${older}`;
}

function memoryPrompt({ priorSummary, olderSummary, recent, priorFacts }) {
  return `You maintain a rolling caller memory for one roofing-company contact.
Return ONLY a JSON object with these keys:
- summary: string, 80-250 words, plain English, this company only
- facts: object with keys name, address, roof_issue, insurance_carrier, claim_number, appointment, preferences, last_outcome (string or null). Omit unknown values. Never invent.
- recent_excerpt: string, at most 120 words, from the latest call only

PRIOR MEMORY:
${priorSummary || '(none)'}
PRIOR FACTS:
${JSON.stringify(priorFacts || {})}
OLDER-CALL SUMMARY (already compressed; do not expand it back into a transcript):
${olderSummary || '(none)'}
LATEST CALL (recent portion only):
${recent}`;
}

function parseModelJson(text) {
  if (!text) return null;
  const raw = String(text).trim();
  try { return JSON.parse(raw); }
  catch (_) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (__) { return null; }
  }
}

function normalizeFacts(raw, prior) {
  const out = {};
  const base = prior && typeof prior === 'object' ? prior : {};
  for (const key of FACT_FIELDS) {
    const previous = base[key];
    if (previous != null && String(previous).trim()) out[key] = String(previous).trim().slice(0, 400);
  }
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const key of FACT_FIELDS) {
    const value = src[key];
    if (value == null) continue;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'unknown' || text.toLowerCase() === 'n/a') continue;
    out[key] = text.slice(0, 400);
  }
  return out;
}

function formatMemoryForInstructions(memory) {
  if (!memory || (!memory.summary && !memory.older_summary)) return '';
  const facts = memory.facts || {};
  const lines = [
    'CALLER MEMORY (this company only. Never mention another company, and never invent facts that are not listed):',
    memory.summary || '',
  ];
  for (const key of FACT_FIELDS) {
    if (facts[key]) lines.push(`${key}: ${facts[key]}`);
  }
  if (memory.older_summary) lines.push(`Earlier calls (compressed): ${memory.older_summary}`);
  lines.push('Call lookup_customer when you need the saved facts again. Do not claim details that are not listed here.');
  return clipWords(lines.filter(Boolean).join('\n'), MEMORY_WORD_MAX);
}

function instructionBlock(memory) {
  const text = formatMemoryForInstructions(memory);
  return text ? `\n\n${text}` : '';
}

function rowToMemory(row, companyId) {
  if (!row) return null;
  if (String(row.company_id) !== String(companyId)) return null;
  let facts = row.facts;
  if (typeof facts === 'string') {
    try { facts = JSON.parse(facts); } catch (_) { facts = {}; }
  }
  return {
    id: row.id,
    company_id: row.company_id,
    phone_key: row.phone_key,
    customer_id: row.customer_id || null,
    lead_id: row.lead_id || null,
    contact_name: row.contact_name || facts?.name || null,
    summary: row.summary || '',
    facts: facts || {},
    recent_excerpt: row.recent_excerpt || '',
    older_summary: row.older_summary || '',
    source_call_id: row.source_call_id || null,
    word_count: row.word_count || words(row.summary).length,
    updated_at: row.updated_at || null,
  };
}

async function ensureCallerMemorySchema(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('pool required');
  await pool.query(SCHEMA_SQL);
}

function ensureOnce(pool) {
  let pending = schemaReady.get(pool);
  if (!pending) {
    pending = ensureCallerMemorySchema(pool).catch((err) => {
      schemaReady.delete(pool);
      throw err;
    });
    schemaReady.set(pool, pending);
  }
  return pending;
}

async function loadCallerMemory(pool, { companyId, phone, customerId, leadId } = {}) {
  const cid = assertCompany(companyId);
  const key = phoneKey(phone);
  const customer = customerId ? String(customerId) : '';
  const lead = leadId ? String(leadId) : '';
  if (!key && !customer && !lead) return null;
  await ensureOnce(pool);
  const result = await pool.query(
    `SELECT id, company_id, phone_key, customer_id, lead_id, contact_name, summary, facts, recent_excerpt, older_summary, source_call_id, word_count, updated_at
     FROM caller_memories
     WHERE company_id = $1
       AND (
         ($2 <> '' AND phone_key = $2)
         OR ($3 <> '' AND customer_id = $3)
         OR ($4 <> '' AND lead_id = $4)
       )
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    [cid, key, customer, lead]
  );
  return rowToMemory(result.rows?.[0], cid);
}

function memoryId(companyId, key) {
  const safeCompany = String(companyId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return `cmem_${key}_${safeCompany}`.slice(0, 120);
}

async function saveCallerMemory(pool, input = {}) {
  const cid = assertCompany(input.companyId);
  const key = phoneKey(input.phone);
  if (!key) {
    const err = new Error('phone is required to save caller memory');
    err.code = 'CALLER_MEMORY_PHONE_REQUIRED';
    throw err;
  }
  await ensureOnce(pool);
  const facts = normalizeFacts(input.facts, {});
  const summary = clipWords(input.summary || '', MEMORY_WORD_MAX);
  const result = await pool.query(
    `INSERT INTO caller_memories (
       id, company_id, phone_key, customer_id, lead_id, contact_name,
       summary, facts, recent_excerpt, older_summary, source_call_id, word_count, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,NOW(),NOW())
     ON CONFLICT (company_id, phone_key) DO UPDATE SET
       customer_id = COALESCE(EXCLUDED.customer_id, caller_memories.customer_id),
       lead_id = COALESCE(EXCLUDED.lead_id, caller_memories.lead_id),
       contact_name = COALESCE(NULLIF(EXCLUDED.contact_name, ''), caller_memories.contact_name),
       summary = EXCLUDED.summary,
       facts = caller_memories.facts || EXCLUDED.facts,
       recent_excerpt = EXCLUDED.recent_excerpt,
       older_summary = COALESCE(NULLIF(EXCLUDED.older_summary, ''), caller_memories.older_summary),
       source_call_id = EXCLUDED.source_call_id,
       word_count = EXCLUDED.word_count,
       updated_at = NOW()
     WHERE caller_memories.company_id = EXCLUDED.company_id
     RETURNING id, company_id, phone_key, customer_id, lead_id, contact_name, summary, facts, recent_excerpt, older_summary, source_call_id, word_count, updated_at`,
    [
      memoryId(cid, key),
      cid,
      key,
      input.customerId || null,
      input.leadId || null,
      facts.name || input.contactName || null,
      summary,
      JSON.stringify(facts),
      clipWords(input.recentExcerpt || '', 160),
      clipWords(input.olderSummary || '', 220),
      input.sourceCallId || null,
      words(summary).length,
    ]
  );
  return rowToMemory(result.rows?.[0], cid);
}

async function callGeminiFlash(apiKey, prompt, fetchImpl) {
  if (!apiKey || !prompt) return '';
  const fetchFn = fetchImpl || globalThis.fetch;
  const res = await fetchFn(
    `https://generativelanguage.googleapis.com/v1beta/models/${FLASH_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 900 },
      }),
    }
  );
  if (!res || !res.ok) return '';
  const json = await res.json();
  return json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function buildMemoryFromTranscript({ transcript, prior, completeText }) {
  const packed = packTranscript(transcript || '');
  if (!packed.recent || words(packed.recent).length < 8) return null;
  let olderSummary = prior?.older_summary || '';
  if (packed.compressed && packed.older) {
    const olderText = await completeText(olderPrompt(packed.older));
    const clipped = clipWords(String(olderText || '').replace(/```/g, '').trim(), 180);
    if (clipped) olderSummary = clipWords(olderSummary ? `${olderSummary}\n${clipped}` : clipped, 220);
  }
  const raw = await completeText(memoryPrompt({
    priorSummary: prior?.summary || '',
    olderSummary,
    recent: packed.recent,
    priorFacts: prior?.facts || {},
  }));
  const parsed = parseModelJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const summary = clipWords(String(parsed.summary || '').trim(), 400);
  if (!summary) return null;
  return {
    summary,
    facts: normalizeFacts(parsed.facts, prior?.facts || {}),
    recentExcerpt: clipWords(String(parsed.recent_excerpt || packed.recent), 120),
    olderSummary,
    contactName: (parsed.facts && parsed.facts.name) || prior?.contact_name || null,
  };
}

async function rememberCall(pool, opts = {}) {
  const companyId = assertCompany(opts.companyId);
  if (!phoneKey(opts.phone)) return null;
  if (!opts.transcript || String(opts.transcript).trim().length < 25) return null;
  try {
    await ensureOnce(pool);
    const prior = await loadCallerMemory(pool, {
      companyId,
      phone: opts.phone,
      customerId: opts.customerId,
      leadId: opts.leadId,
    });
    const completeText = opts.completeText
      || (async (prompt) => callGeminiFlash(opts.apiKey, prompt, opts.fetchImpl));
    const built = await buildMemoryFromTranscript({
      transcript: opts.transcript,
      prior,
      completeText,
    });
    if (!built) return prior;
    return saveCallerMemory(pool, {
      companyId,
      phone: opts.phone,
      customerId: opts.customerId || prior?.customer_id,
      leadId: opts.leadId || prior?.lead_id,
      summary: built.summary,
      facts: built.facts,
      recentExcerpt: built.recentExcerpt,
      olderSummary: built.olderSummary,
      contactName: built.contactName,
      sourceCallId: opts.sourceCallId || null,
    });
  } catch (err) {
    if (err && err.code === 'CALLER_MEMORY_COMPANY_REQUIRED') throw err;
    console.warn('[CallerMemory] rememberCall failed:', err.message);
    return null;
  }
}

async function lookupCustomerDetail(pool, { companyId, phone, customerId, leadId } = {}) {
  const cid = assertCompany(companyId);
  const memory = await loadCallerMemory(pool, { companyId: cid, phone, customerId, leadId });
  if (!memory) return { found: false, company_id: cid, summary: '', facts: {} };
  return {
    found: true,
    company_id: cid,
    phone_key: memory.phone_key,
    customer_id: memory.customer_id,
    lead_id: memory.lead_id,
    contact_name: memory.contact_name,
    summary: memory.summary,
    facts: memory.facts,
    older_summary: memory.older_summary,
    recent_excerpt: memory.recent_excerpt,
    updated_at: memory.updated_at,
  };
}

const LOOKUP_CUSTOMER_TOOL = {
  name: 'lookup_customer',
  description: 'Look up the saved caller memory for the current company only: short summary plus key facts (name, address, roof issue, insurance carrier, claim number, appointment, preferences, last outcome). Use when the history already in your instructions is not enough.',
  parameters: {
    type: 'object',
    properties: {
      phone: { type: 'string', description: 'Caller phone number in any format' },
      customer_id: { type: 'string', description: 'CRM customer id, if known' },
      lead_id: { type: 'string', description: 'CRM lead id, if known' },
    },
  },
};

module.exports = {
  FLASH_MODEL,
  MEMORY_WORD_MAX,
  RECENT_WORDS,
  LONG_CALL_WORDS,
  FACT_FIELDS,
  SCHEMA_SQL,
  LOOKUP_CUSTOMER_TOOL,
  phoneKey,
  packTranscript,
  normalizeFacts,
  formatMemoryForInstructions,
  instructionBlock,
  ensureCallerMemorySchema,
  loadCallerMemory,
  saveCallerMemory,
  buildMemoryFromTranscript,
  rememberCall,
  lookupCustomerDetail,
  callGeminiFlash,
  clipWords,
  words,
};
