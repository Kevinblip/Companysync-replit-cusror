'use strict';

const { readState, update } = require('./salesStore.cjs');
const { stopLead } = require('./sequences.cjs');
const { buildSalesSystemPrompt, agentName } = require('./prompt.cjs');
const { foreignDollarAmounts } = require('./pricing.cjs');
const { last10, keywordKind, STOP_REPLY, HELP_REPLY, phoneAllowed } = require('./phonePolicy.cjs');
const { recordMessage } = require('./outbound.cjs');

function optOutLine(text) {
  const body = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (/reply stop to opt out/i.test(body)) return body;
  return `${body} Reply STOP to opt out.`.slice(0, 320);
}

function leadsForPhone(from) {
  const needle = last10(from);
  if (!needle) return [];
  return readState().leads.filter((lead) => last10(lead.phone) === needle);
}

function fallbackReply(from) {
  const lead = leadsForPhone(from)[0];
  const booking = lead && readState().bookings.filter((row) => row.leadId === lead.id && row.status === 'booked').slice(-1)[0];
  const name = agentName();
  if (booking) {
    const when = new Date(booking.start).toLocaleString('en-US', { timeZone: booking.timezone || 'America/New_York' });
    return optOutLine(`Hi, this is ${name}, an AI assistant at CompanySync. Your demo is on the books for ${when}. Reply here if you need to move it.`);
  }
  return optOutLine(`Hi, this is ${name}, an AI assistant at CompanySync. I can confirm a booked demo or point you to the 14-day trial at getcompanysync.com. What do you need?`);
}

async function modelReply(from, body) {
  if (process.env.SALES_AGENT_SKIP_SMS_BRAIN === '1') return fallbackReply(from);
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY || '';
  if (!apiKey) return fallbackReply(from);
  const lead = leadsForPhone(from)[0];
  const booking = lead && readState().bookings.filter((row) => row.leadId === lead.id).slice(-1)[0];
  const context = {
    name: lead ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : '',
    company: lead ? lead.company || '' : '',
    stage: lead ? lead.stage || '' : '',
    demo: booking ? { start: booking.start, status: booking.status, timezone: booking.timezone } : null,
  };
  const system = `${buildSalesSystemPrompt({ channel: 'phone' })}

You are replying to one inbound text message. Answer in a single SMS under 300 characters. This toll-free line is customer care only: confirm a booked demo, answer a product question, or point them at the trial page. Do not start a marketing sequence. Do not call tools.`;
  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{
            role: 'user',
            parts: [{ text: `Lead on file: ${JSON.stringify(context)}\nTheir text:\n${String(body || '').slice(0, 1000)}` }],
          }],
        }),
      },
    );
    const payload = await resp.json();
    const text = payload && payload.candidates && payload.candidates[0]
      && payload.candidates[0].content && payload.candidates[0].content.parts
      && payload.candidates[0].content.parts.map((part) => part.text || '').join(' ').trim();
    if (!text || foreignDollarAmounts(text).length) return fallbackReply(from);
    return optOutLine(text);
  } catch (err) {
    console.error('[sales-phone] text reply failed:', err.message);
    return fallbackReply(from);
  }
}

async function replyToText({ from, body }) {
  const kind = keywordKind(body);
  const leads = leadsForPhone(from);
  if (kind === 'stop') {
    for (const lead of leads) await stopLead(lead.id, 'stop');
    if (!leads.length) {
      await update((state) => {
        state.leads.push({
          id: `lead_sms_${last10(from) || Date.now()}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          stage: 'New',
          optedOut: true,
          firstName: '',
          lastName: '',
          email: '',
          phone: from,
          company: '',
          trade: '',
        });
      });
    }
    return { kind: 'stop', reply: STOP_REPLY, send: phoneAllowed(from) };
  }
  if (kind === 'help') return { kind: 'help', reply: HELP_REPLY, send: phoneAllowed(from) };
  if (!phoneAllowed(from)) return { kind: 'blocked', reply: '', send: false };
  const reply = await modelReply(from, body);
  return { kind: 'sms_reply', reply, send: true };
}

async function storeText({ leadId, direction, from, to, body, kind, suppressed, skipped, reason }) {
  return recordMessage({
    leadId: leadId || null,
    kind: kind || (direction === 'inbound' ? 'sms_inbound' : 'sms_reply'),
    channel: 'sms',
    direction,
    to,
    from,
    body,
    suppressed: !!suppressed,
    skipped: !!skipped,
    reason: reason || '',
  });
}

module.exports = {
  optOutLine,
  fallbackReply,
  replyToText,
  storeText,
  leadsForPhone,
};
