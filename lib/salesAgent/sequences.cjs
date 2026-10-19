'use strict';

const { readState, update, id, setStage } = require('./salesStore.cjs');
const { renderTemplate } = require('./templates.cjs');
const { messageVars } = require('./booking.cjs');
const { sendPrepared, recordMessage } = require('./outbound.cjs');
const { agentName } = require('./prompt.cjs');

const NONBUYER = [
  ['day0_recap', 'email', 0],
  ['day2_objection', 'email', 2],
  ['day5_checkin', 'sms', 5],
  ['day9_nudge', 'email', 9],
  ['day14_breakup', 'email', 14],
];

const TRIAL = [
  ['trial_day1', 'email', 1],
  ['trial_day3', 'email', 3],
  ['trial_day7', 'email', 7],
];

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

function cancelSequences(state, leadId, reason, sequences) {
  for (const step of state.steps) {
    if (step.leadId !== leadId || step.status !== 'pending') continue;
    if (sequences && !sequences.includes(step.sequence)) continue;
    step.status = 'cancelled';
    step.cancelReason = reason;
  }
}

function enqueue(state, lead, sequence, rows, anchor) {
  for (const [kind, channel, day] of rows) {
    state.steps.push({
      id: id('step'),
      leadId: lead.id,
      sequence,
      kind,
      channel,
      dueAt: addDays(anchor, day).toISOString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
  }
}

async function enqueueNonBuyer(leadId, anchor = new Date()) {
  return update((state) => {
    const lead = state.leads.find((row) => row.id === leadId);
    if (!lead || lead.optedOut) return { ok: false };
    cancelSequences(state, leadId, 'replaced', ['nonbuyer']);
    enqueue(state, lead, 'nonbuyer', NONBUYER, anchor);
    return { ok: true };
  });
}

async function enqueueTrial(leadId, anchor = new Date()) {
  return update((state) => {
    const lead = state.leads.find((row) => row.id === leadId);
    if (!lead || lead.optedOut) return { ok: false };
    cancelSequences(state, leadId, 'trial', ['nonbuyer']);
    cancelSequences(state, leadId, 'replaced', ['trial']);
    enqueue(state, lead, 'trial', TRIAL, anchor);
    lead.trialLinkSentAt = new Date().toISOString();
    return { ok: true };
  });
}

async function stopLead(leadId, reason) {
  return update((state) => {
    const lead = state.leads.find((row) => row.id === leadId);
    if (lead && reason === 'stop') lead.optedOut = true;
    cancelSequences(state, leadId, reason);
    if (lead && reason === 'lost') setStage(state, lead, 'Lost', reason);
    if (lead && reason === 'subscribed') setStage(state, lead, 'Subscribed', reason);
    return { ok: true };
  });
}

function varsFor(lead, extra = {}) {
  const booking = readState().bookings.filter((row) => row.leadId === lead.id).slice(-1)[0];
  const appBase = extra.appBase;
  const vars = { ...extra };
  delete vars.appBase;
  return messageVars(lead, booking, { vars, appBase });
}

function renderStep(step, lead) {
  const rendered = renderTemplate(step.kind, varsFor(lead, { objection: lead.objection || '' }));
  return {
    id: step.id,
    kind: step.kind,
    sequence: step.sequence,
    channel: step.channel,
    dueAt: step.dueAt,
    subject: rendered.subject || (rendered.email && rendered.email.subject) || '',
    email: rendered.email || (rendered.subject ? rendered : null),
    sms: rendered.sms || null,
  };
}

function simulate({ leadId, now = new Date(), days = 14 } = {}) {
  const state = readState();
  const lead = leadId
    ? state.leads.find((row) => row.id === leadId)
    : state.leads.slice(-1)[0];
  const horizon = addDays(now, days).getTime();
  const pending = lead
    ? state.steps.filter((step) => step.leadId === lead.id && step.status === 'pending' && new Date(step.dueAt).getTime() <= horizon)
    : [];
  const sample = lead || {
    id: 'sample',
    firstName: 'Alex',
    lastName: 'Rivera',
    email: 'prospect@example.com',
    phone: '+15555550100',
    company: 'Sample Roofing',
    trade: 'storm',
    objection: 'price',
    stage: 'Demo Held',
  };
  const anchor = new Date(now);
  const previewRows = []
    .concat(NONBUYER.map(([kind, channel, day]) => ({ kind, channel, sequence: 'nonbuyer', dueAt: addDays(anchor, day).toISOString(), id: `preview_${kind}` })))
    .concat(TRIAL.map(([kind, channel, day]) => ({ kind, channel, sequence: 'trial', dueAt: addDays(anchor, day).toISOString(), id: `preview_${kind}` })));
  const source = pending.length ? pending : previewRows;
  return {
    leadId: lead ? lead.id : null,
    sample: !lead,
    note: 'Preview only. Nothing is sent. On staging every real send is suppressed.',
    messages: source.map((step) => renderStep(step, lead || sample)),
  };
}

async function runDue(now = new Date()) {
  const due = readState().steps.filter((step) => step.status === 'pending' && new Date(step.dueAt) <= now);
  const sent = [];
  for (const step of due) {
    const state = readState();
    const lead = state.leads.find((row) => row.id === step.leadId);
    const booking = state.bookings.find((row) => row.id === step.bookingId);
    if (!lead || lead.optedOut) {
      await update((draft) => {
        const row = draft.steps.find((item) => item.id === step.id);
        if (row) row.status = 'cancelled';
      });
      continue;
    }
    if (step.kind === 'no_show' && booking && booking.joinedAt) {
      await update((draft) => {
        const row = draft.steps.find((item) => item.id === step.id);
        if (row) row.status = 'cancelled';
      });
      continue;
    }
    if (step.kind === 'no_show') {
      await update((draft) => {
        const rowBooking = draft.bookings.find((item) => item.id === step.bookingId);
        if (rowBooking) rowBooking.status = 'no_show';
        const rowLead = draft.leads.find((item) => item.id === step.leadId);
        setStage(draft, rowLead, 'No-Show', 'no_show');
      });
    }
    if (step.kind === 'day5_checkin') {
      await update((draft) => {
        draft.notifications.push({
          id: id('note'),
          at: new Date().toISOString(),
          title: `Day 5 check-in task for ${lead.firstName || 'lead'}`,
          body: 'Day 5 stays a task for Kevin. The toll-free line is customer care only, so this follow-up is not texted.',
          leadId: lead.id,
          kind: 'day5_task',
        });
      });
    }
    const rendered = renderStep(step, lead);
    if (rendered.email && (step.channel === 'email' || step.channel === 'both')) {
      sent.push(await sendPrepared({
        lead,
        bookingId: step.bookingId,
        kind: step.kind,
        channel: 'email',
        to: lead.email,
        subject: rendered.email.subject,
        text: rendered.email.text,
        html: rendered.email.html,
      }));
    }
    if (rendered.sms && (step.channel === 'sms' || step.channel === 'both')) {
      sent.push(await sendPrepared({
        lead,
        bookingId: step.bookingId,
        kind: step.kind,
        channel: 'sms',
        to: lead.phone,
        text: rendered.sms,
      }));
    }
    await update((draft) => {
      const row = draft.steps.find((item) => item.id === step.id);
      if (row && row.status === 'pending') row.status = 'sent';
    });
  }
  return { sent: sent.length, messages: sent };
}

async function notifyInApp(entry) {
  return update((state) => {
    const row = { id: id('note'), at: new Date().toISOString(), ...entry };
    state.notifications.push(row);
    return row;
  });
}

module.exports = {
  NONBUYER,
  TRIAL,
  enqueueNonBuyer,
  enqueueTrial,
  stopLead,
  cancelSequences,
  simulate,
  runDue,
  notifyInApp,
  recordMessage,
  agentName,
};
