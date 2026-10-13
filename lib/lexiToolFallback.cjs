function buildLexiToolFallback(toolName, result) {
  if (!result || typeof result !== 'object') return null;

  if (toolName === 'find_subcontractors') {
    const area = result.filter?.area ? ` in ${result.filter.area}` : '';
    const subs = Array.isArray(result.subcontractors) ? result.subcontractors : [];
    if (subs.length === 0) {
      return `I couldn't find any subcontractors listed${area}.`;
    }

    const listed = subs.slice(0, 5).map((sub) => {
      const details = [sub.specialty, sub.base_address || sub.city || sub.state]
        .filter(Boolean)
        .join(' — ');
      return details ? `${sub.name} (${details})` : sub.name;
    }).join('; ');
    const remaining = subs.length > 5 ? ` I found ${subs.length - 5} more.` : '';
    return `I found ${subs.length} subcontractor${subs.length === 1 ? '' : 's'}${area}: ${listed}.${remaining}`;
  }

  if (result.success === false || result.error) {
    return 'I couldn’t complete that request. Please try again.';
  }

  if (toolName === 'get_financial_summary' && typeof result.summary === 'string') {
    const range = result.period_range;
    let dates = '';
    if (range?.start && range?.end_exclusive) {
      const end = new Date(`${range.end_exclusive}T12:00:00Z`);
      if (Number.isFinite(end.getTime())) {
        end.setUTCDate(end.getUTCDate() - 1);
        dates = ` Date range: ${range.start} through ${end.toISOString().slice(0, 10)}.`;
      }
    }
    return result.summary + dates;
  }
  if (toolName === 'get_calendar_events' && Array.isArray(result.events)) {
    if (!result.events.length) return 'There are no calendar events in the requested date range.';
    return `I found ${result.events.length} calendar event(s):\n` + result.events.map((event) =>
      `- ${event.title || 'Untitled event'} — ${event.start}${event.end ? ` to ${event.end}` : ''}${event.location ? ` at ${event.location}` : ''}`
    ).join('\n');
  }

  return typeof result.message === 'string' && result.message.trim() ? result.message.trim() : null;
}

module.exports = { buildLexiToolFallback };