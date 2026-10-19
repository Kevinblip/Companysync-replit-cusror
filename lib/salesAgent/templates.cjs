'use strict';

const { assertCatalogPrices, postalAddress, priceSpeech } = require('./pricing.cjs');

function fill(template, vars) {
  return String(template || '').replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_, key) => {
    const value = vars[key];
    return value == null ? '' : String(value);
  });
}

function footer(vars) {
  const unsub = vars.unsubscribe_url ? `Unsubscribe: ${vars.unsubscribe_url}` : '';
  return [postalAddress(), unsub].filter(Boolean).join('\n');
}

function email(subject, body, vars) {
  const text = `${fill(body, vars).trim()}\n\n${footer(vars)}`;
  const html = `<div>${fill(body, vars).trim().split('\n').map((line) => `<p>${escapeHtml(line) || '&nbsp;'}</p>`).join('')}<p>${escapeHtml(postalAddress())}</p>${vars.unsubscribe_url ? `<p><a href="${escapeHtml(vars.unsubscribe_url)}">Unsubscribe</a></p>` : ''}</div>`;
  const rendered = { subject: fill(subject, vars).trim(), text, html };
  assertCatalogPrices(`${rendered.subject}\n${rendered.text}`, 'sales email');
  return rendered;
}

function sms(body, vars) {
  let text = fill(body, vars).trim();
  if (!/reply stop to opt out/i.test(text)) text = `${text} Reply STOP to opt out.`;
  assertCatalogPrices(text, 'sales sms');
  return text;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

function bookingConfirmation(vars) {
  return {
    sms: sms('Hi {{first_name}}, you\'re booked for your CompanySync demo {{demo_time_local}} {{tz}}. Sneak peek: {{clip_url}} Need a new time? {{reschedule_url}} Reply STOP to opt out.', vars),
    email: email(
      'You\'re booked: CompanySync demo, {{demo_time_local}}',
      `Hi {{first_name}},
Your CompanySync demo is set for {{demo_time_local}} ({{tz}}). The calendar invite is attached.
We'll keep it to about 15 minutes and focus on {{trade}}: how leads get answered, measured, estimated and paid without the paperwork.
Want a head start? Here's a 2-minute look at {{clip_title}}: {{clip_url}}
Need a different time? {{reschedule_url}}
Talk soon,
{{agent_name}}, CompanySync`,
      vars,
    ),
  };
}

function reminder24(vars) {
  return {
    sms: sms('Reminder: your CompanySync demo is tomorrow at {{demo_time_local}} {{tz}}. Can\'t make it? Pick a new time in one tap: {{reschedule_url}} Reply STOP to opt out.', vars),
    email: email(
      'Tomorrow: your CompanySync demo',
      'Hi {{first_name}}, quick reminder that we\'re on for {{demo_time_local}} {{tz}} tomorrow. If something came up, one tap moves it: {{reschedule_url}}. See you then. {{agent_name}}',
      vars,
    ),
  };
}

function reminder1(vars) {
  return {
    sms: sms('See you in an hour, {{first_name}} ({{demo_time_local}} {{tz}}). Running late or on a roof? Move it here: {{reschedule_url}} Reply STOP to opt out.', vars),
    email: email(
      'Starting in 1 hour',
      'Hi {{first_name}}, we start at {{demo_time_local}}. Join link: {{join_url}}. Need to move it? {{reschedule_url}}',
      vars,
    ),
  };
}

function noShow(vars) {
  return {
    sms: sms('Hi {{first_name}}, looks like today didn\'t work. No problem, roofs come first. Grab a new time here: {{reschedule_url}} Reply STOP to opt out.', vars),
    email: email(
      'Missed you today, want a new time?',
      'Hi {{first_name}}, we didn\'t connect at {{demo_time_local}}. Totally get it. Pick any open slot here: {{reschedule_url}}. Or just watch the 2-minute tour first: {{clip_url}}. {{agent_name}}',
      vars,
    ),
  };
}

function handoffProspect(vars) {
  return {
    email: email(
      'You\'re set with {{rep_name}} on {{demo_time_local}}',
      'Hi {{first_name}}, thanks for the time today. I\'ve booked you with {{rep_name}} from our team for {{demo_time_local}} {{tz}} so you can go over {{handoff_reason}}. They already have my notes, so you won\'t have to repeat yourself. Need a different time? {{reschedule_url}}',
      vars,
    ),
  };
}

function handoffInternal(vars) {
  return email(
    'Handoff: {{first_name}} ({{company}}, {{trade}}), {{demo_time_local}}',
    'Lead: {{first_name}} {{last_name}}, {{phone}}, {{email}} · Team size: {{team_size}} · Current software: {{current_software}} · Pain: {{pain}} · Clips shown: {{clips_shown}} · Objections: {{objections}} · Why handed off: {{handoff_reason}} · Next step promised: {{next_step}} · Recording: {{recording_url}} · Transcript: {{transcript_url}}',
    vars,
  );
}

function objectionVariant(objection) {
  const key = String(objection || '').toLowerCase();
  if (key.includes('price') || key.includes('expensive')) return 'price';
  if (key.includes('switch')) return 'switching';
  if (key.includes('jobnimbus') || key.includes('acculynx') || key.includes('already')) return 'jobnimbus';
  return 'think';
}

function day0Recap(vars) {
  return email(
    'Your CompanySync recap',
    'Hi {{first_name}}, thanks for the time today. Here\'s what we covered: {{recap_bullets}}. The clips I showed are here if you want to share them with your team: {{clip_links}}. Start the 14-day free trial (no credit card): {{trial_url}}. {{agent_name}}',
    vars,
  );
}

function day2Objection(vars) {
  const variant = objectionVariant(vars.objection);
  if (variant === 'price') {
    return email(
      'What CompanySync replaces',
      `Most roofers we talk to are paying for a CRM, an answering service, a measuring tool and an e-sign app separately. CompanySync puts those in one plan. ${priceSpeech()} Details: {{pricing_url}}. The trial is free for 14 days, no card, so you can check it against a real job first.`,
      vars,
    );
  }
  if (variant === 'switching') {
    return email(
      'Switching is smaller than it looks',
      'Week one is your company profile, a price list (CSV import takes about a minute), your estimate template and inviting the team. The Launch Checklist tells you what\'s left. Want a rep to walk through your setup with you? {{book_url}}',
      vars,
    );
  }
  if (variant === 'jobnimbus') {
    return email(
      'Run one job side by side',
      'No need to rip anything out today. Put your next lead through the CompanySync trial and compare: the AI receptionist answering after hours, satellite measurement, the homeowner portal with Pay Now. {{trial_url}}',
      vars,
    );
  }
  return email(
    'Something to think with',
    'Here are the two clips that answer the questions people usually sleep on: {{clip_links}}. When you\'re ready, the trial is here: {{trial_url}}',
    vars,
  );
}

function day5Sms(vars) {
  return sms('Hi {{first_name}}, {{agent_name}} from CompanySync. Tried you just now. Questions about the trial? Reply here or grab a time: {{book_url}} Reply STOP to opt out.', vars);
}

function day9(vars) {
  return email(
    '14 days, no card, one real job',
    'The quickest way to know if CompanySync fits is to run one real lead through it, from the call to the estimate to the invoice. Start here: {{trial_url}}',
    vars,
  );
}

function day14(vars) {
  return email(
    'Should I close your file?',
    'Hi {{first_name}}, I haven\'t heard back, so I\'ll stop reaching out. If timing changes (storm season has a way of doing that), just reply to this email or start the trial anytime: {{trial_url}}. Good luck out there. {{agent_name}}',
    vars,
  );
}

function trialDay1(vars) {
  return email(
    'Day 1: three things to set up first',
    'Welcome aboard, {{first_name}}. Do these three today: (1) company profile and logo, (2) your price list, (3) add your first lead. 2-minute walkthrough: https://getcompanysync.com/TrainingVideos?v=26. Questions? Reply here.',
    vars,
  );
}

function trialDay3(vars) {
  return email(
    'Day 3: let the AI measure your next roof',
    'Type an address into the AI Estimator and get roof measurements from satellite in about 30 seconds, then build the estimate from your price list. Watch: https://getcompanysync.com/TrainingVideos?v=4',
    vars,
  );
}

function trialDay7(vars) {
  return email(
    'Halfway through your trial',
    'You\'re halfway through, {{first_name}}. Want 15 minutes with {{rep_name}} to set up Alex on your business line or import your price list? {{book_url}}. Ready to keep it? Choose a plan: {{pricing_url}}.',
    vars,
  );
}

function trialLink(vars) {
  return {
    sms: sms('Hi {{first_name}}, here is the CompanySync 14-day free trial (no card): {{trial_url}} Reply STOP to opt out.', vars),
    email: email(
      'Your CompanySync trial link',
      'Hi {{first_name}}, start the 14-day free trial whenever you are ready. No credit card, cancel anytime: {{trial_url}}. Plans are Basic $99/mo, Business $199/mo, and Enterprise $399/mo. {{agent_name}}',
      vars,
    ),
  };
}

function dailySummary(vars) {
  return email(
    'Sales agent daily: {{date}}',
    'Calls {{calls}} ({{minutes}} min) · Demos held {{demos}} · No-shows {{no_shows}} · Trials started {{trials}} · Subscriptions {{subs}} · Handoffs {{handoffs}} · Top objections {{top_objections}} · Pipeline moves {{stage_moves}} · Calls to review (low score or handoff): {{review_links}} · Replies for Kevin {{reply_flags}}',
    vars,
  );
}

const RENDERERS = {
  booking_confirmation: bookingConfirmation,
  reminder_24h: reminder24,
  reminder_1h: reminder1,
  no_show: noShow,
  handoff_prospect: handoffProspect,
  handoff_internal: handoffInternal,
  day0_recap: day0Recap,
  day2_objection: day2Objection,
  day5_checkin: (vars) => ({ sms: day5Sms(vars) }),
  day9_nudge: day9,
  day14_breakup: day14,
  trial_day1: trialDay1,
  trial_day3: trialDay3,
  trial_day7: trialDay7,
  trial_link: trialLink,
  daily_summary: dailySummary,
};

function renderTemplate(kind, vars) {
  const renderer = RENDERERS[kind];
  if (!renderer) throw new Error(`Unknown sales template: ${kind}`);
  return renderer(vars || {});
}

module.exports = {
  fill,
  renderTemplate,
  objectionVariant,
  RENDERERS,
  bookingConfirmation,
  reminder24,
  reminder1,
  noShow,
  handoffProspect,
  handoffInternal,
  day0Recap,
  day2Objection,
  day5Sms,
  day9,
  day14,
  trialDay1,
  trialDay3,
  trialDay7,
  trialLink,
  dailySummary,
};
