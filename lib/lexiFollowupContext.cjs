'use strict';

/**
 * Make a short financial continuation unambiguous before it reaches the model.
 * The chat UI preserves the previous turn, but phrases such as "what about for
 * the year?" contain no financial noun on their own. Without this expansion,
 * a model can respond without a tool call and the UI falls back to its generic
 * greeting.
 */
function expandFinancialFollowup(message, conversationHistory) {
  const original = typeof message === 'string' ? message.trim() : '';
  if (!original) return original;

  const periodMatch = original.match(
    /^(?:(?:what|how)\s+about(?:\s+(?:it|that))?(?:\s+for)?|(?:and\s+)?)\s*(?:the|this)?\s*(week|month|year)\s*\??$/i
  );
  if (!periodMatch) return original;

  const periodByWord = {
    week: 'this_week',
    month: 'this_month',
    year: 'this_year',
  };
  const period = periodByWord[periodMatch[1].toLowerCase()];
  const priorMessages = Array.isArray(conversationHistory) ? conversationHistory : [];
  const priorAssistantMessage = [...priorMessages]
    .reverse()
    .find((entry) => entry?.role === 'assistant' && typeof entry.content === 'string');

  if (!priorAssistantMessage || !/\b(cash|collected|payment|invoice|revenue|earned|received|money)\b/i.test(priorAssistantMessage.content)) {
    return original;
  }

  return `${original}

[This is a continuation of the immediately preceding financial question. Call get_financial_summary once with period "${period}", then answer the user with the result. Do not greet the user or ask what they need.]`;
}

module.exports = { expandFinancialFollowup };