'use strict';

const { readState, update, id, setStage } = require('./salesStore.cjs');
const { listSlots, bookDemo, messageVars, appBase } = require('./booking.cjs');
const { enqueueNonBuyer, enqueueTrial, stopLead, notifyInApp, cancelSequences } = require('./sequences.cjs');
const { renderTemplate } = require('./templates.cjs');
const { sendPrepared } = require('./outbound.cjs');
const { resolveClip, agentClips } = require('./clips.cjs');
const { handoffRep, agentName } = require('./prompt.cjs');
const { geminiSynopsis } = require('./recording.cjs');

const TOOL_DECLARATIONS = [
  {
    name: 'list_slots',
    description: 'List open 15-minute demo times. Offer only times this returns.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'play_clip',
    description: 'Play a training clip on the prospect screen. Ask first. Stay silent until it ends or they speak.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        start: { type: 'number' },
        end: { type: 'number' },
      },
      required: ['id'],
    },
  },
  {
    name: 'book_demo',
    description: 'Book a 15-minute demo on a slot from list_slots that the prospect accepted.',
    parameters: {
      type: 'object',
      properties: {
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        trade: { type: 'string' },
        start_iso: { type: 'string' },
        team_size: { type: 'string' },
        current_software: { type: 'string' },
        pain: { type: 'string' },
      },
      required: ['first_name', 'email', 'start_iso'],
    },
  },
  {
    name: 'send_trial_link',
    description: 'Email and text the public trial link. Does not start a trial or take payment.',
    parameters: {
      type: 'object',
      properties: {
        first_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['email'],
    },
  },
  {
    name: 'handoff_to_rep',
    description: 'Book the human rep, send the prospect a confirmation, and send the rep the call summary.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        start_iso: { type: 'string' },
        first_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['reason', 'start_iso'],
    },
  },
  {
    name: 'log_objection',
    description: 'Record an objection: price, switching, jobnimbus, think, or other.',
    parameters: {
      type: 'object',
      properties: {
        objection: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['objection'],
    },
  },
  {
    name: 'end_call',
    description: 'End the call after goodbye. outcome is follow_up, lost, booked, or trial_link.',
    parameters: {
      type: 'object',
      properties: {
        outcome: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['outcome'],
    },
  },
];

function ensureLead(state, call, args) {
  let lead = state.leads.find((row) => row.id === call.leadId);
  if (!lead) {
    lead = {
      id: id('lead'),
      createdAt: new Date().toISOString(),
      stage: 'New',
      optedOut: false,
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      company: '',
      trade: '',
    };
    state.leads.push(lead);
    call.leadId = lead.id;
  }
  if (args.first_name) lead.firstName = args.first_name;
  if (args.last_name) lead.lastName = args.last_name;
  if (args.email) lead.email = args.email;
  if (args.phone) lead.phone = args.phone;
  if (args.company) lead.company = args.company;
  if (args.trade) lead.trade = args.trade;
  if (args.team_size) lead.teamSize = args.team_size;
  if (args.current_software) lead.currentSoftware = args.current_software;
  if (args.pain) lead.pain = args.pain;
  lead.updatedAt = new Date().toISOString();
  return lead;
}

async function handleTool(name, args, ctx) {
  const parsed = args || {};
  if (name === 'check_availability') return handleTool('list_slots', parsed, ctx);
  if (name === 'book_appointment') {
    const parts = String(parsed.name || parsed.first_name || '').trim().split(/\s+/);
    return handleTool('book_demo', {
      ...parsed,
      first_name: parsed.first_name || parts[0] || '',
      last_name: parsed.last_name || parts.slice(1).join(' '),
      start_iso: parsed.start_iso || parsed.slot_time,
      phone: parsed.phone || ctx.callerPhone || '',
    }, ctx);
  }
  if (name === 'save_lead_details') {
    const parts = String(parsed.name || '').trim().split(/\s+/);
    await update((state) => {
      const call = state.calls.find((row) => row.id === ctx.callId);
      if (!call) return;
      const lead = ensureLead(state, call, {
        first_name: parts[0] || '',
        last_name: parts.slice(1).join(' '),
        phone: parsed.phone || ctx.callerPhone || '',
        email: parsed.email,
        pain: parsed.notes || parsed.service_needed || '',
      });
      if (parsed.notes) lead.pain = parsed.notes;
    });
    return { ok: true };
  }
  if (name === 'notify_rep' || name === 'transfer_call') {
    const rep = handoffRep();
    await notifyInApp({
      title: `Phone handoff for ${parsed.caller_name || parsed.name || 'caller'}`,
      body: parsed.reason || parsed.message || 'Caller asked for the rep.',
      to: rep.name,
      kind: 'phone_handoff',
    });
    return {
      ok: true,
      rep: rep.name,
      transferred: false,
      say: `Tell them ${rep.name} will call them back. Do not dial anyone yourself.`,
    };
  }
  if (name === 'play_clip' && ctx.channel === 'phone') {
    return { ok: false, error: 'This is a phone call. Do not play video. Offer the web demo instead.' };
  }
  if (name === 'list_slots') {
    return { ok: true, slots: listSlots({ busy: ctx.busy || [] }) };
  }
  if (name === 'play_clip') {
    const clip = resolveClip(parsed.id, parsed.start, parsed.end);
    if (!clip.ok) return clip;
    await update((state) => {
      const call = state.calls.find((row) => row.id === ctx.callId);
      if (call) call.clips.push({ id: clip.id, start: clip.start, end: clip.end, at: new Date().toISOString() });
    });
    if (ctx.onPlayClip) ctx.onPlayClip(clip);
    return { ok: true, playing: clip.id, say: 'Stay silent while the clip plays. Do not talk over it.' };
  }
  if (name === 'book_demo' || name === 'handoff_to_rep') {
    const call = readState().calls.find((row) => row.id === ctx.callId);
    const result = await bookDemo({
      leadId: call && call.leadId,
      firstName: parsed.first_name,
      lastName: parsed.last_name,
      email: parsed.email,
      phone: parsed.phone,
      company: parsed.company,
      trade: parsed.trade,
      teamSize: parsed.team_size,
      currentSoftware: parsed.current_software,
      pain: parsed.pain,
      start: parsed.start_iso,
      kind: name === 'handoff_to_rep' ? 'handoff' : 'demo',
    }, { appBase: ctx.appBase, busy: ctx.busy || [] });
    if (!result.ok) return result;
    await update((state) => {
      const row = state.calls.find((item) => item.id === ctx.callId);
      if (row) row.leadId = result.lead.id;
      if (row) row.bookingId = result.booking.id;
    });
    if (name === 'handoff_to_rep') {
      await update((state) => cancelSequences(state, result.lead.id, 'handoff', ['nonbuyer', 'trial']));
      const rep = handoffRep();
      const vars = messageVars(result.lead, result.booking, {
        appBase: ctx.appBase,
        vars: {
          handoff_reason: parsed.reason || 'a closer look',
          clips_shown: (call && call.clips || []).map((clip) => clip.id).join(', '),
          objections: (call && call.objections || []).map((item) => item.objection).join(', '),
          next_step: 'Talk with the rep',
          recording_url: '',
          transcript_url: '',
        },
      });
      const internal = renderTemplate('handoff_internal', vars);
      if (rep.email) {
        await sendPrepared({
          lead: result.lead,
          bookingId: result.booking.id,
          kind: 'handoff_internal',
          channel: 'email',
          to: rep.email,
          subject: internal.subject,
          text: internal.text,
          html: internal.html,
        });
      }
      const prospect = renderTemplate('handoff_prospect', vars);
      await sendPrepared({
        lead: result.lead,
        bookingId: result.booking.id,
        kind: 'handoff_prospect',
        channel: 'email',
        to: result.lead.email,
        subject: prospect.email.subject,
        text: prospect.email.text,
        html: prospect.email.html,
      });
      await notifyInApp({
        title: `Handoff: ${result.lead.firstName || 'Lead'}`,
        body: internal.text,
        leadId: result.lead.id,
        to: rep.name,
      });
      if (!rep.email) {
        await sendPrepared({
          lead: result.lead,
          bookingId: result.booking.id,
          kind: 'handoff_internal',
          channel: 'email',
          to: '',
          subject: internal.subject,
          text: internal.text,
          html: internal.html,
        });
      }
      return { ok: true, booking: result.booking, rep: rep.name };
    }
    return { ok: true, booking: result.booking, say: 'Confirm the day and time in one sentence.' };
  }
  if (name === 'send_trial_link') {
    let leadId;
    await update((state) => {
      const call = state.calls.find((row) => row.id === ctx.callId);
      const lead = ensureLead(state, call, parsed);
      leadId = lead.id;
    });
    const lead = readState().leads.find((row) => row.id === leadId);
    const copy = renderTemplate('trial_link', messageVars(lead, null, { appBase: ctx.appBase }));
    await sendPrepared({ lead, kind: 'trial_link', channel: 'email', to: lead.email, subject: copy.email.subject, text: copy.email.text, html: copy.email.html });
    await sendPrepared({ lead, kind: 'trial_link', channel: 'sms', to: parsed.phone || lead.phone, text: copy.sms });
    await enqueueTrial(lead.id);
    return { ok: true, trialUrl: `${appBase(ctx.appBase)}/PublicPricing`, say: 'Tell them the link is on the way and you cannot start the trial for them.' };
  }
  if (name === 'log_objection') {
    await update((state) => {
      const call = state.calls.find((row) => row.id === ctx.callId);
      if (!call) return;
      call.objections.push({ objection: parsed.objection, note: parsed.note || '', at: new Date().toISOString() });
      const lead = state.leads.find((row) => row.id === call.leadId);
      if (lead) lead.objection = parsed.objection;
    });
    return { ok: true };
  }
  if (name === 'end_call') {
    const outcome = String(parsed.outcome || 'follow_up');
    const call = readState().calls.find((row) => row.id === ctx.callId);
    const synopsis = parsed.summary || await geminiSynopsis(call && call.transcript, ctx.apiKey);
    await update((state) => {
      const row = state.calls.find((item) => item.id === ctx.callId);
      if (!row) return;
      row.outcome = outcome;
      row.synopsis = synopsis;
      row.endedAt = new Date().toISOString();
      const lead = state.leads.find((item) => item.id === row.leadId);
      if (lead && outcome === 'lost') setStage(state, lead, 'Lost', 'end_call');
      if (lead && row.joinedAt && lead.stage === 'New') setStage(state, lead, 'Demo Held', 'end_call');
    });
    const freshLead = call && call.leadId ? readState().leads.find((row) => row.id === call.leadId) : null;
    if (freshLead && outcome === 'follow_up' && !freshLead.trialLinkSentAt && freshLead.stage !== 'Handoff') {
      await enqueueNonBuyer(freshLead.id);
    }
    if (call && call.leadId && outcome === 'lost') await stopLead(call.leadId, 'lost');
    if (ctx.onEnd) ctx.onEnd({ outcome, synopsis });
    return { ok: true, outcome, synopsis };
  }
  return { ok: false, error: 'Unknown tool' };
}

const PHONE_TOOL_DECLARATIONS = [
  {
    name: 'check_availability',
    description: 'List open 15-minute demo times. Offer only times this returns.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'book_appointment',
    description: 'Book a 15-minute demo on a slot from check_availability that the caller accepted.',
    parameters: {
      type: 'object',
      properties: {
        slot_time: { type: 'string' },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        company: { type: 'string' },
        trade: { type: 'string' },
      },
      required: ['slot_time', 'name'],
    },
  },
  {
    name: 'save_lead_details',
    description: 'Save the caller name, phone, email, and notes as soon as you have them.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'notify_rep',
    description: 'Leave an in-app note for the human rep. Does not send a marketing text or place a call.',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string' }, caller_name: { type: 'string' } },
      required: ['message'],
    },
  },
  {
    name: 'transfer_call',
    description: 'Hand the caller to the human rep. Collect name, callback number, and reason first. This does not dial out.',
    parameters: {
      type: 'object',
      properties: {
        caller_name: { type: 'string' },
        callback_number: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['caller_name', 'callback_number', 'reason'],
    },
  },
  {
    name: 'send_trial_link',
    description: 'Email the public trial link. Does not text a marketing follow-up and does not start a trial.',
    parameters: {
      type: 'object',
      properties: { first_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } },
      required: ['email'],
    },
  },
  {
    name: 'log_objection',
    description: 'Record a price, switching, jobnimbus, think, or other objection.',
    parameters: {
      type: 'object',
      properties: { objection: { type: 'string' }, note: { type: 'string' } },
      required: ['objection'],
    },
  },
  {
    name: 'end_call',
    description: 'End the call after a short goodbye.',
    parameters: {
      type: 'object',
      properties: { outcome: { type: 'string' }, summary: { type: 'string' } },
      required: ['outcome'],
    },
  },
];

module.exports = {
  TOOL_DECLARATIONS,
  PHONE_TOOL_DECLARATIONS,
  handleTool,
  agentClips,
  agentName,
};
