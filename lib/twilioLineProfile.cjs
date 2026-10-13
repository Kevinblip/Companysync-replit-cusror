'use strict';

// A dialed-line override, never a global model setting or a tenant-wide engine.
const GEMINI_38_LINE = '12167771602';
const GEMINI_38_MODEL = 'models/gemini-3.8-live';
const SUPPLEMENT_TOOL = {
  name: 'calculate_roof_supplement',
  description: 'Calculate the signed USD roof supplement: (new_sq - old_sq) times '
    + '$324.69 per roofing square ($283.58 shingles + $41.11 felt). One square '
    + 'is 100 square feet. No waste, tax, other items, or saved-record changes.',
  parameters: {
    type: 'OBJECT',
    properties: {
      old_sq: { type: 'NUMBER', description: 'Original nonnegative roofing squares.' },
      new_sq: { type: 'NUMBER', description: 'Revised nonnegative roofing squares.' },
    },
    required: ['old_sq', 'new_sq'],
  },
};

function isGemini38Line(number) {
  const digits = String(number || '').replace(/\D/g, '');
  return (digits.length === 10 ? `1${digits}` : digits) === GEMINI_38_LINE;
}

function applyTwilioLineProfile(setup, calledNumber) {
  if (!isGemini38Line(calledNumber)) return setup;
  // Keep the proven transport, audio/VAD settings, CRM declarations and PIN
  // protections. Remove Google's unsupported built-in execution tool even if
  // a future shared setup starts adding it.
  const { code_execution, codeExecution, ...base } = setup;
  const tools = (base.tools || []).map(tool => {
    const { code_execution, codeExecution, ...safe } = tool;
    return safe;
  }).filter(tool => Object.keys(tool).length);
  const functionKey = tools.some(tool => tool.functionDeclarations)
    ? 'functionDeclarations' : 'function_declarations';
  const hasCalculator = tools.some(tool =>
    (tool.function_declarations || tool.functionDeclarations || [])
      .some(fn => fn.name === SUPPLEMENT_TOOL.name));
  if (!hasCalculator) tools.push({ [functionKey]: [SUPPLEMENT_TOOL] });
  return {
    ...base,
    model: GEMINI_38_MODEL,
    tools,
    system_instruction: {
      ...(base.system_instruction || {}),
      parts: [
        ...(base.system_instruction?.parts || []),
        { text: 'For roof supplement math, call calculate_roof_supplement with the '
          + 'original and revised roofing squares. Ask for missing inputs. Speak '
          + 'the returned formatted USD amount at the fixed shingles-and-felt rate; '
          + 'do not invent costs or claim this calculation saved or changed a record.' },
      ],
    },
  };
}

function calculateRoofSupplement(old_sq, new_sq) {
  for (const value of [old_sq, new_sq]) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
      || value > Number.MAX_SAFE_INTEGER / 1000000) {
      throw new Error('old_sq and new_sq must be finite, nonnegative roofing-square quantities.');
    }
  }
  const supplement_sq = Number((new_sq - old_sq).toFixed(6));
  const microCents = BigInt(Math.round(supplement_sq * 1000000)) * 32469n;
  const absolute = microCents < 0n ? -microCents : microCents;
  const cents = ((absolute + 500000n) / 1000000n) * (microCents < 0n ? -1n : 1n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Supplement exceeds the supported currency range.');
  }
  const supplement_amount = Number(cents) / 100;
  return {
    old_sq, new_sq, supplement_sq, currency: 'USD',
    rate_per_sq: 324.69, shingles_per_sq: 283.58, felt_per_sq: 41.11,
    supplement_amount,
    supplement_amount_formatted: new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
    }).format(supplement_amount),
  };
}

function invokeRoofSupplement(calledNumber, args) {
  if (!isGemini38Line(calledNumber)) throw new Error('Roof supplement tool is not available on this line.');
  const values = typeof args === 'string' ? JSON.parse(args) : args;
  return calculateRoofSupplement(values?.old_sq, values?.new_sq);
}

module.exports = {
  GEMINI_38_MODEL, SUPPLEMENT_TOOL, isGemini38Line,
  applyTwilioLineProfile, calculateRoofSupplement, invokeRoofSupplement,
};