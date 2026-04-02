import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Sarah — multi-step intake + scheduling assistant
// - Persists lightweight state in Lead.notes between markers
// - Collects: name, phone, email, service, (address if onsite), preferred time
// - Proposes 3 slots (business hours, duration, buffer), confirms and books
// - Can return reply_text (for SMS TwiML) or proactively send (for email flows)

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();

    const {
      channel,              // 'sms' | 'email'
      message,              // raw user text
      companyId,
      fromPhone,
      fromEmail,
      fromName,
      return_reply = false  // if true → do NOT send; just return reply_text
    } = payload || {};

    if (!companyId || !message) {
      return Response.json({ error: 'companyId and message are required' }, { status: 400 });
    }

    const [company] = await base44.asServiceRole.entities.Company.filter({ id: companyId });
    const tz = company?.settings?.time_zone || 'America/New_York';

  // Pull website from CompanyProfile or AITrainingData
  let websiteUrl = null;
  try {
    const [profile] = await base44.asServiceRole.entities.CompanyProfile.filter({ company_id: companyId });
    websiteUrl = profile?.website || profile?.company_website || profile?.company_website_url || profile?.website_url || null;
  } catch (_) {}
  if (!websiteUrl) {
    try {
      const training = await base44.asServiceRole.entities.AITrainingData.filter({ company_id: companyId, is_active: true });
      const blob = training.map(t => t.content || '').join(' ');
      const m = blob.match(/https?:\/\/[^\s)]+/i) || blob.match(/\b[a-z0-9.-]+\.[a-z]{2,}\b/i);
      websiteUrl = m ? (m[0].startsWith('http') ? m[0] : `https://${m[0]}`) : null;
    } catch (_) {}
  }
  if (!websiteUrl && (company?.company_name || '').toLowerCase().includes('yicn')) {
    websiteUrl = 'https://yicnroofing.com';
  }

  // Persist website to AITrainingData once (adds to "memory")
  try {
    if (websiteUrl) {
      const existingSite = await base44.asServiceRole.entities.AITrainingData.filter({ company_id: companyId, is_active: true });
      const hasSite = existingSite.some(r => (r.content || '').toLowerCase().includes('website') || (r.content || '').toLowerCase().includes('http'));
      if (!hasSite) {
        await base44.asServiceRole.entities.AITrainingData.create({
          company_id: companyId,
          content: `Official website: ${websiteUrl}`,
          is_active: true,
        });
      }
    }
  } catch (_) { /* non-blocking */ }

    // Defaults (could be later moved to Company.SarahConfig)
    const config = {
      durationMin: 60,
      bufferMin: 15,
      businessHours: { start: 9, end: 17 },
      daysLookahead: 7,
      requireAddressForAppt: true,
    };

    // Load Sarah assistant settings and override scheduling defaults if present
    let assistantSettings = null;
    try {
      const settingsRows = await base44.asServiceRole.entities.AssistantSettings.filter({ company_id: companyId, assistant_name: 'sarah' });
      assistantSettings = settingsRows[0] || null;
    } catch (_) {}

    if (assistantSettings?.scheduling_defaults) {
      const s = assistantSettings.scheduling_defaults;
      config.durationMin = typeof s.duration_min === 'number' ? s.duration_min : config.durationMin;
      config.bufferMin = typeof s.buffer_min === 'number' ? s.buffer_min : config.bufferMin;
      if (typeof s.business_hours_start === 'number') config.businessHours.start = s.business_hours_start;
      if (typeof s.business_hours_end === 'number') config.businessHours.end = s.business_hours_end;
      if (typeof s.days_lookahead === 'number') config.daysLookahead = s.days_lookahead;
    }

    // Helper: normalize phone
    const normalize = (v) => (v || '').toString().replace(/\D/g, '');
    const normPhone10 = (v) => normalize(v).slice(-10);
    const e164 = (v) => {
      const d = normalize(v);
      if (!d) return '';
      return d.startsWith('1') ? `+${d}` : `+1${d}`;
    };

    // 1) Get or create lead + load state
    const { lead, state } = await getOrCreateLeadWithState(base44, companyId, {
      email: (fromEmail || '').toLowerCase(),
      phone10: normPhone10(fromPhone),
      fallbackName: fromName || 'New Lead'
    });

    // 2) Extract fields from message via LLM (weak parse) to reduce prompting
    const extracted = await weakExtract(base44, company?.company_name, channel, message, fromName, fromEmail, fromPhone, assistantSettings?.system_prompt);

    // Merge into state if missing
    const nextState = { ...state };
    nextState.name = nextState.name || extracted.name || fromName || lead.name || undefined;
    nextState.email = nextState.email || extracted.email || fromEmail || lead.email || undefined;
    nextState.phone = nextState.phone || extracted.phone || fromPhone || lead.phone || undefined;
    nextState.service = nextState.service || extracted.service_needed || undefined;
    nextState.address = nextState.address || extracted.address || undefined;
    nextState.intent = (extracted.intent || state.intent || '').toLowerCase();

    // If user explicitly asked for appointment
    const wantsAppt = /appointment|schedule|book|meet|tomorrow|today|next|am|pm|\d{1,2}:\d{2}/i.test(message) || extracted.schedule_requested === true;

  // Quick FAQ: Website URL & Booking Link
  const msgLower = (message || '').toLowerCase();

  // Check for Booking/Calendar Link request
  if (/(?:booking|calendar|schedule|appointment|time)\s?(?:link|url|page)/i.test(msgLower) || 
      (/(?:send|get|have).*(?:link|url)/i.test(msgLower) && /(?:booking|calendar|schedule|appointment)/i.test(msgLower))) {
      
      const bookingUrl = assistantSettings?.calendly_booking_url;
      if (bookingUrl) {
           return Response.json({ success: true, lead_id: lead.id, reply_text: `Here is the link to book an appointment: ${bookingUrl}` });
      }
  }

  // Check for Website request (catch-all for "link" if not calendar related)
  if (/(?:web\s?site|website|site|url|web address|link)/i.test(msgLower)) {
    const siteText = websiteUrl ? `Our website is ${websiteUrl}` : `Our website info isn't on file yet—I'll send you the link shortly.`;
    return Response.json({ success: true, lead_id: lead.id, reply_text: siteText });
  }

    // 3) Decide next missing field
    const required = ['name', 'phone', 'email'];
    if (wantsAppt && config.requireAddressForAppt) required.push('address');

    const missing = required.filter(k => !truthy(nextState[k]));

    // When we’re waiting for a slot confirmation
    if (nextState.awaiting === 'slot_confirmation' && Array.isArray(nextState.proposedSlots) && nextState.proposedSlots.length) {
      const choice = pickChoiceIndex(message);
      if (choice != null && nextState.proposedSlots[choice]) {
        const chosen = nextState.proposedSlots[choice];
        const booking = await createCalendarEvent(base44, companyId, tz, nextState, chosen, config);
        // Clear flow state
        nextState.awaiting = undefined;
        nextState.proposedSlots = undefined;
        await persistStateOnLead(base44, lead, nextState);

        const confirmText = `All set for ${formatHuman(chosen.start, tz)} (${config.durationMin} min). You\'ll get a confirmation.`;
        if (!return_reply && channel === 'email' && nextState.email) {
          await safeSendEmail(base44, companyId, nextState, `${company?.company_name || 'Our Team'} — Appointment confirmed`, confirmText);
        }
        return Response.json({ success: true, lead_id: lead.id, calendar_event_id: booking?.calendarEventId || null, google_event_id: booking?.googleEventId || null, reply_text: confirmText });
      }
      // If they didn’t choose 1/2/3 → gently reprompt
      const reprompt = `Please reply with 1, 2, or 3 to confirm a time: ${slotsSummary(nextState.proposedSlots, tz)}`;
      return Response.json({ success: true, lead_id: lead.id, reply_text: reprompt });
    }

    // Ask for missing fields, one at a time
    if (missing.length > 0) {
      const field = missing[0];
      const prompt = await promptForField(base44, assistantSettings, company?.company_name || null, field);
      await persistStateOnLead(base44, lead, nextState);
      return Response.json({ success: true, lead_id: lead.id, reply_text: prompt });
    }

    // We have all required details. If they want an appointment and we don’t have a chosen time yet, propose 3 slots
    if (wantsAppt) {
      const proposedSlots = await proposeSlots(base44, tz, config);
      nextState.proposedSlots = proposedSlots;
      nextState.awaiting = 'slot_confirmation';
      await persistStateOnLead(base44, lead, nextState);

      const text = `Great! Here are times: ${slotsSummary(proposedSlots, tz)} Reply 1, 2, or 3.`;
      return Response.json({ success: true, lead_id: lead.id, reply_text: text });
    }

    // Otherwise, acknowledge and ask the intent, if unclear
    const ack = await personaReply(base44, assistantSettings, company?.company_name || null, nextState.service ? `Acknowledge and say you can help with "${nextState.service}". Ask if they'd like to schedule an appointment.` : `Acknowledge and ask what service they need and if they'd like to schedule an appointment.`);
    await persistStateOnLead(base44, lead, nextState);
    return Response.json({ success: true, lead_id: lead.id, reply_text: ack });

  } catch (error) {
    console.error('❌ sarahLeadIntake (enhanced) error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
});

function truthy(v) { return v !== undefined && v !== null && String(v).trim() !== ''; }

async function personaReply(base44, assistantSettings, companyName, instruction) {
  const system = assistantSettings?.system_prompt || '';
  const brand = (companyName || '').toString();
  const prompt = `${system ? `ASSISTANT SYSTEM PROMPT:\n"""${system}"""\n\n` : ''}You are Sarah, an assistant for ${brand || 'our company'}. Write a single SMS reply under 160 characters. Do NOT include any name prefix (no “Sarah of …:”). Keep it friendly and concise.\n\nInstruction: ${instruction}`;
  const res = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt });
  return typeof res === 'string' ? res.trim() : String(res || '').trim();
}

async function promptForField(base44, assistantSettings, companyName, field) {
  switch (field) {
    case 'name':
      return await personaReply(base44, assistantSettings, companyName, 'Ask for their full name. Keep it short.');
    case 'phone':
      return await personaReply(base44, assistantSettings, companyName, 'Ask for best phone number to reach them. Keep it short.');
    case 'email':
      return await personaReply(base44, assistantSettings, companyName, 'Ask for their email so you can send confirmations. Keep it short.');
    case 'address':
      return await personaReply(base44, assistantSettings, companyName, 'Ask for the service address (street, city, zip). Keep it short.');
    default:
      return await personaReply(base44, assistantSettings, companyName, 'Politely ask for a bit more info. Keep it short.');
  }
}

function pickChoiceIndex(text) {
  const m = (text || '').trim().match(/^(1|2|3)\b/);
  return m ? (parseInt(m[1], 10) - 1) : null;
}

function formatHuman(dateISO, tz) {
  try {
    const d = new Date(dateISO);
    return d.toLocaleString(undefined, { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (_) { return dateISO; }
}

function slotsSummary(slots, tz) {
  return slots.map((s, i) => `${i+1}) ${formatHuman(s.start, tz)}`).join(' | ');
}

async function getOrCreateLeadWithState(base44, companyId, { email, phone10, fallbackName }) {
  const leads = await base44.asServiceRole.entities.Lead.filter({ company_id: companyId });
  let match = leads.find(l => email && (l.email || '').toLowerCase() === email) || leads.find(l => phone10 && (l.phone || '').replace(/\D/g, '').slice(-10) === phone10);

  if (!match) {
    match = await base44.asServiceRole.entities.Lead.create({ company_id: companyId, name: fallbackName, email: email || undefined, phone: phone10 ? `+1${phone10}` : undefined, status: 'new', source: 'ai' });
  }

  const state = extractStateFromNotes(match.notes);
  return { lead: match, state };
}

function extractStateFromNotes(notes) {
  const s = (notes || '').toString();
  const start = s.indexOf('[SARAH_STATE]');
  const end = s.indexOf('[/SARAH_STATE]');
  if (start >= 0 && end > start) {
    try {
      const json = s.substring(start + 13, end).trim();
      return JSON.parse(json);
    } catch (_) { /* ignore */ }
  }
  return {};
}

async function persistStateOnLead(base44, lead, state) {
  const before = (lead.notes || '').toString();
  const cleaned = before.replace(/\[SARAH_STATE\][\s\S]*?\[\/SARAH_STATE\]/g, '').trim();
  const stateBlock = `\n\n[SARAH_STATE]\n${JSON.stringify(state)}\n[/SARAH_STATE]`;
  await base44.asServiceRole.entities.Lead.update(lead.id, { notes: `${cleaned}${stateBlock}` });
}

async function weakExtract(base44, companyName, channel, message, fromName, fromEmail, fromPhone, systemPrompt) {
  const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt: `You are an intake parser for ${companyName || 'our company'}. Extract key fields from the user message.${systemPrompt ? `\nAssistant persona:\n"""${systemPrompt}"""` : ''}\nMessage:\n"""\n${message}\n"""\nReturn ONLY JSON with keys: name, email, phone, service_needed, address, intent, schedule_requested (boolean).` ,
    response_json_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        service_needed: { type: 'string' },
        address: { type: 'string' },
        intent: { type: 'string' },
        schedule_requested: { type: 'boolean' }
      }
    }
  });
  return res || {};
}

async function proposeSlots(base44, tz, config) {
  const accessToken = await safeGetCalendarToken(base44);
  const now = new Date();
  const slots = [];

  // Try next N business days, propose 10am/1pm/3pm if free
  let day = 0;
  while (slots.length < 3 && day < config.daysLookahead) {
    const d = new Date(now.getTime() + day * 24 * 60 * 60 * 1000);
    const wk = d.getDay(); // 0=Sun,6=Sat
    day++;
    if (wk === 0 || wk === 6) continue; // skip weekends

    for (const hour of [10, 13, 15]) {
      if (hour < config.businessHours.start || hour >= config.businessHours.end) continue;
      const start = new Date(d);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start.getTime() + config.durationMin * 60 * 1000);

      const free = await isFree(accessToken, tz, start, end);
      if (free) {
        slots.push({ start: start.toISOString(), end: end.toISOString() });
        if (slots.length >= 3) break;
      }
    }
  }

  // Fallback: if we didn’t find enough, just return next 3 hours from tomorrow
  if (slots.length === 0) {
    const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    start.setHours(10, 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      const s = new Date(start.getTime() + i * 2 * 60 * 60 * 1000);
      slots.push({ start: s.toISOString(), end: new Date(s.getTime() + config.durationMin * 60 * 1000).toISOString() });
    }
  }

  return slots;
}

async function isFree(accessToken, tz, start, end) {
  try {
    if (!accessToken) return true; // if no connector, assume free to avoid blocking
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime'
    });
    const resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!resp.ok) return true;
    const data = await resp.json();
    return !(Array.isArray(data.items) && data.items.length > 0);
  } catch (_) {
    return true;
  }
}

async function safeGetCalendarToken(base44) {
  try { return await base44.asServiceRole.connectors.getAccessToken('googlecalendar'); } catch (_) { return null; }
}

async function createCalendarEvent(base44, companyId, tz, state, slot, config) {
  // Mirror in internal entity
  const calendarEvent = await base44.asServiceRole.entities.CalendarEvent.create({
    company_id: companyId,
    title: `${state.service || 'Appointment'} — ${state.name || 'Lead'}`,
    description: 'Auto-scheduled by Sarah',
    start_time: slot.start,
    end_time: slot.end,
    event_type: 'appointment',
    status: 'scheduled',
    related_lead: state.name,
    color: '#3b82f6',
    attendees: state.email ? [state.email] : []
  });

  let googleEventId = null;
  try {
    const accessToken = await safeGetCalendarToken(base44);
    if (accessToken) {
      const resp = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `${state.service || 'Appointment'} — ${state.name || 'Lead'}`,
          description: `Auto-scheduled by Sarah\nCRM Event ID: ${calendarEvent.id}`,
          start: { dateTime: slot.start, timeZone: tz },
          end: { dateTime: slot.end, timeZone: tz },
          attendees: state.email ? [{ email: state.email, displayName: state.name }] : [],
          reminders: { useDefault: true }
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        googleEventId = data.id;
      }
    }
  } catch (_) { /* ignore calendar failures */ }

  return { calendarEventId: calendarEvent.id, googleEventId };
}

async function safeSendEmail(base44, companyId, state, subject, body) {
  try {
    await base44.asServiceRole.functions.invoke('sendEmailFromCRM', {
      to: state.email,
      subject,
      message: body,
      contactName: state.name || 'Lead',
      companyId
    });
  } catch (_) { /* ignore */ }
}