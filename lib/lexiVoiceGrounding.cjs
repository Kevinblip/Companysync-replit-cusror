'use strict';

const {
  createGroundingLedger,
  auditLexiResponse,
  statusOf,
} = require('./lexiGrounding.cjs');

const MONEY_QUESTION_RE = /\b(how much|revenue|income|profit|gross|earned|earnings|made|collected|collections|received|brought in|take home|sales total|total sales|paid us|money|payments?)\b/i;
const SCHEDULE_QUESTION_RE = /\b(what time|when (?:does|do|is|are|will)|schedule|scheduled|calendar|appointment|inspection|build|install|job|starts?|begins?)\b/i;

function isVoiceGroundingSensitive(userMessage) {
  const text = String(userMessage || '');
  return MONEY_QUESTION_RE.test(text) || SCHEDULE_QUESTION_RE.test(text);
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function displayRange(result) {
  const start = result?.period_range?.start;
  let end = result?.period_range?.end;
  if (!end && result?.period_range?.end_exclusive) {
    const d = new Date(`${result.period_range.end_exclusive}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() - 1);
      end = d.toISOString().slice(0, 10);
    }
  }
  return start && end ? `${start} through ${end}` : String(result?.period || 'the requested period').replace(/_/g, ' ');
}

function buildFinancialResponse(results) {
  return results.map((result) => {
    const cash = result.cash_received ?? result.total_collected ?? 0;
    const invoiced = result.invoices_issued ?? result.total_invoiced ?? 0;
    const payments = Number(result.payment_count || 0);
    return `For ${displayRange(result)}, cash received was ${formatMoney(cash)} across ${payments} payment${payments === 1 ? '' : 's'}. Invoices issued totaled ${formatMoney(invoiced)}.`;
  }).join(' ');
}

/**
 * Audits one completed native-voice answer. Financial answers are always
 * replaced with deterministic wording assembled from the tool payload so the
 * model never gets a chance to round, transpose, or invent a spoken number.
 */
function auditVoiceTurn({ userMessage = '', assistantText = '', toolCalls = [] } = {}) {
  const ledger = createGroundingLedger({ userMessage });
  for (const call of toolCalls) {
    ledger.record(call?.name || '', call?.args || {}, call?.result);
  }

  if (MONEY_QUESTION_RE.test(String(userMessage))) {
    const financialResults = toolCalls
      .filter((call) => call?.name === 'get_financial_summary' && statusOf(call.result) === 'ok')
      .map((call) => call.result);
    if (financialResults.length > 0) {
      return {
        blocked: false,
        replaced: true,
        reason: 'deterministic_financial_answer',
        response: buildFinancialResponse(financialResults),
      };
    }
    return {
      blocked: true,
      replaced: true,
      reason: 'money_answer_without_verified_result',
      response: "I couldn't complete a verified financial lookup for that period, so I won't give you a number. Please ask me to retry.",
    };
  }

  if (SCHEDULE_QUESTION_RE.test(String(userMessage)) && !String(assistantText || '').trim()) {
    return {
      blocked: true,
      replaced: true,
      reason: 'schedule_answer_without_transcript',
      response: "I couldn't verify that schedule detail from the CRM, so I won't guess. Please ask me to check it again.",
    };
  }

  const audit = auditLexiResponse(assistantText, ledger);
  return { ...audit, replaced: audit.blocked };
}

module.exports = {
  MONEY_QUESTION_RE,
  SCHEDULE_QUESTION_RE,
  isVoiceGroundingSensitive,
  buildFinancialResponse,
  auditVoiceTurn,
};