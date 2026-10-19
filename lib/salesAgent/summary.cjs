'use strict';

const { readState, update, id } = require('./salesStore.cjs');
const { renderTemplate } = require('./templates.cjs');
const { handoffRep } = require('./prompt.cjs');
const { sendPrepared } = require('./outbound.cjs');

function etParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function buildDailySummary(now = new Date()) {
  const state = readState();
  const day = etParts(now).date;
  const calls = state.calls.filter((call) => (call.startedAt || '').slice(0, 10) === day || (call.endedAt || '').slice(0, 10) === day);
  const minutes = calls.reduce((sum, call) => sum + (Number(call.durationSec) || 0), 0) / 60;
  const objections = {};
  for (const call of state.calls) {
    for (const item of call.objections || []) {
      objections[item.objection] = (objections[item.objection] || 0) + 1;
    }
  }
  const top = Object.entries(objections).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => `${name} (${count})`).join(', ');
  const moves = state.pipelineEvents.filter((event) => (event.at || '').slice(0, 10) === day).map((event) => `${event.from}→${event.to}`).join(', ');
  const review = calls.filter((call) => call.outcome === 'handoff' || call.outcome === 'lost').map((call) => call.id).join(', ');
  const replies = (state.notifications || []).filter((note) =>
    (note.kind === 'inbound_reply' || note.kind === 'inbound_reply_unmatched')
    && String(note.at || '').slice(0, 10) === day
  );
  const replyFlags = replies.map((note) => note.title).filter(Boolean).join('; ');
  return renderTemplate('daily_summary', {
    date: day,
    calls: String(calls.length),
    minutes: String(Math.round(minutes)),
    demos: String(state.leads.filter((lead) => lead.stage === 'Demo Held').length),
    no_shows: String(state.bookings.filter((booking) => booking.status === 'no_show').length),
    trials: String(state.leads.filter((lead) => lead.trialLinkSentAt).length),
    subs: String(state.leads.filter((lead) => lead.stage === 'Subscribed').length),
    handoffs: String(state.leads.filter((lead) => lead.stage === 'Handoff').length),
    top_objections: top || 'none',
    stage_moves: moves || 'none',
    review_links: review || 'none',
    reply_flags: replyFlags || 'none',
    unsubscribe_url: '',
  });
}

async function maybeSendDailySummary(now = new Date()) {
  const parts = etParts(now);
  if (parts.hour !== 7) return { sent: false, reason: 'not_7am_et' };
  const already = readState().dailySummaries.find((row) => row.date === parts.date);
  if (already) return { sent: false, reason: 'already_sent' };
  const summary = buildDailySummary(now);
  const rep = handoffRep();
  let message = null;
  if (rep.email) {
    message = await sendPrepared({
      lead: null,
      kind: 'daily_summary',
      channel: 'email',
      to: rep.email,
      subject: summary.subject,
      text: summary.text,
      html: summary.html,
    });
  }
  await update((state) => {
    state.dailySummaries.push({
      id: id('day'),
      date: parts.date,
      at: new Date().toISOString(),
      subject: summary.subject,
      body: summary.text,
      suppressed: !message || !!message.suppressed,
    });
  });
  return { sent: true, summary, message };
}

module.exports = { buildDailySummary, maybeSendDailySummary, etParts };
