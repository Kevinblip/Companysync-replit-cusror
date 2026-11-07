'use strict';

const { readJson } = require('./paths.cjs');
const { update, readState, id, setStage } = require('./salesStore.cjs');
const { rescheduleToken } = require('./tokens.cjs');
const { buildDemoIcs } = require('./ics.cjs');
const { previewClipForTrade } = require('./clips.cjs');
const { renderTemplate } = require('./templates.cjs');
const { agentName, handoffRep } = require('./prompt.cjs');
const { sendPrepared } = require('./outbound.cjs');
const { unsubscribeUrl } = require('../emailUnsubscribe.cjs');

const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function hoursConfig() {
  return readJson('config/salesHours.json');
}

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });
  const parts = {};
  for (const part of fmt.formatToParts(date)) parts[part.type] = part.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY[parts.weekday] ?? 0,
  };
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const parts = zonedParts(guess, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}

function overlaps(start, end, busy) {
  return busy.some((item) => start < new Date(item.end) && end > new Date(item.start));
}

function listSlots({ from = new Date(), days, busy = [] } = {}) {
  const hours = hoursConfig();
  const horizon = days || hours.horizonDays || 10;
  const slots = [];
  const cursor = new Date(from);
  cursor.setUTCMinutes(0, 0, 0);
  const end = new Date(from.getTime() + horizon * 24 * 60 * 60 * 1000);
  const storedBusy = readState().bookings
    .filter((booking) => booking.status === 'booked')
    .map((booking) => ({ start: booking.start, end: booking.end }));
  const blocked = busy.concat(storedBusy);
  for (let t = cursor.getTime(); t < end.getTime(); t += 30 * 60 * 1000) {
    const probe = new Date(t);
    const parts = zonedParts(probe, hours.timezone);
    if (!hours.weekdays.includes(parts.weekday)) continue;
    if (parts.minute !== 0 && parts.minute !== 30) continue;
    if (parts.hour < hours.startHour || parts.hour >= hours.endHour) continue;
    const start = zonedTimeToUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, hours.timezone);
    if (start.getTime() < from.getTime() + 30 * 60 * 1000) continue;
    const slotEnd = new Date(start.getTime() + hours.demoMinutes * 60 * 1000);
    if (overlaps(start, slotEnd, blocked)) continue;
    slots.push({
      start: start.toISOString(),
      end: slotEnd.toISOString(),
      timezone: hours.timezone,
      label: start.toLocaleString('en-US', {
        timeZone: hours.timezone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    });
    if (slots.length >= 16) break;
  }
  return slots;
}

function formatLocal(iso, timeZone) {
  return new Date(iso).toLocaleString('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function appBase(explicit) {
  const configured = explicit || process.env.SALES_AGENT_PUBLIC_URL || process.env.APP_URL || 'https://getcompanysync.com';
  return String(configured).replace(/\/+$/, '');
}

function messageVars(lead, booking, extra = {}) {
  const hours = hoursConfig();
  const zone = (booking && booking.timezone) || hours.timezone;
  const base = appBase(extra.appBase);
  const clip = extra.clip || previewClipForTrade(lead && lead.trade);
  const token = booking ? rescheduleToken({ bookingId: booking.id, leadId: lead.id }) : '';
  return {
    first_name: lead.firstName || 'there',
    last_name: lead.lastName || '',
    company: lead.company || '',
    trade: lead.trade || 'your work',
    phone: lead.phone || '',
    email: lead.email || '',
    team_size: lead.teamSize || '',
    current_software: lead.currentSoftware || '',
    pain: lead.pain || '',
    rep_name: handoffRep().name,
    agent_name: agentName(),
    demo_time_local: booking ? formatLocal(booking.start, zone) : '',
    tz: zone,
    reschedule_url: token ? `${base}/SalesDemo/reschedule?t=${encodeURIComponent(token)}` : `${base}/SalesDemo`,
    join_url: booking ? `${base}/SalesDemo?booking=${encodeURIComponent(booking.id)}` : `${base}/SalesDemo`,
    trial_url: `${base}/PublicPricing`,
    pricing_url: `${base}/PublicPricing`,
    book_url: `${base}/SalesDemo`,
    clip_url: clip ? clip.url : '',
    clip_title: clip ? clip.title : '',
    unsubscribe_url: lead.email ? unsubscribeUrl(base, lead.email) : '',
    ...extra.vars,
  };
}

function queueStep(state, step) {
  state.steps.push({
    id: id('step'),
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...step,
  });
}

function queueReminders(state, lead, booking) {
  const start = new Date(booking.start).getTime();
  const now = Date.now();
  const plan = [
    ['reminder_24h', start - 24 * 60 * 60 * 1000],
    ['reminder_1h', start - 60 * 60 * 1000],
    ['no_show', start + 10 * 60 * 1000],
  ];
  for (const [kind, due] of plan) {
    if (due <= now) continue;
    queueStep(state, {
      leadId: lead.id,
      bookingId: booking.id,
      sequence: 'reminder',
      kind,
      channel: 'both',
      dueAt: new Date(due).toISOString(),
    });
  }
}

async function bookDemo(input, options = {}) {
  const slots = listSlots({ from: new Date(), busy: options.busy || [], days: options.days });
  const startIso = new Date(input.start).toISOString();
  const match = slots.find((slot) => Math.abs(new Date(slot.start) - new Date(startIso)) < 60 * 1000);
  if (!match) {
    return { ok: false, error: 'That time is not open. Offer one of the returned slots.', slots };
  }
  const clip = previewClipForTrade(input.trade);
  let saved;
  await update((state) => {
    let lead = input.leadId ? state.leads.find((row) => row.id === input.leadId) : null;
    if (!lead && input.email) {
      lead = state.leads.find((row) => row.email && row.email.toLowerCase() === String(input.email).toLowerCase());
    }
    if (!lead) {
      lead = {
        id: id('lead'),
        createdAt: new Date().toISOString(),
        stage: 'New',
        optedOut: false,
      };
      state.leads.push(lead);
    }
    lead.firstName = input.firstName || lead.firstName || '';
    lead.lastName = input.lastName || lead.lastName || '';
    lead.email = input.email || lead.email || '';
    lead.phone = input.phone || lead.phone || '';
    lead.company = input.company || lead.company || '';
    lead.trade = input.trade || lead.trade || '';
    lead.teamSize = input.teamSize || lead.teamSize || '';
    lead.currentSoftware = input.currentSoftware || lead.currentSoftware || '';
    lead.pain = input.pain || lead.pain || '';
    lead.updatedAt = new Date().toISOString();
    const booking = {
      id: id('book'),
      leadId: lead.id,
      start: match.start,
      end: match.end,
      timezone: match.timezone,
      status: 'booked',
      kind: input.kind || 'demo',
      clipId: clip && clip.id,
      joinedAt: null,
      createdAt: new Date().toISOString(),
    };
    state.bookings.push(booking);
    setStage(state, lead, input.kind === 'handoff' ? 'Handoff' : 'Demo Booked', input.kind || 'book_demo');
    queueReminders(state, lead, booking);
    saved = { lead: { ...lead }, booking: { ...booking } };
  });
  const vars = messageVars(saved.lead, saved.booking, { clip, appBase: options.appBase });
  const copy = renderTemplate('booking_confirmation', vars);
  const ics = buildDemoIcs({
    uid: `${saved.booking.id}@companysync`,
    start: saved.booking.start,
    end: saved.booking.end,
    summary: 'CompanySync demo',
    description: `Reschedule: ${vars.reschedule_url}`,
    organizerEmail: 'noreply@companysync.io',
    attendeeEmail: saved.lead.email,
    url: vars.join_url,
  });
  const emailResult = await sendPrepared({
    lead: saved.lead,
    bookingId: saved.booking.id,
    kind: 'booking_confirmation',
    channel: 'email',
    to: saved.lead.email,
    subject: copy.email.subject,
    text: copy.email.text,
    html: copy.email.html,
    attachments: [{
      Name: 'demo.ics',
      Content: Buffer.from(ics).toString('base64'),
      ContentType: 'text/calendar; method=REQUEST',
      filename: 'demo.ics',
      content: ics,
    }],
  });
  const smsResult = await sendPrepared({
    lead: saved.lead,
    bookingId: saved.booking.id,
    kind: 'booking_confirmation',
    channel: 'sms',
    to: saved.lead.phone,
    text: copy.sms,
  });
  return { ok: true, lead: saved.lead, booking: saved.booking, email: emailResult, sms: smsResult, slots };
}

async function rescheduleBooking({ bookingId, start, appBase }) {
  const existing = readState().bookings.find((row) => row.id === bookingId);
  if (!existing) return { ok: false, error: 'Booking not found.' };
  await update((state) => {
    const booking = state.bookings.find((row) => row.id === bookingId);
    if (booking) booking.status = 'rescheduled';
    for (const step of state.steps) {
      if (step.bookingId === bookingId && step.status === 'pending') step.status = 'cancelled';
    }
  });
  const lead = readState().leads.find((row) => row.id === existing.leadId) || {};
  return bookDemo({
    leadId: existing.leadId,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    company: lead.company,
    trade: lead.trade,
    start,
    kind: existing.kind,
  }, { appBase });
}

function markJoined(bookingId) {
  return update((state) => {
    const booking = state.bookings.find((row) => row.id === bookingId);
    if (!booking) return { ok: false };
    booking.joinedAt = new Date().toISOString();
    booking.status = 'booked';
    const lead = state.leads.find((row) => row.id === booking.leadId);
    if (lead && lead.stage === 'Demo Booked') setStage(state, lead, 'Demo Held', 'joined');
    for (const step of state.steps) {
      if (step.bookingId === bookingId && step.kind === 'no_show' && step.status === 'pending') step.status = 'cancelled';
    }
    return { ok: true, bookingId };
  });
}

module.exports = {
  hoursConfig,
  zonedParts,
  listSlots,
  bookDemo,
  rescheduleBooking,
  markJoined,
  messageVars,
  appBase,
  formatLocal,
};
