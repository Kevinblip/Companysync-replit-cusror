/**
 * lib/lexiGrounding.cjs
 *
 * Anti-hallucination grounding for Lexi.
 *
 * Lexi has fabricated people ("Mary Smith" for an inspection list) and money
 * ("$4500 this month") and has claimed writes that never touched the CRM.
 * A prompt rule alone had already failed once for build routing, so this module
 * ships three layers that do not depend on the model cooperating:
 *
 *   1. PROMPT       — groundingRulesBlock() states the hard rules.
 *   2. TOOL RESULTS — annotateToolResult() stamps every tool response with an
 *                     explicit _source envelope (status, row_count, directive),
 *                     so an empty or failed read is unmistakable to the model.
 *   3. AUDIT        — a per-turn ledger records what the tools actually
 *                     returned, and auditLexiResponse() blocks the two
 *                     fabrication shapes we have actually observed: a
 *                     placeholder person who appears in no tool result, and a
 *                     dollar figure answered without a successful money read.
 *
 * Write verification (BEFORE/AFTER re-read) lives in verifyEntityUpdate().
 *
 * Used by the Lexi chat handlers only (db/prod-integrations.cjs and
 * vite-functions-plugin.js). Keep this file free of Lexi-external concerns.
 */

'use strict';

/* ------------------------------------------------------------------ *
 * Tool classification
 * ------------------------------------------------------------------ */

// A successful call to one of these is the ONLY acceptable basis for stating
// a dollar figure about the company's money.
// Tools that return real dollar amounts. A tool missing from this set makes
// its figures look ungrounded, so keep it aligned with the runtimes' schemas.
const MONEY_TOOLS = new Set([
  'get_financial_summary',
  'get_staff_sales_summary',
  'get_customer_payment_status',
  'get_payments',
  'record_payment',
  'scan_check',
  'get_commission_summary',
]);

// get_crm_data is money-grounding only for these data types.
const MONEY_CRM_TYPES = new Set(['payments', 'invoices', 'estimates']);

// A successful call to one of these is the basis for schedule / inspection
// claims.
const SCHEDULE_TOOLS = new Set([
  'get_calendar_events',
  'get_build_schedule',
  'get_customer_build_schedule',
  'get_photosync_jobs',
  'assign_inspection',
  'create_calendar_event',
  'create_build_schedule',
  'lookup_customer_by_phone',
]);

const SCHEDULE_CRM_TYPES = new Set(['calendar_events', 'projects', 'tasks']);

/**
 * Names that read like filler from a training corpus rather than a real
 * customer. Lexi may only use one of these if the exact string came back from
 * a tool (or is in the injected customer list) this turn.
 */
const PLACEHOLDER_NAMES = [
  'mary smith',
  'john doe',
  'jane doe',
  'john q public',
  'john smith',
  'jane smith',
  'joe bloggs',
  'richard roe',
  'jane roe',
  'john roe',
  'acme roofing',
  'acme corp',
  'acme inc',
  'sample customer',
  'test customer',
  'example customer',
];

/* ------------------------------------------------------------------ *
 * Prompt block
 * ------------------------------------------------------------------ */

/**
 * The hard grounding rules, appended to every Lexi system prompt.
 * @param {object} [opts]
 * @param {boolean} [opts.compact] - shorter form for the voice prompts.
 * @returns {string}
 */
function groundingRulesBlock({ compact = false } = {}) {
  if (compact) {
    return `
🔒 GROUNDING (NON-NEGOTIABLE):
- Every fact about a person, job, inspection, schedule, or dollar amount must come from a tool result in THIS turn. No tool result, no fact.
- Never invent a customer, staff member, inspection, date, address, or figure. Say "I don't see that in the CRM" instead of guessing.
- Never use placeholder names like Mary Smith or John Doe unless a tool returned that exact name.
- Money: only report numbers get_financial_summary or a payment tool returned, with the date range. Never estimate or round a guess.
- Zero results means "none scheduled" — never fill the gap with a made-up person.
- After any update, re-read the record and state BEFORE and AFTER. If the tool did not report verified:true, say the change did NOT go through.`;
  }

  return `

═══════════════════════════════════════════════
🔒 GROUNDING RULES — THESE OVERRIDE EVERY OTHER INSTRUCTION
═══════════════════════════════════════════════

1) FACTS COME FROM TOOLS, IN THIS TURN
- Any claim about a person, job, inspection, appointment, schedule, dashboard
  entry, invoice, payment, or dollar amount MUST come from a tool result you
  received in this same turn. Prior turns and your own memory do not count.
- If the tool failed, returned zero rows, or is ambiguous, SAY SO. Never fill
  the gap. "I couldn't find that in the CRM" is always the correct answer over
  a plausible guess.
- Every tool result carries a "_source" field with its status and row_count.
  Read it. status "empty" means the records do not exist. status "failed"
  means you do not know — report the failure, do not answer around it.

2) NEVER FABRICATE
- Never invent customers, leads, staff, subcontractors, inspections,
  addresses, dates, or financial figures.
- NEVER use example-sounding names such as "Mary Smith", "John Doe", or
  "Acme Roofing" unless a tool returned that exact name for this company.
  A response containing an ungrounded placeholder name is rejected by the
  server before the user sees it.
- Do not soften an unknown into an example. No "for instance, you might have
  a 9am with…".

3) MONEY
- For any revenue / income / collected / made / owed question, call
  get_financial_summary (or the payment tool that fits) FIRST.
- Report only what it returned: the total, the payment count, and the date
  range it covered. Always name the date range.
- If the tool fails or is not permitted, refuse plainly. NEVER estimate,
  extrapolate, average, or state a round number. A dollar figure with no
  successful money lookup behind it is rejected by the server.

4) INSPECTIONS AND SCHEDULE
- For "what inspections / jobs / appointments are on <date>", query the real
  rows (get_photosync_jobs, get_calendar_events, get_build_schedule) for that
  date and report only the rows returned, each with its identifier — job id or
  record name plus address.
- Zero rows means exactly one answer: "Nothing is scheduled for that date."
  Never substitute a person who was not in the result.

5) WRITE ACTIONS — VERIFY, THEN REPORT BEFORE AND AFTER
- After any update, move, reschedule, or status change, the tool re-reads the
  record and returns "before", "after", and "verified".
- Report the BEFORE value and the AFTER value in your reply.
- If "verified" is not true, or the after value does not match what the user
  asked for, tell them the change did NOT go through and say what the record
  still shows. Never say "done", "moved", or "rescheduled" in that case.

6) CITE YOUR SOURCE
- Attach the identifier to each fact: the job id, invoice number, record name,
  or the date range the totals cover.
- If you cannot name where a fact came from, do not state it as fact.
═══════════════════════════════════════════════`;
}

/* ------------------------------------------------------------------ *
 * Tool result envelope
 * ------------------------------------------------------------------ */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Best-effort row count for a tool result. Returns null when the result is not
 * a list-shaped read (e.g. a create returning an id).
 */
function rowCountOf(result) {
  if (!isPlainObject(result)) return null;
  if (Number.isFinite(result.count)) return Number(result.count);
  if (Number.isFinite(result.row_count)) return Number(result.row_count);
  const arrayKey = Object.keys(result).find((k) => Array.isArray(result[k]));
  if (arrayKey) return result[arrayKey].length;
  return null;
}

/**
 * Classify a tool result: 'failed' | 'denied' | 'empty' | 'ok'.
 */
function statusOf(result) {
  if (!isPlainObject(result)) return 'failed';
  if (result.code === 'LEXI_ACCESS_DENIED') return 'denied';
  if (result.error) return 'failed';
  if (result.success === false) return 'failed';
  const count = rowCountOf(result);
  if (count === 0) return 'empty';
  return 'ok';
}

const DIRECTIVES = {
  failed: 'This lookup FAILED. You do not have the data. Tell the user the lookup failed and what you need to retry. Do not answer from memory and do not substitute a similar tool.',
  denied: 'This lookup was blocked by access rules. Explain the restriction briefly and offer help with the user\'s own work. Do not state the underlying data.',
  empty: 'ZERO matching records exist. The correct answer is that none were found. Do NOT name any person, job, date, or amount that is not in this result.',
  ok: 'Ground your answer only in the records below. Cite each fact by its id, record name, or date range. Do not add rows, people, or figures that are not here.',
};

/**
 * Stamp a tool result with its grounding envelope. Additive only — the
 * original fields are untouched, so existing model behaviour and tests that
 * read those fields keep working.
 *
 * @param {string} toolName
 * @param {any} result
 * @returns {any} the annotated result
 */
function annotateToolResult(toolName, result) {
  if (!isPlainObject(result)) {
    return {
      error: 'Tool returned no usable result.',
      _source: { tool: toolName, status: 'failed', instruction: DIRECTIVES.failed },
    };
  }
  const status = statusOf(result);
  const count = rowCountOf(result);
  const envelope = { tool: toolName, status, instruction: DIRECTIVES[status] };
  if (count !== null) envelope.row_count = count;
  return { ...result, _source: envelope };
}

/* ------------------------------------------------------------------ *
 * Per-turn grounding ledger
 * ------------------------------------------------------------------ */

function collectStrings(value, out, depth = 0) {
  if (depth > 6 || out.length > 4000) return out;
  if (typeof value === 'string') {
    out.push(value);
  } else if (typeof value === 'number') {
    out.push(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (key === '_source' || key === 'instruction') continue;
      collectStrings(value[key], out, depth + 1);
    }
  }
  return out;
}

// Keys whose values really are dollar amounts. Only these are treated as
// monetary evidence — a payment COUNT of 3 or an invoice NUMBER of 4500 must
// never license "$3" or "$4,500".
const AMOUNT_KEY_RE = /(amount|total|paid|balance|price|cost|subtotal|revenue|rcv|acv|deposit|collected|_due|due_|^due$|fee|payout|commission|charge|refund|credit|owed|value)/i;

// ...but these look monetary and are not.
const NOT_AMOUNT_KEY_RE = /(count|number|num_|_num$|_id$|^id$|qty|quantity|percent|pct|rate$|_rate|days|year|month|index|version|status|phone|zip)/i;

function isAmountKey(key) {
  return AMOUNT_KEY_RE.test(key) && !NOT_AMOUNT_KEY_RE.test(key);
}

function numbersInside(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  if (typeof value !== 'string') return [];
  const found = value.match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  return found.map((f) => Number(f.replace(/,/g, ''))).filter((n) => Number.isFinite(n));
}

/**
 * Dollar amounts a money tool actually returned, under keys that really hold
 * money. A figure Lexi reports must equal one of these.
 */
function collectMoneyAmounts(value, out = [], depth = 0, keyIsAmount = false) {
  if (depth > 6 || out.length > 4000) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectMoneyAmounts(item, out, depth + 1, keyIsAmount);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (key === '_source' || key === 'instruction') continue;
      collectMoneyAmounts(value[key], out, depth + 1, isAmountKey(key));
    }
  } else if (keyIsAmount) {
    for (const n of numbersInside(value)) out.push(n);
  }
  return out;
}

/**
 * Totals Lexi may legitimately compute herself: for each list of records a
 * money tool returned, the sum of that list's amounts. This is provenance-
 * preserving — it admits "$150 across 2 payments" for [100, 50] but not a
 * "$4,500" that is merely smaller than the pile.
 */
function collectMoneyAggregates(value, out = [], depth = 0) {
  if (depth > 6) return out;
  if (Array.isArray(value)) {
    if (value.length > 1) {
      // Each amount-like column of the list gets its own total, so a list of
      // payments yields the payment total and not a mix of unrelated columns.
      const byKey = new Map();
      for (const item of value) {
        if (!isPlainObject(item)) continue;
        for (const key of Object.keys(item)) {
          if (!isAmountKey(key)) continue;
          const nums = numbersInside(item[key]);
          if (!nums.length) continue;
          byKey.set(key, (byKey.get(key) || 0) + nums[0]);
        }
      }
      for (const total of byKey.values()) out.push(total);
    }
    for (const item of value) collectMoneyAggregates(item, out, depth + 1);
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (key === '_source' || key === 'instruction') continue;
      collectMoneyAggregates(value[key], out, depth + 1);
    }
  }
  return out;
}

/** Currency figures the user typed themselves ("$2,500"), never bare numbers. */
function currencyFiguresIn(text) {
  const found = String(text || '').match(/\$\s?\d[\d,]*(?:\.\d{1,2})?/g) || [];
  return found.map((f) => Number(f.replace(/[^0-9.]/g, ''))).filter((n) => Number.isFinite(n));
}

/**
 * Tracks what this turn's tools actually proved, so the final response can be
 * audited against it.
 *
 * @param {object} [opts]
 * @param {string} [opts.userMessage]   - the user's message this turn
 * @param {string} [opts.promptContext] - grounded context already injected into
 *                                        the system prompt (e.g. the customer
 *                                        list), which counts as a real source
 *                                        for NAMES but never for money.
 */
function createGroundingLedger({ userMessage = '', promptContext = '' } = {}) {
  return {
    userMessage: String(userMessage || ''),
    nameCorpus: String(promptContext || '').toLowerCase(),
    moneyCorpus: '',
    calls: [],
    // Dollar amounts a money read actually returned, plus the per-list totals
    // Lexi may legitimately compute from them. Nothing else counts as money.
    moneyAmounts: [],
    moneyAggregates: [],
    scheduleTimes: [],
    moneyGrounded: false,
    scheduleGrounded: false,
    anyGrounded: false,
    accessDenied: false,

    /**
     * @param {string} toolName
     * @param {object} args   - the arguments the model passed
     * @param {any} result    - the tool result (pre- or post-annotation)
     */
    record(toolName, args, result) {
      const status = statusOf(result);
      this.calls.push({ tool: toolName, status });
      if (status === 'denied') this.accessDenied = true;

      const text = collectStrings(result, []).join(' \u0001 ').toLowerCase();
      this.nameCorpus += ` ${text}`;

      // Only a successful read grounds a claim.
      if (status !== 'ok' && status !== 'empty') return;
      this.anyGrounded = true;

      const crmType = String(args?.data_type || '').toLowerCase();
      if (MONEY_TOOLS.has(toolName) || (toolName === 'get_crm_data' && MONEY_CRM_TYPES.has(crmType))) {
        this.moneyGrounded = true;
        this.moneyCorpus += ` ${text}`;
        for (const n of collectMoneyAmounts(result)) this.moneyAmounts.push(n);
        for (const n of collectMoneyAggregates(result)) this.moneyAggregates.push(n);
      }
      if (SCHEDULE_TOOLS.has(toolName) || (toolName === 'get_crm_data' && SCHEDULE_CRM_TYPES.has(crmType))) {
        this.scheduleGrounded = true;
        for (const value of collectStrings(result, [])) {
          for (const minutes of timeValuesIn(value)) this.scheduleTimes.push(minutes);
        }
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * Response audit
 * ------------------------------------------------------------------ */

const MONEY_QUESTION_RE = /\b(how much|revenue|income|profit|gross|earned|earnings|made this|collected|collections|brought in|take home|top line|sales total|total sales|paid us|money)\b/i;
const CURRENCY_RE = /\$\s?\d[\d,]*(?:\.\d{1,2})?/g;
const MONEY_REFUSAL_RE = /\b(couldn'?t|could not|can'?t|cannot|unable|failed|don'?t have|do not have|no verified|access.?restricted|need to (?:check|retry|look up)|let me (?:check|retry|look up))\b/i;
const SCHEDULE_QUESTION_RE = /\b(what time|when (?:does|do|is|are|will)|schedule|scheduled|calendar|appointment|inspection|build|install|job|starts?|begins?)\b/i;
const SCHEDULE_POSITIVE_CLAIM_RE = /\b(all set|booked|scheduled for|starts? at|begins? at|is at|are at|on (?:your|the) calendar)\b/i;
const SCHEDULE_REFUSAL_RE = /\b(couldn'?t|could not|can'?t|cannot|unable|failed|don'?t see|do not see|couldn'?t find|need (?:a|the|to)|which|what (?:date|time|job)|let me check)\b/i;

const REFUSAL_MONEY =
  "I'm not going to give you a number I can't back up. I couldn't complete a successful revenue lookup for that period just now, so I don't have a real total to report. Ask me again and I'll re-run it against your paid invoices and payments — I'll give you the total, the number of payments, and the exact date range it covers.";

const REFUSAL_MONEY_DENIED =
  "I can't report that figure. The revenue lookup came back access-restricted for your role, so I have no verified total to give you — and I won't estimate one. An owner or admin can pull the company-wide numbers.";

const REFUSAL_NAME =
  "I caught myself about to use a name that isn't in your CRM, so I've stopped. I can only report people and jobs that a lookup actually returned. Tell me the date or the customer you want and I'll pull the real records.";

const REFUSAL_SCHEDULE =
  "I can't verify that schedule detail from the CRM result I have, so I won't guess. Tell me the customer or date again and I'll re-check the live Build Schedule and calendar.";

// Lexi saying she cannot find someone is the correct behaviour, not a fabrication.
const NAME_DISCLAIMER_RE =
  /\b(don'?t see|do not see|couldn'?t find|could not find|no (record|records|match|matches|customer|contact|one|results?)\b|isn'?t in (your|the) crm|not in (your|the) crm|no results?)\b/i;

// Markers the chat runtimes use when the user attaches something. Text and PDF
// attachments arrive inline, so their figures are matched like any other user-
// supplied number. An IMAGE's figures are only visible to the model, so those
// turns are exempt from value binding — a known, deliberate gap.
const IMAGE_ATTACHMENT_RE = /\[attached image|attached image:|\.(png|jpe?g|heic|webp)\b/i;

function timeValuesIn(text) {
  const source = String(text || '');
  const values = [];
  const iso = source.matchAll(/T([01]\d|2[0-3]):([0-5]\d)/g);
  for (const match of iso) values.push(Number(match[1]) * 60 + Number(match[2]));
  const spoken = source.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?(?::[0-5]\d)?\s*(a\.?m\.?|p\.?m\.?)\b/gi);
  for (const match of spoken) {
    let hour = Number(match[1]) % 12;
    if (/p/i.test(match[3])) hour += 12;
    values.push(hour * 60 + Number(match[2] || 0));
  }
  if (/\bnoon\b/i.test(source)) values.push(12 * 60);
  if (/\bmidnight\b/i.test(source)) values.push(0);
  return values;
}

/**
 * Does the reply contain a placeholder name that no tool (and no injected
 * customer list) actually produced?
 */
function findUngroundedPlaceholderName(text, ledger) {
  const haystack = String(text || '').toLowerCase();
  const corpus = ledger?.nameCorpus || '';
  // The user naming someone is itself a source — Lexi echoing that name back,
  // including to say she can't find them, is not a fabrication.
  const asked = String(ledger?.userMessage || '').toLowerCase();
  // Sentence-scoped, so "I don't see John Doe" earlier in the reply cannot
  // license a fabricated "Mary Smith at 10am" later in the same reply.
  const sentences = haystack.split(/(?<=[.!?\n])\s+/);
  for (const name of PLACEHOLDER_NAMES) {
    if (!haystack.includes(name)) continue;
    if (corpus.includes(name) || asked.includes(name)) continue;
    const claims = sentences.filter((s) => s.includes(name) && !NAME_DISCLAIMER_RE.test(s));
    if (claims.length > 0) return name;
  }
  return null;
}

/**
 * Does this dollar figure trace back to a real amount?
 *
 * Only three things count: a value a money read returned, a total of one of
 * that read's own lists, or a currency figure the user typed. A figure that is
 * merely *plausible* — smaller than the pile, or equal to some unrelated count
 * or id in the payload — is a fabrication.
 */
function moneyFigureIsGrounded(figure, ledger) {
  const amount = Number(String(figure).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(amount)) return true;
  if (amount === 0) return true; // "$0.00" is a report of absence, not a claim
  const candidates = [
    ...(ledger.moneyAmounts || []),
    ...(ledger.moneyAggregates || []),
    ...currencyFiguresIn(ledger.userMessage || ''),
  ];
  return candidates.some((v) => Math.abs(v - amount) < 0.01 || Math.round(v) === amount);
}

/**
 * Audit Lexi's final text against what the tools actually returned.
 *
 * Deliberately narrow: it only blocks the two fabrication shapes we have
 * actually seen in production, so a legitimate answer is never swallowed.
 *
 * @param {string} text
 * @param {ReturnType<createGroundingLedger>} ledger
 * @returns {{ blocked: boolean, reason?: string, detail?: string, response: string }}
 */
function auditLexiResponse(text, ledger) {
  const original = String(text || '');
  if (!original.trim() || !ledger) return { blocked: false, response: original };

  const placeholder = findUngroundedPlaceholderName(original, ledger);
  if (placeholder) {
    return {
      blocked: true,
      reason: 'ungrounded_placeholder_name',
      detail: placeholder,
      response: REFUSAL_NAME,
    };
  }

  // A dollar figure in the answer to a money question has to trace back to a
  // number a money read actually returned. This is the "$4500" failure, and it
  // is the same failure whether no tool ran, the tool failed, the tool came
  // back empty, or the tool came back with different numbers.
  //
  // Text and PDF attachments arrive inline, so their figures bind like any
  // other user-supplied number. An image's figures are visible only to the
  // model, so those turns are skipped — a deliberate, documented gap.
  const figures = original.match(CURRENCY_RE) || [];
  if (
    figures.length > 0 &&
    MONEY_QUESTION_RE.test(ledger.userMessage) &&
    !IMAGE_ATTACHMENT_RE.test(ledger.userMessage)
  ) {
    const unbacked = figures.filter((f) => !moneyFigureIsGrounded(f, ledger));
    if (unbacked.length > 0) {
      return {
        blocked: true,
        reason: 'ungrounded_money_figure',
        detail: unbacked.slice(0, 3).join(', '),
        response: ledger.accessDenied ? REFUSAL_MONEY_DENIED : REFUSAL_MONEY,
      };
    }
  }

  // Spoken voice transcripts often spell numbers out ("forty two thousand")
  // and therefore contain no "$" token. A confident money answer with no
  // successful money lookup is still a fabrication and must be rejected.
  if (
    MONEY_QUESTION_RE.test(ledger.userMessage) &&
    figures.length === 0 &&
    !IMAGE_ATTACHMENT_RE.test(ledger.userMessage) &&
    !ledger.moneyGrounded &&
    !MONEY_REFUSAL_RE.test(original)
  ) {
    return {
      blocked: true,
      reason: 'money_answer_without_lookup',
      response: ledger.accessDenied ? REFUSAL_MONEY_DENIED : REFUSAL_MONEY,
    };
  }

  if (SCHEDULE_QUESTION_RE.test(ledger.userMessage) && !SCHEDULE_REFUSAL_RE.test(original)) {
    const claimedTimes = timeValuesIn(original);
    const suppliedTimes = timeValuesIn(ledger.userMessage);
    const groundedTimes = [...(ledger.scheduleTimes || []), ...suppliedTimes];
    const ungroundedTime = claimedTimes.find((minutes) => !groundedTimes.includes(minutes));
    if (
      (!ledger.scheduleGrounded && (claimedTimes.length > 0 || SCHEDULE_POSITIVE_CLAIM_RE.test(original))) ||
      ungroundedTime !== undefined
    ) {
      return {
        blocked: true,
        reason: 'ungrounded_schedule_claim',
        response: REFUSAL_SCHEDULE,
      };
    }
  }

  return { blocked: false, response: original };
}

/* ------------------------------------------------------------------ *
 * Write verification (BEFORE / AFTER)
 * ------------------------------------------------------------------ */

function normalizeForCompare(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value).trim();
}

/**
 * Did the stored value actually take the requested value?
 * Lenient about representation (dates, numeric strings, arrays) but never
 * about substance.
 */
function valueMatches(requested, actual) {
  const a = normalizeForCompare(requested);
  const b = normalizeForCompare(actual);
  if (a === b) return true;
  if (!a && !b) return true;
  if (!a || !b) return false;

  // Date-ish: compare the calendar day / instant, not the string form.
  const da = Date.parse(a);
  const db = Date.parse(b);
  if (!Number.isNaN(da) && !Number.isNaN(db)) {
    if (da === db) return true;
    // A date-only request ("2026-09-10") matches any instant on that day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(a) && b.startsWith(a.slice(0, 10))) return true;
    if (/^\d{4}-\d{2}-\d{2}$/.test(b) && a.startsWith(b.slice(0, 10))) return true;
  }

  // Numeric equality regardless of string/number typing.
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na === nb) return true;

  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Compare what the user asked for against what the record now holds.
 *
 * @param {object} requested - the fields the model tried to write
 * @param {object|null} after - the re-read record
 * @param {object|null} before - the pre-write snapshot
 * @returns {{ verified: boolean, before: object, after: object, mismatches: Array }}
 */
function diffRequestedVsStored(requested, after, before) {
  const fields = Object.keys(requested || {});
  const beforeView = {};
  const afterView = {};
  const mismatches = [];

  if (!after) {
    return {
      verified: false,
      before: before || {},
      after: {},
      mismatches: [{ field: '*', requested: 'record present after write', stored: 'record not found on re-read' }],
    };
  }

  for (const field of fields) {
    if (before && Object.prototype.hasOwnProperty.call(before, field)) beforeView[field] = before[field];
    afterView[field] = after[field];
    if (!valueMatches(requested[field], after[field])) {
      mismatches.push({ field, requested: requested[field], stored: after[field] ?? null });
    }
  }

  return { verified: mismatches.length === 0, before: beforeView, after: afterView, mismatches };
}

/**
 * Turn a verification diff into the tool result the model sees.
 * A failed verification is reported as success:false so the model cannot
 * truthfully say "done".
 *
 * @param {object} opts
 * @param {string} opts.label      - human label, e.g. "CalendarEvent #42"
 * @param {object} opts.requested  - fields the write asked for
 * @param {object|null} opts.after
 * @param {object|null} opts.before
 * @returns {object}
 */
function buildWriteVerificationResult({ label, requested, after, before }) {
  const diff = diffRequestedVsStored(requested, after, before);
  if (diff.verified) {
    return {
      success: true,
      verified: true,
      message: `${label} updated and re-read from the database.`,
      before: diff.before,
      after: diff.after,
      report_instruction: 'Tell the user the BEFORE value and the AFTER value from this result. Both are confirmed by a re-read.',
    };
  }
  return {
    success: false,
    verified: false,
    error: `${label} did NOT end up in the requested state.`,
    before: diff.before,
    after: diff.after,
    mismatches: diff.mismatches,
    report_instruction: 'The write did NOT take effect as requested. Tell the user it failed, state what the record still shows, and do not say it was moved, rescheduled, or updated.',
  };
}

module.exports = {
  MONEY_TOOLS,
  SCHEDULE_TOOLS,
  PLACEHOLDER_NAMES,
  groundingRulesBlock,
  annotateToolResult,
  statusOf,
  rowCountOf,
  createGroundingLedger,
  auditLexiResponse,
  findUngroundedPlaceholderName,
  timeValuesIn,
  valueMatches,
  diffRequestedVsStored,
  buildWriteVerificationResult,
};
