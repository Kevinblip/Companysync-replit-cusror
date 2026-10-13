'use strict';

// Force the first lookup for clear read requests, never for a CRM mutation.
// Tool handlers still enforce tenant and role permissions.
function requiredReadTool(message, isAdmin) {
  const text = String(message || '');
  if (/\b(create|add|book|schedule|reschedule|move|cancel|delete|update|send|text|email|pay|record)\b/i.test(text)) return null;
  if (isAdmin && /\b(income|revenue|collected|collections|earned|earnings|money (?:came|coming|in|received)|(?:make|made|bring|brought) (?:in|this|last))\b/i.test(text)
    && /\b(how much|what|show|total|report|summary)\b/i.test(text)) return 'get_financial_summary';
  if (/\b(calendar|appointments?|inspections?)\b/i.test(text)
    && /\b(what|when|show|list|have|check)\b/i.test(text)) return 'get_calendar_events';
  return null;
}

module.exports = { requiredReadTool };