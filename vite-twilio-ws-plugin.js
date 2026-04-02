import { WebSocketServer, WebSocket } from 'ws';
import { createHmac } from 'crypto';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { notifyAdmins, notifyAdminsWithSms } from './vite-notification-helper.js';

const SETTINGS_FILE = path.resolve('.sarah-voice-settings.json');

// Singleton DB pool — shared across all local DB helpers in this plugin
let _localPool = null;
function getLocalPool() {
  if (!_localPool || _localPool._ending || _localPool._ended) {
    _localPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
    });
    _localPool.on('error', (err) => {
      console.warn('[vite-ws-plugin] Pool error (auto-reset):', err.message);
      _localPool = null;
    });
  }
  return _localPool;
}

// ============================================================
// USAGE LOGGING — logs a SubscriptionUsage row to the DB
// Called after Sarah calls (per-minute), SMS AI replies, etc.
// ============================================================
const USAGE_UNIT_COSTS = { sarah: 0.10, sms_ai: 0.02, lexi: 0.05 };

async function logUsageEvent(companyId, feature, units = 1) {
  if (!companyId || companyId === 'companysync_master_001') return;
  try {
    const pool = getLocalPool();
    const unitCost = USAGE_UNIT_COSTS[feature] || 0.05;
    const totalCost = unitCost * units;
    const usageMonth = new Date().toISOString().slice(0, 7);
    const id = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const data = { company_id: companyId, feature, units, unit_cost: unitCost, total_cost: totalCost, usage_month: usageMonth, logged_at: new Date().toISOString() };
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
      [id, companyId, JSON.stringify(data)]
    );
    console.log(`[Usage] Logged: ${feature} x${units} for company ${companyId} ($${totalCost.toFixed(2)})`);
  } catch (e) {
    console.error('[Usage] Failed to log usage event:', e.message);
  }
}

const BASE44_API_URL = process.env.BASE44_SARAH_API_URL || '';
const BRIDGE_SECRET = process.env.SARAH_BRIDGE_SECRET || '';
const DEFAULT_COMPANY_ID = '695944e3c1fb00b7ab716c6f';

// ============================================================
// IN-MEMORY SUBSCRIBER CACHE (dev server mirror)
// ============================================================
const subscriberCache = new Map();
let cacheLastRefreshed = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

function normalizePhone(phone) {
  if (!phone) return '';
  let clean = phone.replace(/[^\d+]/g, '');
  if (clean.length === 10) clean = '+1' + clean;
  else if (clean.length === 11 && clean.startsWith('1')) clean = '+' + clean;
  else if (!clean.startsWith('+')) clean = '+' + clean;
  return clean;
}

function getCachedSubscriber(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);
  return subscriberCache.get(normalized) || null;
}

function setCachedSubscriber(phoneNumber, data) {
  const normalized = normalizePhone(phoneNumber);
  if (normalized) {
    subscriberCache.set(normalized, { ...data, cachedAt: Date.now() });
    console.log(`[Cache] Set: ${normalized} -> company=${data.companyId}, rep=${data.repName || 'none'}, routing=${data.routingMode || 'sarah_answers'}`);
  }
}

const NICKNAME_MAP = {
  vicky:['victoria','vikki','vicki'], vikki:['victoria','vicky','vicki'], vicki:['victoria','vicky','vikki'], victoria:['vicky','vikki','vicki'],
  bill:['william','will','billy'], will:['william','bill','billy'], billy:['william','bill','will'], william:['bill','will','billy'],
  bob:['robert','rob','bobby'], rob:['robert','bob','bobby'], bobby:['robert','bob','rob'], robert:['bob','rob','bobby'],
  mike:['michael','mick','mickey'], mick:['michael','mike','mickey'], michael:['mike','mick'],
  dave:['david'], david:['dave'],
  chris:['christopher','kristopher'], christopher:['chris'], kristopher:['chris'],
  jim:['james','jimmy'], jimmy:['james','jim'], james:['jim','jimmy'],
  joe:['joseph','joey'], joey:['joseph','joe'], joseph:['joe','joey'],
  tom:['thomas','tommy'], tommy:['thomas','tom'], thomas:['tom','tommy'],
  john:['johnny','jon','jack'], johnny:['john','jon'], jon:['john','jonathan'], jonathan:['jon'],
  dan:['daniel','danny'], danny:['daniel','dan'], daniel:['dan','danny'],
  matt:['matthew','matty'], matthew:['matt'],
  steve:['steven','stephen'], steven:['steve'], stephen:['steve'],
  ben:['benjamin'], benjamin:['ben'],
  andy:['andrew'], drew:['andrew'], andrew:['andy','drew'],
  pete:['peter'], peter:['pete'],
  ron:['ronald','ronnie'], ronnie:['ronald','ron'], ronald:['ron','ronnie'],
  ray:['raymond'], raymond:['ray'],
  don:['donald','donnie'], donnie:['donald','don'], donald:['don','donnie'],
  tim:['timothy'], timothy:['tim'],
  ken:['kenneth','kenny'], kenny:['kenneth','ken'], kenneth:['ken','kenny'],
  chuck:['charles'], charlie:['charles'], charles:['chuck','charlie'],
  frank:['franklin','francis'], franklin:['frank'],
  hank:['henry'], henry:['hank'],
  jack:['jackson'],
  jake:['jacob'], jacob:['jake'],
  nick:['nicholas'], nicholas:['nick'],
  tony:['anthony'], anthony:['tony'],
  rich:['richard','rick'], rick:['richard','rich'], richard:['rich','rick'],
  ed:['edward','eddie'], eddie:['edward','ed'], edward:['ed','eddie','ted'], ted:['edward'],
  greg:['gregory'], gregory:['greg'],
  larry:['lawrence'], lawrence:['larry'],
  mark:['marcus'], marcus:['mark'],
  sam:['samuel','samantha','sammy'], sammy:['samuel','samantha','sam'], samuel:['sam','sammy'], samantha:['sam','sammy'],
  alex:['alexander','alexandra','alexis'], alexander:['alex'], alexandra:['alex'], alexis:['alex','lexi'], lexi:['alexis','alexandra'],
  liz:['elizabeth','beth','lisa','lizzy'], beth:['elizabeth','liz','betty'], betty:['elizabeth','beth'], lisa:['elizabeth','liz'], elizabeth:['liz','beth','betty','lisa','lizzy'], lizzy:['elizabeth','liz'],
  kate:['katherine','kathy','katie','cathy'], katie:['katherine','kate'], kathy:['katherine','kate','cathy'], cathy:['catherine','kate'], katherine:['kate','katie','kathy'], catherine:['cathy'],
  jen:['jennifer','jenny'], jenny:['jennifer','jen'], jennifer:['jen','jenny'],
  sue:['susan','suzy'], suzy:['susan','sue'], susan:['sue','suzy'],
  pat:['patricia','patrick','patty'], patty:['patricia','pat'], patricia:['pat','patty'], patrick:['pat'],
  steph:['stephanie','stephen'], stephanie:['steph'],
  maggie:['margaret'], meg:['margaret'], margaret:['maggie','meg','peggy'], peggy:['margaret'],
  ann:['anne','anna'], anne:['ann','anna'], anna:['ann','anne'],
  barb:['barbara'], barbara:['barb'],
  cindy:['cynthia'], cynthia:['cindy'],
  abby:['abigail'], abigail:['abby'],
  debbie:['deborah','deb'], deb:['deborah','debbie'], deborah:['debbie','deb'],
  ellie:['eleanor','ella'], eleanor:['ellie','nell'], nell:['eleanor'],
  jess:['jessica','jessie'], jessie:['jessica','jess'], jessica:['jess','jessie'],
  judy:['judith'], judith:['judy'],
  kim:['kimberly'], kimberly:['kim'],
  pam:['pamela'], pamela:['pam'],
  sandy:['sandra'], sandra:['sandy'],
  sara:['sarah'], sarah:['sara'],
  tina:['christina'], christina:['tina'],
  nancy:['nan'], nan:['nancy'],
  bev:['beverly'], beverly:['bev'],
  carol:['caroline','carolyn'], caroline:['carol'], carolyn:['carol'],
  gina:['regina','virginia'], virginia:['gina','ginny'], ginny:['virginia'],
  jo:['josephine','joanna'], joanna:['jo'], josephine:['jo'],
  laura:['laurie'], laurie:['laura'],
  linda:['lyn','lynne'], lynne:['linda'], lyn:['linda'],
  molly:['margaret','mary'], mary:['maria','marie','molly'], maria:['mary','marie'], marie:['mary','maria'],
  rose:['rosemary','rosie'], rosie:['rose','rosemary'], rosemary:['rose','rosie'],
  terri:['teresa','theresa','terry'], terry:['teresa','theresa','terri'], teresa:['terri','terry'], theresa:['terri','terry'],
  wendy:['gwendolyn'], gwendolyn:['wendy'],
};
function nameMatchesSearch(storedName, searchTerm) {
  const stored = (storedName || '').toLowerCase();
  const search = (searchTerm || '').toLowerCase().trim();
  if (!search || !stored) return false;
  if (stored.includes(search)) return true;
  const storedWords = stored.split(/\s+/);
  const searchAliases = NICKNAME_MAP[search] || [];
  for (const word of storedWords) {
    if (word === search) return true;
    if (searchAliases.includes(word)) return true;
    if ((NICKNAME_MAP[word] || []).includes(search)) return true;
  }
  return false;
}

function getPublicHost(reqHeaders) {
  const envUrl = process.env.VITE_REPLIT_APP_URL || '';
  if (envUrl) {
    try {
      const parsed = new URL(envUrl);
      return parsed.host;
    } catch (e) {}
  }
  return reqHeaders?.host || 'localhost:5000';
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function generateTwilioToken(accountSid, apiKeySid, apiKeySecret, identity, twimlAppSid, ttl = 3600) {
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: twimlAppSid,
    incomingAllow: true,
  });
  const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity, ttl });
  token.addGrant(voiceGrant);
  return token.toJwt();
}

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    voice: 'Kore',
    response_speed: 'normal',
    background_audio: 'none',
    interim_audio: 'typing',
    personality_assertiveness: 50,
    personality_humor: 20
  };
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

async function localGetSettings(companyId) {
  try {
    const pool = getLocalPool();
    {
      // Resolve Base44 ID → local company ID if needed
      const { rows: companyRows } = await pool.query(
        `SELECT id, name, data FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`,
        [companyId]
      );
      const company = companyRows[0] || {};
      const localCompanyId = company.id || companyId;

      const { rows: settingsRows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
        [localCompanyId]
      );
      const settings = settingsRows[0]?.data || {};

      const companyName = settings.brand_short_name || company.name || company.data?.company_name || 'our company';
      const companyTimezone = company.data?.timezone || 'America/New_York';
      const rawName = (settings.assistant_name || 'Sarah').trim();
      const assistantDisplayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

      // Load staff list so Sarah knows team members by name
      let staffContext = '';
      try {
        const { rows: staffRows } = await pool.query(
          `SELECT full_name, role, cell_phone, twilio_number, availability_status FROM staff_profiles WHERE company_id = $1 AND is_active = true ORDER BY full_name`,
          [localCompanyId]
        );
        if (staffRows.length > 0) {
          staffContext = '\n\nTEAM MEMBERS:\n' + staffRows.map(s =>
            `- ${s.full_name}${s.role ? ` (${s.role})` : ''}${s.availability_status === 'available' ? ' — available' : ' — unavailable'}`
          ).join('\n');
        }
      } catch (e) { /* ignore */ }

      let knowledgeParts = [];

      try {
        const { rows: memories } = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'AIMemory' AND company_id = $1 AND (data->>'is_active')::boolean = true ORDER BY (data->>'importance')::int DESC NULLS LAST LIMIT 50`,
          [localCompanyId]
        );
        if (memories.length > 0) {
          knowledgeParts.push(memories.map(m => `- ${m.data?.title || ''}: ${m.data?.content || ''}`).join('\n'));
        }
      } catch (e) { /* ignore */ }

      try {
        const { rows: articles } = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'KnowledgeBaseArticle' AND company_id = $1 AND data->>'status' = 'published' LIMIT 30`,
          [localCompanyId]
        );
        if (articles.length > 0) {
          knowledgeParts.push(articles.map(a => `- ${a.data?.title || ''}: ${(a.data?.content || a.data?.summary || '').substring(0, 500)}`).join('\n'));
        }
      } catch (e) { /* ignore */ }

      try {
        const { rows: training } = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'AITrainingData' AND company_id = $1 AND data->>'status' = 'active' LIMIT 50`,
          [localCompanyId]
        );
        if (training.length > 0) {
          knowledgeParts.push(training.map(t => `- ${t.data?.category || 'General'}: ${t.data?.content || ''}`).join('\n'));
        }
      } catch (e) { /* ignore */ }

      if (staffContext) knowledgeParts.push(staffContext);

      const fullKnowledge = knowledgeParts.filter(Boolean).join('\n');
      console.log(`[localGetSettings] company=${companyName}, assistant=${assistantDisplayName}, timezone=${companyTimezone}, settings_keys=${Object.keys(settings).length}, localId=${localCompanyId}`);

      return {
        settings,
        companyName,
        assistantName: assistantDisplayName,
        timezone: companyTimezone,
        customSystemPrompt: settings.system_prompt || '',
        knowledgeBase: fullKnowledge,
        companyDescription: company.data?.description || '',
        companyServices: company.data?.services || '',
        localCompanyId,
      };
    }
  } catch (err) {
    console.error('[localGetSettings] Error:', err.message);
    return { error: err.message };
  }
}

async function localGetMessagingSettings(companyId) {
  try {
    const pool = getLocalPool();
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'MessagingSettings' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const settings = rows[0]?.data || {};
    return {
      whatsapp_enabled: settings.whatsapp_enabled || false,
      sms_auto_reply: settings.sms_auto_reply !== false,
      missed_call_followup_enabled: settings.missed_call_followup_enabled || false,
      missed_call_channel: settings.missed_call_channel || 'sms',
      missed_call_template: settings.missed_call_template || '',
      ...settings,
    };
  } catch (e) {
    console.error('[localGetMessagingSettings] Error:', e.message);
    return null;
  }
}

const smsConversationHistory = new Map();

async function localHandleIncomingMessage(companyId, msgData) {
  const { from, to, body, channel, message_sid } = msgData;
  console.log(`[LocalSMS] Handling ${channel} from ${from} for company ${companyId}`);
  try {
    const settingsResult = await localGetSettings(companyId);
    if (settingsResult.error) {
      console.error('[LocalSMS] Failed to get settings:', settingsResult.error);
      return { reply: null };
    }
    const { settings, companyName, assistantName, knowledgeBase, customSystemPrompt, localCompanyId = companyId } = settingsResult;

    const convKey = `${localCompanyId}:${from}`;
    if (!smsConversationHistory.has(convKey)) {
      smsConversationHistory.set(convKey, []);
    }
    const history = smsConversationHistory.get(convKey);
    history.push({ role: 'user', parts: [{ text: body }] });
    if (history.length > 20) history.splice(0, history.length - 20);

    let systemPrompt = customSystemPrompt || '';
    if (!systemPrompt) {
      systemPrompt = `You are ${assistantName}, the office manager for ${companyName}. You're responding to a ${channel === 'whatsapp' ? 'WhatsApp' : 'text'} message.

Personality: Conversational, helpful, and human. Use contractions (you're, we're, it's). Sound like a real person texting — not a script. Never mention being AI.

RULES:
- Keep responses SHORT — 1-3 sentences max for texts.
- Be helpful and specific. Reference actual services if you know them.
- If they're a new lead asking about services, get their name and address, one question at a time.
- Don't ask "How can I assist you further?" — just help naturally.
- If you can't help, let them know someone will follow up.`;
    }

    const bookingUrl = settings.calendly_booking_url || '';
    systemPrompt = systemPrompt
      .replace(/\{brand\}/gi, companyName)
      .replace(/\{agent\}/gi, assistantName)
      .replace(/\{calendly_link\}/gi, bookingUrl || 'our booking page');

    if (knowledgeBase) {
      systemPrompt += `\n\nKNOWLEDGE BASE:\n${knowledgeBase}`;
    }

    systemPrompt += `\n\nIMPORTANT: You are responding via ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS text message'}. Keep your responses short, conversational, and text-appropriate (1-3 sentences). Do not use long paragraphs.`;
    systemPrompt += `\n\nAPPOINTMENT BOOKING: When someone wants to schedule an appointment or inspection, do NOT send a link. Instead, collect their name, phone number, and preferred date/time in a natural conversational way (one question at a time). Tell them your team will confirm the appointment. Never output placeholder text like {calendly_link} — that is not a real link.`;

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[LocalSMS] GOOGLE_GEMINI_API_KEY not set');
      return { reply: null };
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: history.map(h => ({
            role: h.role === 'user' ? 'user' : 'model',
            parts: h.parts,
          })),
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error('[LocalSMS] Gemini error:', geminiRes.status, errText.substring(0, 300));
      return { reply: null };
    }

    const geminiData = await geminiRes.json();
    const reply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (reply) {
      history.push({ role: 'model', parts: [{ text: reply }] });
      console.log(`[LocalSMS] AI reply (${reply.length} chars): "${reply.substring(0, 100)}..."`);
    }

    try {
      const pool = getLocalPool();
      const commType = channel === 'whatsapp' ? 'whatsapp' : 'sms';
      // Save inbound message to the communications table
      const inboundId = `comm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await pool.query(
        `INSERT INTO communications (id, company_id, communication_type, direction, contact_phone, body, message, status, is_read, data, created_at, updated_at)
         VALUES ($1, $2, $3, 'inbound', $4, $5, $5, 'delivered', false, $6, NOW(), NOW())`,
        [
          inboundId, localCompanyId, commType, from, body,
          JSON.stringify({ company_phone: to, message_sid, channel, ai_handled: true }),
        ]
      );
      // Save AI reply as outbound message
      if (reply) {
        const outboundId = `comm_${Date.now() + 1}_${Math.random().toString(36).slice(2, 8)}`;
        await pool.query(
          `INSERT INTO communications (id, company_id, communication_type, direction, contact_phone, body, message, status, is_read, data, created_at, updated_at)
           VALUES ($1, $2, $3, 'outbound', $4, $5, $5, 'sent', true, $6, NOW(), NOW())`,
          [
            outboundId, localCompanyId, commType, from, reply,
            JSON.stringify({ company_phone: to, message_sid, channel, ai_sent: true }),
          ]
        );
      }
      console.log(`[LocalSMS] Saved ${commType} conversation to communications table for ${from}`);
    } catch (logErr) {
      console.warn('[LocalSMS] Failed to log communication:', logErr.message);
    }

    // Fire bell + email + SMS cell notification to admins for every inbound message (non-blocking)
    const callerSnippet = body ? `"${body.substring(0, 100)}"` : 'New inbound message';
    const replySnippet = reply ? `Sarah replied: "${reply.substring(0, 80)}"` : '';
    notifyAdminsWithSms(localCompanyId, {
      title: `New message from ${from}`,
      message: `${callerSnippet}${replySnippet ? '\n\n' + replySnippet : ''}`,
      type: 'inbound_sms',
      linkUrl: '/SarahWorkspace',
      smsBody: `YICN message from ${from}:\n${body ? body.substring(0, 140) : '(no message)'}\n\nSarah replied: ${reply ? reply.substring(0, 100) : '(no reply)'}\n\nReply via app: getcompanysync.com`
    }).catch(e => console.warn('[LocalSMS] Notification fire failed:', e.message));

    if (reply && localCompanyId) {
      logUsageEvent(localCompanyId, 'sms_ai', 1).catch(ue => console.warn('[LocalSMS] Failed to log usage:', ue.message));
    }

    return { reply, success: true };
  } catch (err) {
    console.error('[LocalSMS] Error:', err.message);
    return { reply: null };
  }
}

async function localSendMissedCallFollowup(companyId, callData) {
  const { caller_phone, called_number, channel } = callData;
  console.log(`[LocalMissedCall] Sending follow-up to ${caller_phone} for company ${companyId}`);
  try {
    const settingsResult = await localGetSettings(companyId);
    const { companyName, assistantName, settings } = settingsResult;

    const pool = getLocalPool();
    let twilioSid, twilioToken, twilioPhone;
    {
      const { rows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
        [companyId]
      );
      const tw = rows[0]?.data || {};
      twilioSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
      twilioToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
      twilioPhone = tw.main_phone_number || called_number;
    }

    if (!twilioSid || !twilioToken) {
      console.error('[LocalMissedCall] No Twilio credentials found');
      return { success: false };
    }

    const msgSettings = await localGetMessagingSettings(companyId);
    let template = msgSettings?.missed_call_template || '';
    if (!template) {
      template = `Hi! This is ${assistantName} from ${companyName}. We noticed we missed your call. How can we help you? Feel free to reply to this text or call us back anytime!`;
    }
    template = template.replace(/\{brand\}/gi, companyName).replace(/\{agent\}/gi, assistantName);

    const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
    const smsParams = new URLSearchParams({
      To: caller_phone,
      From: twilioPhone,
      Body: template,
    });

    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${authHeader}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: smsParams.toString(),
      }
    );

    if (twilioRes.ok) {
      console.log(`[LocalMissedCall] Follow-up SMS sent to ${caller_phone}`);
      return { success: true };
    } else {
      const errText = await twilioRes.text();
      console.error('[LocalMissedCall] Twilio SMS failed:', twilioRes.status, errText.substring(0, 200));
      return { success: false };
    }
  } catch (err) {
    console.error('[LocalMissedCall] Error:', err.message);
    return { success: false };
  }
}

async function localCheckVoiceAccess(companyId) {
  try {
    const pool = getLocalPool();
    const { rows } = await pool.query(
      `SELECT id, name, subscription_plan, trial_end_date, data FROM companies WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
      [companyId]
    );
    const company = rows[0];
    if (!company) {
      console.warn(`[localCheckVoiceAccess] Company ${companyId} not found in local DB — allowing call (phone routing already validated)`);
      return { allowed: true };
    }

    const plan = (company.subscription_plan || company.data?.subscription_plan || 'trial').toLowerCase();
    const status = company.data?.subscription_status || 'active';
    const trialExpired = company.data?.trial_expired === true ||
      (company.trial_end_date && new Date(company.trial_end_date) < new Date());

    if (trialExpired && plan === 'trial') {
      return { allowed: false, reason: 'Trial expired. Please upgrade to continue using voice features.' };
    }
    if (status === 'cancelled' || status === 'suspended') {
      return { allowed: false, reason: `Subscription ${status}. Please contact support to reactivate.` };
    }

    console.log(`[localCheckVoiceAccess] Company ${companyId} (${company.name}) allowed — plan=${plan}, status=${status}`);
    return { allowed: true, plan, call_minutes_used: 0, call_minutes_limit: -1 };
  } catch (err) {
    console.error('[localCheckVoiceAccess] Error:', err.message);
    return { allowed: true };
  }
}

function formatHour12(h) {
  const n = parseInt(h) || 0;
  if (n === 0 || n === 24) return '12am';
  if (n === 12) return '12pm';
  if (n < 12) return n + 'am';
  return (n - 12) + 'pm';
}

async function localCheckAvailability(companyId) {
  const { getPool } = await import('./db/schema.js');
  const pool = getPool();
  const { rows: settRows } = await pool.query(
    `SELECT data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
    [companyId]
  );
  const settings = settRows[0]?.data || {};
  const sched = settings.scheduling_defaults || {};
  const durationMin = parseInt(sched.duration_min) || 45;
  const bufferMin = parseInt(sched.buffer_min) || 15;
  const hoursStart = parseInt(sched.business_hours_start ?? 9);
  const hoursEnd = parseInt(sched.business_hours_end ?? 17);
  const daysLookahead = parseInt(sched.days_lookahead) || 7;

  const { rows: coRows } = await pool.query(`SELECT data FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
  const tz = coRows[0]?.data?.timezone || 'America/New_York';

  const { rows: slotRows } = await pool.query(`
    SELECT s AS slot_start_utc,
           s + ($1 || ' minutes')::interval AS slot_end_utc,
           to_char(s AT TIME ZONE $2, 'FMDay, FMMonth FMDD "at" FMHH12:MI AM') AS display_label
    FROM generate_series(
      date_trunc('hour', NOW()) + INTERVAL '1 hour',
      NOW() + ($3 || ' days')::interval,
      '30 minutes'::interval
    ) s
    WHERE s > NOW()
      AND EXTRACT(HOUR FROM s AT TIME ZONE $2) >= $4
      AND EXTRACT(HOUR FROM s AT TIME ZONE $2) < $5
      AND (EXTRACT(HOUR FROM s AT TIME ZONE $2) * 60 + EXTRACT(MINUTE FROM s AT TIME ZONE $2) + $1::int) <= ($5 * 60)
      AND NOT EXISTS (
        SELECT 1 FROM calendar_events ce
        WHERE ce.company_id = $6
          AND ce.start_time < s + (($1::int + $7::int) || ' minutes')::interval
          AND COALESCE(ce.end_time, ce.start_time + (($1::int + $7::int)::text || ' minutes')::interval) + ($7 || ' minutes')::interval > s
      )
    ORDER BY s
    LIMIT 5
  `, [durationMin, tz, daysLookahead, hoursStart, hoursEnd, companyId, bufferMin]);

  if (slotRows.length === 0) {
    return { success: true, slots: [], message: `No available slots in the next ${daysLookahead} days during business hours (${formatHour12(hoursStart)}–${formatHour12(hoursEnd)}). Someone will follow up to schedule.` };
  }
  const slotLabels = slotRows.map((r, i) => `${i + 1}. ${r.display_label}`).join('; ');
  console.log(`[Sarah CRM] checkAvailability: ${slotRows.length} slots for company ${companyId} in tz ${tz}`);
  return {
    success: true,
    slots: slotRows.map(r => r.slot_start_utc),
    slot_options: slotRows.map(r => ({ iso: r.slot_start_utc, label: r.display_label })),
    message: `Here are the next available times: ${slotLabels}. Which works best?`
  };
}

async function callBase44API(action, companyId, data = null) {
  if (action === 'checkVoiceAccess' && companyId) {
    try {
      const localResult = await localCheckVoiceAccess(companyId);
      console.log(`[Sarah CRM] checkVoiceAccess served LOCALLY for company ${companyId}: allowed=${localResult.allowed}`);
      return localResult;
    } catch (e) {
      console.warn('[Sarah CRM] Local checkVoiceAccess failed, allowing call:', e.message);
      return { allowed: true };
    }
  }

  if (action === 'getSettings' && companyId) {
    try {
      const localResult = await localGetSettings(companyId);
      if (!localResult.error && localResult.settings && Object.keys(localResult.settings).length > 0) {
        console.log(`[Sarah CRM] getSettings served LOCALLY: assistant="${localResult.assistantName}", company="${localResult.companyName}"`);
        return localResult;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local getSettings failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'handleIncomingMessage' && companyId) {
    try {
      const localResult = await localHandleIncomingMessage(companyId, data);
      if (localResult && (localResult.reply || localResult.success)) {
        console.log(`[Sarah CRM] handleIncomingMessage served LOCALLY for company ${companyId}`);
        return localResult;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local handleIncomingMessage failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'getMessagingSettings' && companyId) {
    try {
      const localResult = await localGetMessagingSettings(companyId);
      if (localResult) {
        console.log(`[Sarah CRM] getMessagingSettings served LOCALLY for company ${companyId}`);
        return localResult;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local getMessagingSettings failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'sendMissedCallFollowup' && companyId) {
    try {
      const localResult = await localSendMissedCallFollowup(companyId, data);
      if (localResult) {
        console.log(`[Sarah CRM] sendMissedCallFollowup served LOCALLY for company ${companyId}`);
        return localResult;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local sendMissedCallFollowup failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'createAlert' && companyId) {
    try {
      const pool = getLocalPool();
      const alertId = `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Alert', $2, $3, NOW(), NOW())`,
        [alertId, companyId, JSON.stringify({
          id: alertId,
          type: data?.type || 'system',
          urgency: data?.urgency || 'normal',
          message: data?.message || '',
          caller_phone: data?.caller_phone || '',
          status: 'unread',
          source: 'sarah_ai',
          created_at: new Date().toISOString()
        })]
      );
      console.log(`[Sarah CRM] createAlert saved locally for company ${companyId}`);
      return { success: true, alertId };
    } catch (e) {
      console.warn('[Sarah CRM] Local createAlert failed:', e.message);
    }
  }

  if (action === 'checkAvailability' && companyId) {
    try {
      return await localCheckAvailability(companyId);
    } catch (e) {
      console.warn('[Sarah CRM] Local checkAvailability failed:', e.message);
      return { success: false, message: 'Unable to check availability right now. Someone will follow up to schedule.' };
    }
  }

  if ((action === 'sendCalendarInvite' || action === 'bookAppointment' || action === 'scheduleInspection') && companyId) {
    try {
      const { getPool } = await import('./db/schema.js');
      const pool = getPool();

      const customerName = data?.customer_name || data?.name || 'Customer';
      const customerPhone = data?.customer_phone || data?.phone || '';
      const rawDateTime = data?.date_time || data?.slot_time;
      const title = data?.title || (action === 'scheduleInspection' ? `Roof Inspection - ${customerName}` : `Appointment - ${customerName}`);
      const description = data?.description || data?.notes || data?.address || '';

      // Check if calendar invites are allowed for this company
      const settingsResult = await localGetSettings(companyId);
      const allowCalendarInvites = settingsResult?.settings?.allow_calendar_invites !== false;

      if (!allowCalendarInvites) {
        // Relay-only mode: notify the team but don't book or SMS
        const notifId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const requestedTime = rawDateTime || 'time not specified';
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
           VALUES ($1, 'Notification', $2, $3, NOW(), NOW())`,
          [notifId, companyId, JSON.stringify({
            title: `📞 Appointment Request — ${customerName}`,
            message: `${customerName} (${customerPhone || 'no phone'}) requested an appointment: "${title}" for ${requestedTime}. Please follow up to confirm.`,
            type: 'appointment_request',
            is_read: false
          })]
        );
        console.log(`[Sarah CRM] Calendar invites disabled — relayed appointment request to team for ${companyId}`);
        return {
          success: true,
          message: `I've noted your request for an appointment and passed your details along to our team. Someone will follow up with you soon to confirm the time. Is there anything else I can help you with?`
        };
      }

      const sched = settingsResult?.settings?.scheduling_defaults || {};
      const durationMin = parseInt(sched.duration_min) || 45;
      const bufferMin = parseInt(sched.buffer_min) || 15;
      const { rows: tzRows } = await pool.query(`SELECT data FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
      const tz = tzRows[0]?.data?.timezone || 'America/New_York';

      let startTime;
      try { startTime = rawDateTime ? new Date(rawDateTime) : new Date(Date.now() + 86400000); }
      catch (_) { startTime = new Date(Date.now() + 86400000); }
      if (isNaN(startTime.getTime())) startTime = new Date(Date.now() + 86400000);
      const endTime = new Date(startTime.getTime() + durationMin * 60000);

      const hoursStart = parseInt(sched.business_hours_start ?? 9);
      const hoursEnd = parseInt(sched.business_hours_end ?? 17);

      // Business-hours enforcement for bookAppointment and scheduleInspection
      if (action === 'bookAppointment' || action === 'scheduleInspection') {
        const localHour = parseFloat(startTime.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
        const localMinute = parseInt(startTime.toLocaleString('en-US', { timeZone: tz, minute: 'numeric' })) || 0;
        const totalMin = localHour * 60 + localMinute;
        if (localHour < hoursStart || totalMin + durationMin > hoursEnd * 60) {
          const { rows: altRows } = await pool.query(`
            SELECT to_char(s AT TIME ZONE $2, 'FMDay, FMMonth FMDD "at" FMHH12:MI AM') AS display_label
            FROM generate_series($3::timestamptz, $3::timestamptz + '7 days'::interval, '30 minutes'::interval) s
            WHERE s > NOW()
              AND EXTRACT(HOUR FROM s AT TIME ZONE $2) >= $4
              AND EXTRACT(HOUR FROM s AT TIME ZONE $2) < $5
              AND (EXTRACT(HOUR FROM s AT TIME ZONE $2) * 60 + EXTRACT(MINUTE FROM s AT TIME ZONE $2) + $6::int) <= ($5 * 60)
              AND NOT EXISTS (
                SELECT 1 FROM calendar_events ce WHERE ce.company_id = $1
                  AND ce.start_time < s + (($6::int + $7::int) || ' minutes')::interval
                  AND COALESCE(ce.end_time, ce.start_time + (($6::int + $7::int)::text || ' minutes')::interval) + ($7 || ' minutes')::interval > s
              )
            ORDER BY s LIMIT 1
          `, [companyId, tz, startTime.toISOString(), hoursStart, hoursEnd, durationMin, bufferMin]);
          const altMsg = altRows.length > 0 ? ` The next available time within business hours is ${altRows[0].display_label}.` : '';
          return { success: false, message: `That time is outside business hours (${formatHour12(hoursStart)}–${formatHour12(hoursEnd)}).${altMsg}` };
        }
      }

      // Atomic conflict check + insert using advisory lock for bookAppointment and scheduleInspection
      let calId, apptId, notifId, displayTime;
      if (action === 'bookAppointment' || action === 'scheduleInspection') {
        const lockKey = companyId.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 2147483647, 0) || 1;
        const client = await pool.connect();
        let clientReleased = false;
        try {
          await client.query('BEGIN');
          await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

          const devBufferedEnd = new Date(endTime.getTime() + bufferMin * 60000);
          const devBufferedStart = new Date(startTime.getTime() - bufferMin * 60000);
          const { rows: conflicts } = await client.query(
            `SELECT id FROM calendar_events WHERE company_id = $1 AND start_time < $2 AND COALESCE(end_time, start_time + ($4 || ' minutes')::interval) > $3`,
            [companyId, devBufferedEnd.toISOString(), devBufferedStart.toISOString(), durationMin + bufferMin]
          );
          if (conflicts.length > 0) {
            await client.query('ROLLBACK');
            client.release(); clientReleased = true;
            const { rows: altRows } = await pool.query(`
              SELECT to_char(s AT TIME ZONE $2, 'FMDay, FMMonth FMDD "at" FMHH12:MI AM') AS display_label
              FROM generate_series($3::timestamptz, $3::timestamptz + '3 days'::interval, '30 minutes'::interval) s
              WHERE s > NOW()
                AND EXTRACT(HOUR FROM s AT TIME ZONE $2) >= $4
                AND EXTRACT(HOUR FROM s AT TIME ZONE $2) < $5
                AND (EXTRACT(HOUR FROM s AT TIME ZONE $2) * 60 + EXTRACT(MINUTE FROM s AT TIME ZONE $2) + $6::int) <= ($5 * 60)
                AND NOT EXISTS (
                  SELECT 1 FROM calendar_events ce WHERE ce.company_id = $1
                    AND ce.start_time < s + (($6::int + $7::int) || ' minutes')::interval
                    AND COALESCE(ce.end_time, ce.start_time + (($6::int + $7::int)::text || ' minutes')::interval) + ($7 || ' minutes')::interval > s
                )
              ORDER BY s LIMIT 1
            `, [companyId, tz, startTime.toISOString(), hoursStart, hoursEnd, durationMin, bufferMin]);
            const altMsg = altRows.length > 0 ? ` The next available time is ${altRows[0].display_label}.` : '';
            return { success: false, message: `That time is already booked.${altMsg}` };
          }

          calId = `ce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          await client.query(
            `INSERT INTO calendar_events (id, title, start_time, end_time, description, event_type, company_id, assigned_to, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ai_voice', NOW())`,
            [calId, title, startTime.toISOString(), endTime.toISOString(), description,
             action === 'scheduleInspection' ? 'inspection' : 'appointment', companyId, data?.assigned_to || null]
          );

          apptId = `appt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          await client.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Appointment', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
            [apptId, companyId, JSON.stringify({
              id: apptId, company_id: companyId,
              type: action === 'scheduleInspection' ? 'inspection' : 'appointment',
              title, customer_name: customerName, customer_phone: customerPhone,
              date_time: startTime.toISOString(), calendar_event_id: calId,
              status: 'scheduled', source: 'ai_voice', created_at: new Date().toISOString()
            })]
          );

          notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          displayTime = startTime.toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          await client.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
            [notifId, companyId, JSON.stringify({
              id: notifId, company_id: companyId, type: 'new_appointment',
              title: action === 'scheduleInspection' ? 'New Inspection Scheduled by AI' : 'New Appointment Booked by AI',
              message: `${customerName} ${action === 'scheduleInspection' ? 'scheduled a roof inspection' : 'booked an appointment'} for ${displayTime}.${description ? ' Notes: ' + description : ''}`,
              is_read: false, priority: 'high', appointment_id: apptId,
              created_at: new Date().toISOString()
            })]
          );

          await client.query('COMMIT');
          client.release(); clientReleased = true;
          console.log(`[Sarah CRM] Calendar event ${calId} + Appointment ${apptId} created (atomic) for ${companyId}`);
        } catch (txErr) {
          if (!clientReleased) { await client.query('ROLLBACK').catch(() => {}); client.release(); }
          throw txErr;
        }
      } else {
        // sendCalendarInvite: non-atomic insert (relay-only context, already handled above for disabled invites)
        calId = `ce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await pool.query(
          `INSERT INTO calendar_events (id, title, start_time, end_time, description, event_type, company_id, assigned_to, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, 'appointment', $6, $7, 'ai_voice', NOW())`,
          [calId, title, startTime.toISOString(), endTime.toISOString(), description, companyId, data?.assigned_to || null]
        );
        apptId = null; notifId = null;
        displayTime = startTime.toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        console.log(`[Sarah CRM] Calendar event ${calId} created locally: "${title}" for ${companyId}`);
      }

      let smsSent = false;
      if (customerPhone) {
        try {
          const companyDisplayName = settingsResult.companyName || 'Our team';
          const twRows = await pool.query(
            `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`, [companyId]
          );
          const tw = twRows.rows[0]?.data || {};
          const twilioSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
          const twilioToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
          const twilioPhone = tw.main_phone_number || process.env.TWILIO_PHONE_NUMBER;

          if (twilioSid && twilioToken && twilioPhone) {
            const formattedTime = startTime.toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            const locationPart = data?.address ? ` at ${data.address}` : '';
            const smsBody = `Hi ${customerName}! Your appointment with ${companyDisplayName} is confirmed: ${title} on ${formattedTime}${locationPart}. Reply STOP to opt out.`;
            const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
            const smsParams = new URLSearchParams({ To: customerPhone, From: twilioPhone, Body: smsBody });
            const smsResp = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
              { method: 'POST', headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: smsParams.toString() }
            );
            smsSent = smsResp.ok;
            console.log(`[Sarah CRM] Calendar invite SMS ${smsSent ? 'sent' : 'failed'} to ${customerPhone}`);
          }
        } catch (smsErr) {
          console.warn('[Sarah CRM] SMS send failed (non-fatal):', smsErr.message);
        }
      }

      const localTime = startTime.toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const msg = smsSent
        ? `Done! I've booked the appointment for ${localTime} and sent a text confirmation to ${customerPhone}.`
        : `Done! Appointment confirmed for ${localTime} and added to the calendar.`;
      return { success: true, appointment_id: apptId, calendar_event_id: calId, message: msg };
    } catch (e) {
      console.warn(`[Sarah CRM] Local ${action} failed:`, e.message);
      return { success: false, message: 'I had trouble creating the appointment. Please try again.' };
    }
  }

  if (action === 'getLeadHistory' && companyId && data?.phone) {
    try {
      const pool = getLocalPool();
      const cleanPhone = data.phone.replace(/[^\d+]/g, '');
      const phoneVariants = [cleanPhone, cleanPhone.replace(/^\+1/, ''), '+1' + cleanPhone.replace(/^\+1/, '')];
      const leadResult = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'Lead' AND company_id = $1 AND (data->>'phone' = ANY($2) OR data->>'mobile_phone' = ANY($2)) ORDER BY updated_date DESC LIMIT 1`,
        [companyId, phoneVariants]
      );
      if (leadResult.rows.length > 0) {
        const lead = leadResult.rows[0].data;
        const commResult = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'Communication' AND company_id = $1 AND data->>'lead_id' = $2 ORDER BY updated_date DESC LIMIT 3`,
          [companyId, lead.id || '']
        );
        const lastComm = commResult.rows[0]?.data;
        return {
          leadName: lead.full_name || lead.name || '',
          serviceNeeded: lead.service_needed || lead.service_type || '',
          lastInteraction: lastComm ? `${lastComm.type || 'contact'} on ${lastComm.date || lastComm.created_date || 'unknown date'}` : '',
          notes: lead.notes || '',
        };
      }
    } catch (e) {
      console.warn('[Sarah CRM] getLeadHistory failed:', e.message);
    }
    return null;
  }

  // Local: lookupByPhone — find company by Twilio number
  if (action === 'lookupByPhone') {
    try {
      const phone = data?.phone_number || '';
      const { getCallRouting } = await import('./db/queries.js');
      const routing = await getCallRouting(phone);
      if (routing?.company_id) {
        console.log(`[Sarah CRM] lookupByPhone LOCAL: ${phone} -> ${routing.company_id}`);
        return { success: true, company_id: routing.company_id, sarah_enabled: true };
      }
    } catch (e) { console.warn('[Sarah CRM] Local lookupByPhone error:', e.message); }
    return { success: false };
  }

  // Local: lookupStaffByTwilioNumber — find rep by their Twilio number
  if (action === 'lookupStaffByTwilioNumber' && companyId) {
    try {
      const { getStaffByTwilioNumber } = await import('./db/queries.js');
      const staff = await getStaffByTwilioNumber(data?.twilio_number || '');
      if (staff) {
        console.log(`[Sarah CRM] lookupStaffByTwilioNumber LOCAL: ${data?.twilio_number} -> ${staff.full_name}`);
        return { success: true, staff: { full_name: staff.full_name, email: staff.user_email, cell_phone: staff.cell_phone, call_routing_mode: staff.call_routing_mode, availability_status: staff.availability_status } };
      }
    } catch (e) { console.warn('[Sarah CRM] Local lookupStaffByTwilioNumber error:', e.message); }
    return { success: false };
  }

  // Local: getTwilioSettings — fetch Twilio credentials from DB
  if (action === 'getTwilioSettings' && companyId) {
    try {
      const pool = getLocalPool();
      const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = companyRows[0]?.id || companyId;
      const { rows } = await pool.query(`SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`, [localId]);
      if (rows[0]?.data) {
        console.log(`[Sarah CRM] getTwilioSettings LOCAL for ${companyId}`);
        return { success: true, ...rows[0].data };
      }
    } catch (e) { console.warn('[Sarah CRM] Local getTwilioSettings error:', e.message); }
  }

  // Local: getAllSubscriberRouting — build routing map from local data
  if (action === 'getAllSubscriberRouting') {
    try {
      const pool = getLocalPool();
      const { rows: staffRows } = await pool.query(
        `SELECT sp.company_id, sp.full_name, sp.user_email, sp.cell_phone, sp.twilio_number,
                sp.call_routing_mode, sp.availability_status,
                COALESCE(a.data->>'brand_short_name', c.name) as company_name,
                ts.data as twilio_settings
         FROM staff_profiles sp
         JOIN companies c ON c.id = sp.company_id
         LEFT JOIN generic_entities a ON a.company_id = sp.company_id AND a.entity_type = 'AssistantSettings'
         LEFT JOIN generic_entities ts ON ts.company_id = sp.company_id AND ts.entity_type = 'TwilioSettings'
         WHERE sp.twilio_number IS NOT NULL AND sp.is_active = true`
      );
      const routing = {};
      const subscribers = [];
      for (const row of staffRows) {
        if (row.twilio_number) {
          const entry = {
            companyId: row.company_id, companyName: row.company_name || '',
            repName: row.full_name || '', repEmail: row.user_email || '',
            cellPhone: row.cell_phone || '', routingMode: row.call_routing_mode || 'sarah_answers',
            availabilityStatus: row.availability_status || 'available',
            twilioSid: row.twilio_settings?.account_sid || '',
            twilioToken: row.twilio_settings?.auth_token || '',
          };
          routing[row.twilio_number] = entry;
          subscribers.push({
            phone_number: row.twilio_number,
            company_id: row.company_id,
            company_name: row.company_name || '',
            rep_name: row.full_name || '',
            rep_email: row.user_email || '',
            cell_phone: row.cell_phone || '',
            routing_mode: row.call_routing_mode || 'sarah_answers',
            availability_status: row.availability_status || 'available',
            twilio_sid: row.twilio_settings?.account_sid || '',
            twilio_token: row.twilio_settings?.auth_token || '',
          });
        }
      }
      console.log(`[Sarah CRM] getAllSubscriberRouting LOCAL: ${subscribers.length} numbers`);
      return { success: true, routing, subscribers };
    } catch (e) { console.warn('[Sarah CRM] Local getAllSubscriberRouting error:', e.message); }
  }

  // Local: saveLead — save lead from call to DB
  if (action === 'saveLead' && companyId) {
    try {
      const pool = getLocalPool();
      const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = companyRows[0]?.id || companyId;
      const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const phone = (data?.phone || data?.caller_phone || '').replace(/[^\d+]/g, '');
      const existing = phone ? await pool.query(`SELECT id FROM leads WHERE company_id = $1 AND phone = $2 LIMIT 1`, [localId, phone]) : { rows: [] };
      if (existing.rows.length === 0) {
        await pool.query(
          `INSERT INTO leads (id, company_id, name, phone, email, source, status, assigned_to, service_needed, notes, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'sarah_ai', 'new', $6, $7, $8, $9, NOW(), NOW())
           ON CONFLICT DO NOTHING`,
          [leadId, localId, data?.name || data?.customer_name || 'Unknown Caller', phone,
           data?.email || '', data?.assigned_to || data?.rep_name || '',
           data?.service_needed || data?.service_type || '', data?.notes || data?.address || '',
           JSON.stringify({ source: 'sarah_ai', call_sid: data?.call_sid || '', address: data?.address || '', ...data })]
        );
        console.log(`[Sarah CRM] saveLead LOCAL: ${data?.name || 'Unknown'} for ${localId}`);
      }
      return { success: true, leadId };
    } catch (e) { console.warn('[Sarah CRM] Local saveLead error:', e.message); }
  }

  // Local: saveCallLog — save call record to DB
  if (action === 'saveCallLog' && companyId) {
    try {
      const pool = getLocalPool();
      const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = companyRows[0]?.id || companyId;
      const commId = `comm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Communication', $2, $3, NOW(), NOW())`,
        [commId, localId, JSON.stringify({
          id: commId, type: 'call', communication_type: 'call',
          direction: data?.direction || 'inbound',
          contact_phone: data?.caller_phone || '',
          contact_name: data?.caller_name || '',
          duration_seconds: data?.duration_seconds || 0,
          transcript: data?.transcript || '',
          call_sid: data?.call_sid || '',
          tool_calls_made: data?.tool_calls_made || 0,
          assistant_name: data?.assistant_name || 'Sarah',
          status: 'completed', created_at: new Date().toISOString()
        })]
      );
      console.log(`[Sarah CRM] saveCallLog LOCAL for ${localId}`);
      return { success: true, commId };
    } catch (e) { console.warn('[Sarah CRM] Local saveCallLog error:', e.message); }
  }

  // Local: trackCallMinutes — log usage
  if (action === 'trackCallMinutes' && companyId) {
    try {
      const pool = getLocalPool();
      const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = companyRows[0]?.id || companyId;
      const usageId = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const durationSec = data?.duration_seconds || 0;
      const minutes = Math.ceil(durationSec / 60);
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
        [usageId, localId, JSON.stringify({ company_id: localId, feature: 'voice_minutes', units: minutes, unit_cost: 0.02, total_cost: +(minutes * 0.02).toFixed(2), usage_month: new Date().toISOString().slice(0, 7), logged_at: new Date().toISOString() })]
      );
      console.log(`[Sarah CRM] trackCallMinutes LOCAL: ${minutes}min for ${localId}`);
      return { success: true };
    } catch (e) { console.warn('[Sarah CRM] Local trackCallMinutes error:', e.message); }
  }

  // Local: notifyRep / sendAlert — notify staff via bell + email
  if ((action === 'notifyRep' || action === 'sendAlert') && companyId) {
    try {
      const pool = getLocalPool();
      const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = companyRows[0]?.id || companyId;
      await notifyAdmins(localId, {
        title: data?.title || (action === 'notifyRep' ? 'New lead from Sarah' : 'Sarah Alert'),
        message: data?.message || data?.body || '',
        type: action === 'notifyRep' ? 'lead_created' : 'alert',
        linkUrl: '/SarahWorkspace'
      });
      console.log(`[Sarah CRM] ${action} LOCAL for ${localId}`);
      return { success: true };
    } catch (e) { console.warn(`[Sarah CRM] Local ${action} error:`, e.message); }
  }

  if (!BASE44_API_URL || !BRIDGE_SECRET) {
    console.warn('[Sarah CRM] BASE44_SARAH_API_URL or SARAH_BRIDGE_SECRET not configured — action not handled locally:', action);
    return { error: 'CRM not configured' };
  }
  try {
    const body = { action, companyId };
    if (data) body.data = data;

    console.log(`[Sarah CRM] Calling ${action} for company ${companyId}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(BASE44_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRIDGE_SECRET}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const responseText = await resp.text();

    try {
      const result = JSON.parse(responseText);
      if (action === 'getSettings') {
        console.log(`[Sarah CRM] getSettings key fields: assistant_name="${result.settings?.assistant_name}", brand="${result.settings?.brand_short_name}", computed_assistantName="${result.assistantName}", companyName="${result.companyName}"`);
      } else {
        console.log(`[Sarah CRM] ${action} response:`, JSON.stringify(result).substring(0, 300));
      }
      return result;
    } catch (parseErr) {
      console.error(`[Sarah CRM] ${action} returned unparseable response (${resp.status}):`, responseText.substring(0, 200));
      return { error: `API returned non-JSON response (status ${resp.status}).` };
    }
  } catch (err) {
    console.error(`[Sarah CRM] ${action} failed:`, err.message);
    return { error: err.message };
  }
}

const CRM_TOOLS = [
  {
    name: "save_lead_details",
    description: "Save caller's contact information as a lead in the CRM. Call this when the caller provides their name, phone number, email, or describes what service they need.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's full name" },
        phone: { type: "string", description: "Caller's phone number" },
        email: { type: "string", description: "Caller's email address" },
        service_needed: { type: "string", description: "What service or help the caller needs" },
        address: { type: "string", description: "Caller's address if provided" },
        assigned_to: { type: "string", description: "Staff member name or email to assign this lead to. Use this when a call was forwarded from a specific rep." }
      },
      required: ["name"]
    }
  },
  {
    name: "check_availability",
    description: "Check available appointment slots. Call this when the caller wants to schedule a meeting, demo, or appointment.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  {
    name: "book_appointment",
    description: "Book an appointment for the caller. Call this after checking availability and the caller has chosen a time slot.",
    parameters: {
      type: "object",
      properties: {
        slot_time: { type: "string", description: "The date and time for the appointment in ISO format or natural language" },
        name: { type: "string", description: "Name of the person the appointment is for" },
        email: { type: "string", description: "Email of the person" },
        description: { type: "string", description: "Reason or description for the appointment" }
      },
      required: ["slot_time", "name"]
    }
  },
  {
    name: "send_alert",
    description: "Send an urgent alert or message to the business owner/team. Use this when: the caller reports a problem or complaint, has a technical issue, wants to leave a message for someone specific, requests a callback from a manager, or any situation where the team needs to be notified immediately.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The alert message summarizing what the caller needs" },
        caller_name: { type: "string", description: "Name of the caller if known" },
        caller_phone: { type: "string", description: "Phone number of the caller" },
        urgency: { type: "string", description: "Priority level: low, medium, high, or urgent" },
        category: { type: "string", description: "Type of alert: complaint, technical_issue, callback_request, general_message, emergency" }
      },
      required: ["message"]
    }
  },
  {
    name: "schedule_inspection",
    description: "Schedule a roof inspection appointment. Creates a calendar event and assigns it to the appropriate rep. Use this when the caller wants to schedule a roof inspection.",
    parameters: {
      type: "object",
      properties: {
        date_time: { type: "string", description: "The date and time for the inspection in ISO format or natural language" },
        customer_name: { type: "string", description: "Name of the customer" },
        customer_phone: { type: "string", description: "Phone number of the customer" },
        address: { type: "string", description: "Property address for the inspection" },
        notes: { type: "string", description: "Any special notes about the inspection (type of damage, access info, etc.)" },
        assigned_to: { type: "string", description: "Staff member name or email to assign this inspection to" }
      },
      required: ["date_time", "customer_name", "address"]
    }
  },
  {
    name: "notify_rep",
    description: "Send an SMS or WhatsApp notification to a specific sales rep. Use this to alert a rep about a new lead, upcoming appointment, or important update.",
    parameters: {
      type: "object",
      properties: {
        rep_name: { type: "string", description: "Name of the rep to notify" },
        rep_phone: { type: "string", description: "Phone number of the rep (if known)" },
        message: { type: "string", description: "The notification message to send" },
        notification_type: { type: "string", description: "Type: new_lead, inspection_scheduled, callback_request, general" }
      },
      required: ["message"]
    }
  },
  {
    name: "transfer_call",
    description: "Transfer the current call to a staff member's cell phone. Use when the caller asks to speak to someone by name, or when routing mode is sarah_then_transfer and you have gathered the caller's info. IMPORTANT: Only call this ONCE per conversation. If it fails, do NOT retry — help the caller directly instead.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Brief reason for the transfer" },
        target_person: { type: "string", description: "Name of the specific staff member the caller wants to speak to (e.g. 'Vicky', 'Kevin'). Leave empty to transfer to the default rep." }
      },
      required: []
    }
  },
  {
    name: "send_calendar_invite",
    description: "Send a calendar invite via SMS to the caller and create the appointment in the CRM calendar. Use this whenever the caller wants a calendar invite, appointment confirmation, or after scheduling any appointment during the call.",
    parameters: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Name of the customer" },
        customer_phone: { type: "string", description: "Phone number to send the SMS invite to" },
        date_time: { type: "string", description: "Date and time of the appointment in ISO format or natural language (e.g. 'March 5 at 2pm')" },
        title: { type: "string", description: "Title of the appointment (e.g. 'Roof Inspection', 'Follow-up Consultation')" },
        description: { type: "string", description: "Additional details about the appointment" },
        address: { type: "string", description: "Location or address for the appointment if applicable" }
      },
      required: ["customer_phone", "date_time", "title"]
    }
  },
  {
    name: "send_text_to_caller",
    description: "Send an SMS text message directly to the caller's phone number. Use this to send appointment confirmations, inspection details, follow-up info, addresses, or anything the caller asks to receive by text. Can also be used after a call ends to send a summary.",
    parameters: {
      type: "object",
      properties: {
        to: { type: "string", description: "Phone number to send the text to (caller's number)" },
        message: { type: "string", description: "The text message to send. Keep it short and clear — this is an SMS." }
      },
      required: ["to", "message"]
    }
  }
];

const BIAS = 0x84;
const CLIP = 32635;

const EXP_LUT = new Uint8Array([
  0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,
  4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,
  7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7
]);

function mulawEncode(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  const exponent = EXP_LUT[(sample >> 7) & 0xFF];
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

const MULAW_DECODE_TABLE = new Int16Array(256);
(function buildDecodeTable() {
  for (let i = 0; i < 256; i++) {
    const val = ~i & 0xFF;
    const sign = val & 0x80;
    const exponent = (val >> 4) & 0x07;
    const mantissa = val & 0x0F;
    let magnitude = ((mantissa << 3) + BIAS) << exponent;
    magnitude -= BIAS;
    MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
  }
})();

function twilioToGemini(mulawB64) {
  const buf = Buffer.from(mulawB64, 'base64');
  const nSrc = buf.length;
  const pcm8k = new Int16Array(nSrc);
  for (let i = 0; i < nSrc; i++) pcm8k[i] = MULAW_DECODE_TABLE[buf[i]];
  const nDst = nSrc * 2;
  const pcm16 = new Int16Array(nDst);
  for (let i = 0; i < nSrc - 1; i++) {
    pcm16[i * 2] = pcm8k[i];
    pcm16[i * 2 + 1] = (pcm8k[i] + pcm8k[i + 1]) >> 1;
  }
  pcm16[nDst - 2] = pcm8k[nSrc - 1];
  pcm16[nDst - 1] = pcm8k[nSrc - 1];
  return Buffer.from(pcm16.buffer).toString('base64');
}

const LP_COEFFS = new Float64Array([
  0.0595, 0.0990, 0.1571, 0.2030, 0.2218,
  0.2030, 0.1571, 0.0990, 0.0595
]);
const LP_LEN = LP_COEFFS.length;
const LP_HALF = (LP_LEN - 1) >> 1;

function geminiToTwilio(pcmB64) {
  const buf = Buffer.from(pcmB64, 'base64');
  const nSrc = buf.length >> 1;
  const pcm = new Float64Array(nSrc);
  for (let i = 0; i < nSrc; i++) pcm[i] = buf.readInt16LE(i * 2);

  let prev = pcm[0];
  for (let i = 1; i < nSrc; i++) {
    const orig = pcm[i];
    pcm[i] = orig - 0.4 * prev;
    prev = orig;
  }

  const ratio = 3;
  const nDst = Math.floor(nSrc / ratio);
  const out = Buffer.alloc(nDst);
  for (let i = 0; i < nDst; i++) {
    const center = i * ratio;
    let acc = 0;
    for (let k = 0; k < LP_LEN; k++) {
      const idx = center - LP_HALF + k;
      if (idx >= 0 && idx < nSrc) acc += pcm[idx] * LP_COEFFS[k];
    }
    const sample = Math.max(-32768, Math.min(32767, Math.round(acc)));
    out[i] = mulawEncode(sample);
  }
  return out.toString('base64');
}

async function handleToolCall(functionCall, companyId, context = {}) {
  const { name, args } = functionCall;
  let parsedArgs = {};
  try {
    parsedArgs = typeof args === 'string' ? JSON.parse(args) : (args || {});
  } catch (e) {
    console.warn(`[Sarah CRM] Failed to parse args for ${name}:`, e.message);
    parsedArgs = {};
  }

  console.log(`[Sarah CRM] Tool call: ${name}`, JSON.stringify(parsedArgs));

  switch (name) {
    case 'save_lead_details': {
      const result = await callBase44API('saveLead', companyId, {
        name: parsedArgs.name,
        phone: parsedArgs.phone,
        email: parsedArgs.email,
        service_needed: parsedArgs.service_needed,
        address: parsedArgs.address,
        assigned_to: parsedArgs.assigned_to || ''
      });
      return result;
    }

    case 'check_availability': {
      const result = await callBase44API('checkAvailability', companyId);
      return result;
    }

    case 'book_appointment': {
      const result = await callBase44API('bookAppointment', companyId, {
        slot_time: parsedArgs.slot_time,
        name: parsedArgs.name,
        email: parsedArgs.email,
        description: parsedArgs.description
      });
      return result;
    }

    case 'send_alert': {
      const result = await callBase44API('sendAlert', companyId, {
        message: parsedArgs.message,
        caller_name: parsedArgs.caller_name || '',
        caller_phone: parsedArgs.caller_phone || '',
        urgency: parsedArgs.urgency || 'medium',
        category: parsedArgs.category || 'general_message'
      });
      return result;
    }

    case 'schedule_inspection': {
      const result = await callBase44API('scheduleInspection', companyId, {
        date_time: parsedArgs.date_time,
        customer_name: parsedArgs.customer_name,
        customer_phone: parsedArgs.customer_phone || '',
        address: parsedArgs.address,
        notes: parsedArgs.notes || '',
        assigned_to: parsedArgs.assigned_to || ''
      });
      return result;
    }

    case 'notify_rep': {
      const result = await callBase44API('notifyRep', companyId, {
        rep_name: parsedArgs.rep_name || '',
        rep_phone: parsedArgs.rep_phone || '',
        message: parsedArgs.message,
        notification_type: parsedArgs.notification_type || 'general'
      });
      return result;
    }

    case 'transfer_call': {
      // Resolve the target cell phone before reporting success to Sarah,
      // so she says the right thing to the caller (transfer vs. "I'll have them call back")
      const targetPerson = (parsedArgs.target_person || '').trim();
      let resolvedCell = context.staffCellPhone || '';
      let resolvedName = context.forwardedRepName || '';

      const normalizeToE164 = (num) => {
        if (!num) return '';
        const digits = num.replace(/[^\d]/g, '');
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
        return num.startsWith('+') ? num : `+${digits}`;
      };

      if (targetPerson) {
        // Check in-memory subscriber cache first (fastest), with nickname awareness
        if (context.subscriberCache) {
          // Strict tenant-only match — never transfer to a rep in another company
          for (const [, entry] of context.subscriberCache.entries()) {
            if (entry.companyId === companyId && entry.repName && nameMatchesSearch(entry.repName, targetPerson)) {
              resolvedCell = normalizeToE164(entry.cellPhone || '');
              resolvedName = entry.repName;
              break;
            }
          }
        }
        // Fall back to DB routing lookup (still tenant-scoped)
        if (!resolvedCell) {
          try {
            const allRouting = await callBase44API('getAllSubscriberRouting', null);
            if (allRouting?.subscribers) {
              const matched = companyId
                ? allRouting.subscribers.find(s => s.company_id === companyId && s.rep_name && nameMatchesSearch(s.rep_name, targetPerson))
                : allRouting.subscribers.find(s => s.rep_name && nameMatchesSearch(s.rep_name, targetPerson));
              if (matched) { resolvedCell = normalizeToE164(matched.cell_phone || ''); resolvedName = matched.rep_name; }
            }
          } catch (e) { console.warn('[Sarah] transfer_call routing lookup failed:', e.message); }
        }
      }

      if (!resolvedCell) {
        console.warn(`[Sarah] transfer_call: no cell found for "${targetPerson || 'default'}"`);
        return {
          success: false,
          message: `I can't connect you directly right now${resolvedName ? ' to ' + resolvedName : ''} — I'll let the team know immediately and have someone call you right back.`
        };
      }

      return {
        success: true,
        action: 'transfer_initiated',
        reason: parsedArgs.reason || 'caller requested transfer',
        resolved_cell: resolvedCell,
        resolved_name: resolvedName
      };
    }

    case 'send_calendar_invite': {
      const result = await callBase44API('sendCalendarInvite', companyId, {
        customer_name: parsedArgs.customer_name || '',
        customer_phone: parsedArgs.customer_phone || '',
        date_time: parsedArgs.date_time,
        title: parsedArgs.title,
        description: parsedArgs.description || '',
        address: parsedArgs.address || ''
      });
      return result;
    }

    case 'send_text_to_caller': {
      try {
        // Fall back to context.callerPhone when LLM omits the 'to' argument
        const toPhone = parsedArgs.to || context.callerPhone || '';
        const msgBody = parsedArgs.message || '';
        if (!toPhone) return { success: false, message: "No phone number provided to send the text to." };
        const pool = getLocalPool();
        let twilioSid, twilioToken, twilioFrom;
        try {
          const { rows } = await pool.query(
            `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
            [companyId]
          );
          const tw = rows[0]?.data || {};
          twilioSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
          twilioToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
          twilioFrom = tw.main_phone_number || process.env.TWILIO_PHONE_NUMBER;
        } catch (e) { console.warn('[Sarah] send_text_to_caller: TwilioSettings fetch error:', e.message); }
        if (!twilioSid || !twilioToken || !twilioFrom) {
          console.warn('[Sarah] send_text_to_caller: no Twilio credentials found');
          return { success: false, message: "I wasn't able to send the text — texting isn't configured for this account." };
        }
        const authHeader = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        const smsParams = new URLSearchParams({ To: toPhone, From: twilioFrom, Body: msgBody });
        const smsResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          { method: 'POST', headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: smsParams.toString() }
        );
        if (smsResp.ok) {
          console.log(`[Sarah] send_text_to_caller: SMS sent to ${toPhone}`);
          return { success: true, message: `Text sent to ${toPhone}.` };
        } else {
          const errText = await smsResp.text();
          console.error(`[Sarah] send_text_to_caller failed (${smsResp.status}):`, errText.substring(0, 200));
          return { success: false, message: "I wasn't able to send that text right now. I'll let the team know to follow up with you." };
        }
      } catch (err) {
        console.error(`[Sarah] send_text_to_caller error:`, err.message);
        return { success: false, message: "I had trouble sending the text." };
      }
    }

    default:
      console.warn(`[Sarah CRM] Unhandled tool call: ${name}`, parsedArgs);
      return { success: false, message: `I wasn't able to complete that action. Please let me know how else I can help.` };
  }
}

export default function twilioWsPlugin() {
  return {
    name: 'twilio-ws-bridge',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true });

      server.httpServer.on('upgrade', (req, socket, head) => {
        if (req.url && req.url.startsWith('/ws/twilio')) {
          wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
          });
        }
      });

      wss.on('connection', (twilioWs, req) => {
        console.log('[Sarah] Twilio media stream connected');

        let geminiWs = null;
        let currentStreamSid = null;
        let setupComplete = false;
        let waitingForOutboundGreeting = false;
        let outboundGreetingGateTimer = null;
        let callCompanyId = null;
        let callerPhone = null;
        let callSid = null;
        let callStartTime = Date.now();
        let conversationLog = [];
        let toolCallsMade = [];
        let collectedCallerName = null;
        let callLogSaved = false;
        let isSarahSpeaking = false;
        let echoGateCooldownTimer = null;
        let echoGateFailsafeTimer = null;

        const geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!geminiApiKey) {
          console.error('[Sarah] GOOGLE_GEMINI_API_KEY not set!');
          twilioWs.close();
          return;
        }

        let companyName = 'CompanySync';
        let assistantName = 'Sarah';

        let maxCallDurationSec = 1800;

        async function saveCallToBase44() {
          if (callLogSaved) return;
          callLogSaved = true;

          const durationSec = Math.round((Date.now() - callStartTime) / 1000);
          const transcript = conversationLog.map(e => `${e.role}: ${e.text}`).join('\n');

          console.log(`[${assistantName}] Saving call log: ${durationSec}s, ${conversationLog.length} exchanges, ${toolCallsMade.length} tool calls`);

          try {
            await callBase44API('saveCallLog', callCompanyId, {
              caller_phone: callerPhone || 'Unknown',
              caller_name: collectedCallerName || (isOutboundCall ? outboundLeadName : '') || 'Voice Caller',
              duration_seconds: durationSec,
              transcript: transcript,
              call_sid: callSid || '',
              tool_calls_made: toolCallsMade,
              assistant_name: assistantName,
              direction: isForwardedCall ? 'forwarded' : (isOutboundCall ? 'outbound' : 'inbound'),
            });
            console.log(`[${assistantName}] Call log saved to CRM successfully`);
          } catch (err) {
            console.error(`[${assistantName}] Failed to save call log:`, err.message);
          }

          try {
            await callBase44API('trackCallMinutes', callCompanyId, {
              duration_seconds: durationSec,
            });
            console.log(`[${assistantName}] Call minutes tracked: ${Math.ceil(durationSec / 60)} min`);
          } catch (err) {
            console.error(`[${assistantName}] Failed to track call minutes:`, err.message);
          }

          if (durationSec > 10 && callCompanyId && callCompanyId !== 'companysync_master_001') {
            try {
              const pgMod = await import('pg');
              const usagePool = new pgMod.Pool({ connectionString: process.env.DATABASE_URL });
              const callUnits = Math.max(1, Math.ceil(durationSec / 60));
              const usageId = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              await usagePool.query(
                `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
                [usageId, callCompanyId, JSON.stringify({ company_id: callCompanyId, feature: 'sarah', units: callUnits, unit_cost: 0.10, total_cost: parseFloat((callUnits * 0.10).toFixed(2)), usage_month: new Date().toISOString().slice(0, 7), duration_sec: durationSec, logged_at: new Date().toISOString() })]
              );
              await usagePool.end();
              console.log(`[${assistantName}] Usage logged: ${callUnits} min, $${(callUnits * 0.10).toFixed(2)} for ${callCompanyId}`);
            } catch (ue) {
              console.warn(`[${assistantName}] Failed to log usage:`, ue.message);
            }
          }
        }

        let companyKnowledge = '';
        let companyDescription = '';
        let subscriberSystemPrompt = '';
        let schedulingDefaults = null;

        let isOutboundCall = false;
        let outboundLeadName = '';
        let outboundLeadService = '';
        let outboundLeadAddress = '';
        let outboundCampaign = null;

        let isForwardedCall = false;
        let forwardedRepName = '';
        let forwardedRepEmail = '';
        let forwardedRepPhone = '';
        let callRoutingMode = 'sarah_answers';
        let staffCellPhone = '';

        function buildSystemPrompt(cName, aName) {
          let prompt = '';

          if (isForwardedCall && !subscriberSystemPrompt) {
            const rName = forwardedRepName || 'the team';
            const rEmail = forwardedRepEmail || '';
            prompt = `You are ${aName}, the lead qualifier and office manager for ${cName}. You're picking up a call forwarded from ${rName}'s line.

Personality: Conversational, warm, and real. You sound like a person — not a script. Use contractions (you're, we're, it's, I'll). Vary your phrasing. Never say the same thing twice. Never mention being AI.

YOUR OPENING LINE — say EXACTLY one of these, word for word. Do NOT paraphrase or create your own version:
- "Hey, you've reached ${cName}! I'm ${aName}, picking up for ${rName}. How can I help you today?"
- "Hi there! This is ${aName} with ${cName} — I'm covering ${rName}'s line. What can I do for you?"
- "Thanks for calling ${cName}! ${rName} stepped away so I've got you. What's going on?"

CRITICAL: Every opening line above ends with a question. You MUST end your first sentence with a question. Never end the opening without asking what you can help with.

CALL FLOW:
1. Use one of the opening lines above verbatim — never invent your own.
2. Acknowledge what they say before asking anything else.
3. If new lead: get their name first, then address, then what they need. One question at a time.
4. Save with save_lead_details (assigned_to="${rEmail || rName}") as soon as you have a name.
5. Try to connect them: call transfer_call to connect to ${rName}.
6. If transfer succeeds: say "Alright, connecting you now!" and stop talking.
7. If transfer fails: do NOT try again. Say "${rName} is tied up right now" and offer to help directly: schedule an inspection, take a message, or have ${rName} call them back.
8. If they want scheduling: use schedule_inspection (assigned_to="${rEmail || rName}").
9. After booking or capturing info: use notify_rep to text ${rName} about the new lead/appointment.
10. Offer to text confirmation details: use send_text_to_caller with the caller's number.
11. Let them know: "${rName} will follow up with you shortly."

CRITICAL — TRANSFER FAILURE RULES:
- You may only call transfer_call ONCE per conversation. If it fails, do NOT call it again.
- After a failed transfer, help the caller directly: schedule an inspection, take their info, or send an alert.
- NEVER loop between transfer and fallback options. Once you move to helping directly, stay there.

TRIAGE (answer first, then ask ONE follow-up):
- Leak? "Got it — is water coming in right now or is it an older issue?"
- Storm damage? "When did the storm hit? We can get someone out to take a look."
- Pricing? "We do free inspections — takes about 15 minutes. Want to schedule one?"
- Wants a meeting/demo (not inspection)? Use check_availability then book_appointment.
- General? Respond to what they said, then: "What's the best address for service?"

RULES:
- Assign EVERY lead to ${rName} (${rEmail || 'their account'}). Always use assigned_to.
- ONE question at a time. Never stack questions.
- Don't say "How can I assist you further today?" — just help them naturally.
- If they give you info unprompted, save it immediately. Don't wait.
- When using notify_rep, include a clear message like: "New lead from [caller name] at [phone] — needs [service]. Appointment booked for [date/time]." so ${rName} has full context.`;

          } else if (isOutboundCall && !subscriberSystemPrompt) {
            const campaignIntroLine = outboundCampaign?.intro
              ? `\n\nCAMPAIGN INTRO:\n"${outboundCampaign.intro.replace(/\{agent\}/g, aName).replace(/\{brand\}/g, cName).replace(/\{lead_name\}/g, outboundLeadName || 'the homeowner')}"`
              : '';
            const campaignPointsLine = outboundCampaign?.points
              ? `\n\nKEY TALKING POINTS:\n${outboundCampaign.points}`
              : '';
            const campaignGoalsLine = outboundCampaign?.goals
              ? `\n\nCALL GOALS:\n${outboundCampaign.goals}`
              : '';

            prompt = `You are ${aName}, an outbound caller for ${cName}. You are calling ${outboundLeadName || 'a lead'}${outboundLeadService ? ` about ${outboundLeadService}` : ''}.

IMPORTANT: You are AI. If directly asked, acknowledge it — never volunteer it.

Personality: Warm, direct, and human. No scripts. No filler. Get to your reason for calling in the first sentence.${campaignIntroLine}${campaignPointsLine}${campaignGoalsLine}

OPENING (pick ONE — if campaign intro is provided above, use that instead):
- "Hi, is this ${outboundLeadName || 'the homeowner'}? This is ${aName} with ${cName}${outboundLeadService ? ` — calling about ${outboundLeadService}` : ''}."
- "Hey, ${outboundLeadName || 'there'}? It's ${aName} from ${cName}. Got a quick minute?"

CALL FLOW:
1. Confirm you have the right person. One sentence.
2. State why you're calling immediately — don't build up to it.
3. Ask ONE question based on their response. Wait. Listen. Then ask the next.
4. Move toward booking: "We do free roof inspections — takes about 15 minutes. Can we set one up?"
5. If yes → use schedule_inspection (or check_availability → book_appointment).
6. After booking → use send_text_to_caller to confirm the appointment details by text.

HANDLING OBJECTIONS:
- "Not interested" → "Totally understand. If anything changes, feel free to give us a call. Have a good one."
- "Wrong number" → "Oh sorry about that! Take care." [end call]
- "Call me back later" → "Of course — when's a better time? I can make a note." Save with save_lead_details.
- "I already have someone" → "No problem at all. If you ever need a second opinion, we're here."
- Voicemail → Leave a brief message: "Hi ${outboundLeadName || 'there'}, this is ${aName} from ${cName}. Giving you a quick call${outboundLeadService ? ` about ${outboundLeadService}` : ''}. Give us a call back when you get a chance — thanks!"

RULES:
- ONE question per turn. Never stack questions.
- Never be pushy. Two no's means wrap up gracefully.
- Save any lead info with save_lead_details as you learn it.
- Always respond immediately — no dead air.

YOUR FIRST RESPONSE: Use the campaign intro if provided. Otherwise use one of the openings above. Under 20 words.`;

          } else if (subscriberSystemPrompt) {
            prompt = subscriberSystemPrompt;
            // If this is a forwarded call, prepend the context so the AI knows who it's covering for
            if (isForwardedCall) {
              const rName = forwardedRepName || 'the team';
              prompt = `CALL CONTEXT: You are picking up a call forwarded from ${rName}'s line. You are covering for ${rName}.

YOUR OPENING LINE — say EXACTLY one of these, word for word:
- "Hey, you've reached ${cName}! I'm ${aName}, picking up for ${rName}. How can I help you today?"
- "Hi there! This is ${aName} with ${cName} — I'm covering ${rName}'s line. What can I do for you?"
- "Thanks for calling ${cName}! ${rName} stepped away so I've got you. What's going on?"

CRITICAL: You MUST end your opening with a question — never leave the greeting hanging.

` + prompt;
            }
          } else {
            prompt = `You are ${aName}, the lead qualifier and office manager for ${cName}.

Personality: Conversational, helpful, and human. You actually know things and share them naturally. Use contractions (you're, we're, it's). Vary your responses — don't repeat the same phrases. Never mention being AI.

GREETING (vary each time — pick ONE):
- "Hi, this is ${aName} with ${cName}. What can I do for you?"
- "Hey! You've reached ${cName}. I'm ${aName} — how can I help?"
- "Thanks for calling ${cName}! What's going on?"

CONVERSATION STYLE:
- Acknowledge what they say FIRST, then respond. Don't jump straight to questions.
- Ask ONE clarifying question max per turn. Never stack questions.
- Give specific answers — not generic "we can help with that" filler.
- If they tell you something, reference it back: "So you've got a leak near the chimney — that's pretty common after storms."

TRIAGE (answer first, then ask ONE follow-up):
- Leak: "Got it. Is water actively coming in, or is it more of a stain situation?"
- Storm/hail/wind damage: "When did the storm come through? We can get someone out to look."
- Missing shingles: "How many are we talking — a few or a larger section?"
- Pricing/estimate: "We do free inspections that take about 15 minutes. Want to schedule one?"
- General/other: Respond naturally, then: "What's the address for the property?"

EMERGENCY KEYWORDS: emergency, urgent, asap, flood, fire, 911
- If detected: use send_alert with urgency="urgent" IMMEDIATELY, then reassure the caller help is on the way.

SCHEDULING NOTE: For roof inspections, use schedule_inspection. For general meetings or demos, use check_availability then book_appointment. After any booking, offer to text confirmation details using send_text_to_caller.

TRANSFER NOTE: If asked to speak to someone specific, use transfer_call with their name in target_person.

YOUR FIRST RESPONSE must be one of the greetings above — short, warm, under 20 words.`;
          }

          prompt = prompt.replace(/\{agent\}/gi, aName);
          prompt = prompt.replace(/\{brand\}/gi, cName);
          if (aName.toLowerCase() !== 'sarah') {
            prompt = prompt.replace(/\bSarah\b/gi, aName);
          }
          if (cName.toLowerCase() !== 'companysync') {
            prompt = prompt.replace(/\bCompanySync\b/gi, cName);
          }
          console.log(`[${aName}] System prompt built (${prompt.length} chars), name=${aName}, company=${cName}`);

          prompt += `

VOICE RULES (non-negotiable):
- No internal thinking, reasoning, or markdown. Only say words you'd say out loud on a phone call.
- Keep responses under 25 words. Short and natural.
- Never say "How can I assist you further today?" or similar robotic closers.
- Vary your responses. Don't repeat greetings, phrases, or patterns.

CRM TOOLS — use these automatically as info comes in:
- save_lead_details: Save as soon as caller shares name, phone, or what they need. Don't wait. Include service_needed. Every caller must be tracked.
- check_availability: Check open appointment slots before booking. Always offer these options to the caller.
  IF FAILS: "I'm having trouble pulling up the schedule right now — I'll have someone call you back shortly to lock in a time."
- book_appointment: Book after caller picks a slot. Always confirm the time before booking.
  IF FAILS: "I wasn't able to confirm that booking — I've got your info and someone will call you back to get that locked in."
- schedule_inspection: For roof inspection bookings. Include address and assigned_to.
  IF FAILS: "I wasn't able to book that automatically — I've got your info and someone will call you within the hour to confirm."
- transfer_call: Transfer to a staff member by name. Use target_person with their name. You may only call transfer_call ONCE per conversation. If it fails, do NOT retry — tell the caller that person is busy and offer to help directly.
  IF NO CELL FOUND: "They're tied up right now — I can schedule an inspection, take a message, or have them call you back. What works best?"
- notify_rep: Text a rep about new leads or appointments. Always use after saving a lead or booking.
- send_alert: For complaints, emergencies, or messages for someone specific. Set urgency (urgent/high/medium). Confirm to caller after sending.
- send_text_to_caller: Send an SMS to the caller's phone. Use for appointment confirmations, addresses, details they ask to receive by text.
  IF FAILS: "I had trouble sending that — I'll make sure someone follows up with the details."
- send_calendar_invite: Send an SMS calendar invite after booking. Include address if available.
- After EVERY tool call, respond to the caller immediately. Never go silent after a tool runs.`;

          if (companyDescription) {
            prompt += `\n\nAbout ${cName}:\n${companyDescription}`;
          }

          if (companyKnowledge) {
            prompt += `\n\nKNOWLEDGE BASE — reference this to answer questions about ${cName}:\n${companyKnowledge}`;
          }

          return prompt;
        }

        const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
        let geminiKeepaliveInterval = null;

        async function connectGemini() {
          const currentSettings = loadSettings();
          let voiceName = currentSettings.voice || 'Kore';

          const VALID_GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
          let inboundGreeting = '';

          if (callCompanyId) {
            try {
              const crmSettings = await callBase44API('getSettings', callCompanyId);
              
              // Read name from intent_templates._assistant_display_name (mutable field inside JSON object)
              // Fallback chain: intent_templates._assistant_display_name > assistant_name > default "Sarah"
              const rawDisplayName = (crmSettings.settings?.intent_templates?._assistant_display_name || '').trim();
              const rawAssistantName = (crmSettings.settings?.assistant_name || '').trim();
              const rawBrandName = (crmSettings.settings?.brand_short_name || '').trim();
              console.log(`[Sarah] Raw DB fields: display_name="${rawDisplayName}", assistant_name="${rawAssistantName}", brand="${rawBrandName}"`);
              
              // Set company name
              if (rawBrandName) {
                companyName = rawBrandName;
              } else if (crmSettings.companyName) {
                companyName = crmSettings.companyName;
              }
              
              // Set assistant name: display_name takes priority (it's stored in a mutable JSON field)
              if (rawDisplayName) {
                assistantName = rawDisplayName.charAt(0).toUpperCase() + rawDisplayName.slice(1);
              } else if (rawAssistantName) {
                assistantName = rawAssistantName.charAt(0).toUpperCase() + rawAssistantName.slice(1);
              }
              console.log(`[Sarah] Resolved names: assistant="${assistantName}", company="${companyName}"`);
              
              console.log(`[${assistantName}] CRM voice fields: voice_id="${crmSettings.settings?.voice_id || ''}", voice="${crmSettings.settings?.voice || ''}", local="${currentSettings.voice || ''}"`);
              if (crmSettings.settings?.voice_id && VALID_GEMINI_VOICES.includes(crmSettings.settings.voice_id)) {
                voiceName = crmSettings.settings.voice_id;
                console.log(`[${assistantName}] Using CRM voice_id: ${voiceName}`);
              } else if (crmSettings.settings?.voice && VALID_GEMINI_VOICES.includes(crmSettings.settings.voice)) {
                voiceName = crmSettings.settings.voice;
                console.log(`[${assistantName}] Using CRM voice: ${voiceName}`);
              } else if (currentSettings.voice && VALID_GEMINI_VOICES.includes(currentSettings.voice)) {
                voiceName = currentSettings.voice;
                console.log(`[${assistantName}] Using LOCAL voice setting: ${voiceName}`);
              }
              if (!VALID_GEMINI_VOICES.includes(voiceName)) {
                console.warn(`[${assistantName}] Voice "${voiceName}" is not valid for Gemini. Falling back to Kore. Valid voices: ${VALID_GEMINI_VOICES.join(', ')}`);
                voiceName = 'Kore';
              }
              if (crmSettings.customSystemPrompt) {
                subscriberSystemPrompt = crmSettings.customSystemPrompt;
                console.log(`[${assistantName}] Loaded subscriber custom prompt (${subscriberSystemPrompt.length} chars)`);
              }
              if (crmSettings.knowledgeBase) {
                companyKnowledge = crmSettings.knowledgeBase;
                console.log(`[${assistantName}] Loaded knowledge base (${companyKnowledge.length} chars)`);
              }
              if (crmSettings.companyDescription) {
                companyDescription = crmSettings.companyDescription;
              }
              if (crmSettings.companyServices) {
                companyDescription += (companyDescription ? '\n' : '') + 'Services: ' + crmSettings.companyServices;
              }
              if (crmSettings.settings?.inbound_greeting) {
                inboundGreeting = crmSettings.settings.inbound_greeting;
                console.log(`[${assistantName}] Custom inbound greeting loaded`);
              }
              if (crmSettings.settings?.scheduling_defaults) {
                schedulingDefaults = crmSettings.settings.scheduling_defaults;
              }
              console.log(`[${assistantName}] Loaded CRM settings: company=${companyName}, assistant=${assistantName}, voice=${voiceName}`);
            } catch (e) {
              console.warn(`[${assistantName}] Could not load CRM settings, using defaults:`, e.message);
            }
          }

          console.log(`[${assistantName}] Connecting to Gemini Live API with voice: ${voiceName}...`);
          console.log(`[${assistantName}] CRM integration: ${BASE44_API_URL ? 'ENABLED' : 'DISABLED'}`);
          geminiWs = new WebSocket(geminiUrl);

          geminiWs.on('open', () => {
            console.log(`[${assistantName}] Connected to Gemini, sending setup with CRM tools...`);

            const setupMsg = {
              setup: {
                model: "models/gemini-2.5-flash-native-audio-latest",
                generation_config: {
                  response_modalities: ["AUDIO"],
                  input_audio_transcription: {},
                  output_audio_transcription: {},
                  speech_config: {
                    voice_config: {
                      prebuilt_voice_config: { voice_name: voiceName }
                    }
                  },
                  thinking_config: {
                    thinking_budget: 0
                  }
                },
                system_instruction: {
                  parts: [{
                    text: (() => {
                      let p = buildSystemPrompt(companyName, assistantName);
                      if (schedulingDefaults) {
                        const schedStart = formatHour12(schedulingDefaults.business_hours_start ?? 9);
                        const schedEnd = formatHour12(schedulingDefaults.business_hours_end ?? 17);
                        const schedDur = parseInt(schedulingDefaults.duration_min) || 45;
                        p += `\n\nSCHEDULING: Business hours are ${schedStart}–${schedEnd}. Appointments are ${schedDur} minutes each. Always call check_availability first to get real open slots, then offer those exact times to the caller. After the caller confirms a time, call book_appointment with that exact ISO datetime. Never invent or guess available times — only offer what check_availability returns.`;
                      }
                      return p;
                    })()
                  }]
                },
                tools: [{
                  function_declarations: CRM_TOOLS
                }]
              }
            };

            geminiWs.send(JSON.stringify(setupMsg));
          });

          geminiWs.on('message', async (raw) => {
            try {
              const data = JSON.parse(raw.toString());

              if (data.setupComplete) {
                console.log(`[${assistantName}] Gemini setup complete (with CRM tools), sending greeting as "${assistantName}" for "${companyName}" (outbound: ${isOutboundCall})...`);
                setupComplete = true;

                if (geminiKeepaliveInterval) clearInterval(geminiKeepaliveInterval);
                geminiKeepaliveInterval = setInterval(() => {
                  if (geminiWs?.readyState === WebSocket.OPEN) {
                    geminiWs.send(JSON.stringify({
                      realtime_input: {
                        media_chunks: [{
                          mime_type: "audio/pcm;rate=16000",
                          data: Buffer.alloc(320).toString('base64')
                        }]
                      }
                    }));
                  } else {
                    clearInterval(geminiKeepaliveInterval);
                  }
                }, 5000);
                let returningLeadContext = '';
                if (callerPhone && callCompanyId) {
                  try {
                    const priorComms = await callBase44API('getLeadHistory', callCompanyId, { phone: callerPhone });
                    if (priorComms && priorComms.leadName) {
                      returningLeadContext = `\n\nRETURNING CALLER CONTEXT: This caller (${callerPhone}) is ${priorComms.leadName}. `;
                      if (priorComms.lastInteraction) returningLeadContext += `Last interaction: ${priorComms.lastInteraction}. `;
                      if (priorComms.serviceNeeded) returningLeadContext += `They previously inquired about: ${priorComms.serviceNeeded}. `;
                      if (priorComms.notes) returningLeadContext += `Notes: ${priorComms.notes}. `;
                      returningLeadContext += `Greet them by name and reference your prior conversation. Don't ask for info you already have.`;
                      console.log(`[${assistantName}] Returning lead detected: ${priorComms.leadName}`);
                    }
                  } catch (e) {
                    console.log(`[${assistantName}] No prior history found for ${callerPhone}`);
                  }
                }

                let greetingText;
                const TOOL_FALLBACK_REMINDER = ' If any CRM tool fails, say a brief warm fallback line (e.g. "I\'ll make sure someone follows up right away") and keep the conversation moving — never go silent or repeat yourself.';
                if (isForwardedCall && callRoutingMode === 'sarah_then_transfer') {
                  greetingText = `A customer just called ${forwardedRepName}'s line. Greet them warmly as ${assistantName}, an AI assistant for ${companyName}, answering for ${forwardedRepName}. YOU MUST identify yourself as an AI assistant in your opening line — this is legally required. Get their name and what they need, save with save_lead_details (assign to ${forwardedRepName}), then try transfer_call once. If it works, say you're connecting them. If it fails, do NOT retry — just tell them ${forwardedRepName} is tied up and offer to schedule an inspection or take a message. Remember your name is ${assistantName}.${returningLeadContext}${TOOL_FALLBACK_REMINDER}`;
                } else if (isForwardedCall) {
                  greetingText = `A customer just called ${forwardedRepName}'s line and it was forwarded to you. Greet them warmly as ${assistantName}, an AI assistant for ${companyName}, answering for ${forwardedRepName}. YOU MUST identify yourself as an AI assistant in your opening line — this is legally required. Remember your name is ${assistantName}. Any leads from this call should be assigned to ${forwardedRepName}.${returningLeadContext}${TOOL_FALLBACK_REMINDER}`;
                } else if (isOutboundCall) {
                  if (outboundCampaign && outboundCampaign.intro) {
                    const replaceVars = (t) => (t || '').replace(/\{agent\}/g, assistantName).replace(/\{brand\}/g, companyName).replace(/\{lead_name\}/g, outboundLeadName || 'the homeowner').replace(/\{lead_service\}/g, outboundLeadService || 'their inquiry');
                    const campaignIntro = replaceVars(outboundCampaign.intro);
                    const campaignPoints = outboundCampaign.points ? `\n\nTALKING POINTS:\n${replaceVars(outboundCampaign.points)}` : '';
                    const campaignGoals = outboundCampaign.goals ? `\n\nGOALS: ${outboundCampaign.goals}` : '';

                    let campaignTraining = '';
                    if (outboundCampaign.knowledge_base) {
                      campaignTraining += `\n\nCAMPAIGN KNOWLEDGE BASE:\n${outboundCampaign.knowledge_base}`;
                    }
                    if (outboundCampaign.tone_style) {
                      const toneMap = { warm_empathetic: 'Be warm, caring, and empathetic. Show genuine concern.', professional: 'Be polished and professional.', casual_friendly: 'Be casual and friendly, like talking to a neighbor.', direct_confident: 'Be direct and confident without being pushy.' };
                      campaignTraining += `\n\nTONE: ${toneMap[outboundCampaign.tone_style] || ''}`;
                    }
                    if (outboundCampaign.humor_level !== undefined) {
                      campaignTraining += ` Humor level: ${outboundCampaign.humor_level}% (${outboundCampaign.humor_level < 20 ? 'very serious' : outboundCampaign.humor_level < 50 ? 'light' : 'witty'}).`;
                    }
                    if (outboundCampaign.example_conversations && outboundCampaign.example_conversations.length > 0) {
                      campaignTraining += '\n\nEXAMPLE CONVERSATIONS (follow this style):';
                      outboundCampaign.example_conversations.forEach((ex, i) => {
                        campaignTraining += `\nExample ${i + 1}:\nCustomer: "${ex.customer}"\nYou: "${ex.sarah}"`;
                      });
                    }
                    if (outboundCampaign.objection_handling && outboundCampaign.objection_handling.length > 0) {
                      campaignTraining += '\n\nOBJECTION HANDLING:';
                      outboundCampaign.objection_handling.forEach(oh => {
                        campaignTraining += `\n- If they say: "${oh.objection}" → Respond: "${oh.response}"`;
                      });
                    }
                    if (outboundCampaign.dos && outboundCampaign.dos.length > 0) {
                      campaignTraining += '\n\nDO:';
                      outboundCampaign.dos.forEach(d => { campaignTraining += `\n- ${d}`; });
                    }
                    if (outboundCampaign.donts && outboundCampaign.donts.length > 0) {
                      campaignTraining += '\n\nDO NOT:';
                      outboundCampaign.donts.forEach(d => { campaignTraining += `\n- ${d}`; });
                    }

                    const aiIdText = replaceVars(outboundCampaign.ai_identification_text || "Hi, I'm {agent}, an AI assistant for {brand}.");
                    const aiIdLine = `\nIMPORTANT — LEGALLY REQUIRED: You MUST identify yourself as an AI assistant in your very first sentence. Say: "${aiIdText}"`;

                    let customGreetingLine = '';
                    if (outboundCampaign.custom_greeting) {
                      customGreetingLine = `\n\nCUSTOM OPENING LINE: Use this greeting: "${replaceVars(outboundCampaign.custom_greeting)}"`;
                    }

                    greetingText = `You are making an outbound call to ${outboundLeadName || 'a potential customer'}. ${campaignIntro}${aiIdLine}${customGreetingLine}${campaignPoints}${campaignGoals}${campaignTraining}\n\nRemember your name is ${assistantName}. Start the conversation now.${returningLeadContext}${TOOL_FALLBACK_REMINDER}`;
                  } else {
                    greetingText = `You are making an outbound call to ${outboundLeadName || 'a potential customer'}${outboundLeadService ? ' who inquired about ' + outboundLeadService : ''}. Introduce yourself as ${assistantName}, an AI assistant from ${companyName}, and ask if you're speaking with ${outboundLeadName || 'the homeowner'}. You MUST identify yourself as an AI assistant in your opening line — this is legally required. Then continue the conversation naturally. Remember your name is ${assistantName}.${returningLeadContext}${TOOL_FALLBACK_REMINDER}`;
                  }
                } else {
                  const inboundReplaceVars = (t) => (t || '').replace(/\{agent\}/g, assistantName).replace(/\{brand\}/g, companyName);
                  if (inboundGreeting) {
                    greetingText = `A customer just called. Use this custom opening: "${inboundReplaceVars(inboundGreeting)}". You MUST identify yourself as an AI assistant. Remember your name is ${assistantName}.${returningLeadContext}${TOOL_FALLBACK_REMINDER}`;
                  } else {
                    greetingText = `A customer just called. Greet them warmly as ${assistantName}, the AI assistant for ${companyName}. In your opening line, mention that you are an AI assistant. Remember, your name is ${assistantName}, not Sarah or any other name.${returningLeadContext}${TOOL_FALLBACK_REMINDER}`;
                  }
                }
                if (isOutboundCall) {
                  waitingForOutboundGreeting = true;
                  if (outboundGreetingGateTimer) clearTimeout(outboundGreetingGateTimer);
                  outboundGreetingGateTimer = setTimeout(() => {
                    if (waitingForOutboundGreeting) {
                      console.log(`[${assistantName}] Outbound greeting gate timed out — opening mic to caller`);
                      waitingForOutboundGreeting = false;
                    }
                  }, 10000);
                  console.log(`[${assistantName}] Outbound gate: blocking caller mic until Gemini starts speaking`);
                }
                geminiWs.send(JSON.stringify({
                  client_content: {
                    turns: [{
                      role: "user",
                      parts: [{ text: greetingText }]
                    }],
                    turn_complete: true
                  }
                }));
              }

              if (data.toolCall) {
                console.log('[Sarah] Gemini requested tool call:', JSON.stringify(data.toolCall));
                const functionCalls = data.toolCall.functionCalls || [];
                const toolResponses = [];

                if (geminiWs.readyState === WebSocket.OPEN) {
                  geminiWs.send(JSON.stringify({
                    client_content: {
                      turns: [{ role: "user", parts: [{ text: "[System: Tool call in progress. Say a brief filler like 'One sec, let me check on that' or 'Sure, pulling that up now' while waiting. Keep it under 8 words.]" }] }],
                      turn_complete: true
                    }
                  }));
                }

                for (const fc of functionCalls) {
                  let result;
                  try {
                    const toolPromise = handleToolCall(fc, callCompanyId, {
                      staffCellPhone,
                      forwardedRepName,
                      subscriberCache,
                      calledTwilioNumber,
                      callerPhone
                    });
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tool call timed out after 4s')), 4000));
                    result = await Promise.race([toolPromise, timeoutPromise]);
                  } catch (err) {
                    console.error(`[Sarah] Tool call ${fc.name} failed:`, err.message);
                    result = { error: err.message, status: 'failed' };
                  }
                  toolCallsMade.push(fc.name);
                  conversationLog.push({ role: 'Tool', text: `${fc.name}(${JSON.stringify(fc.args || {})})` });

                  if (fc.name === 'save_lead_details') {
                    const parsedArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                    if (parsedArgs.name) collectedCallerName = parsedArgs.name;
                    if (parsedArgs.phone) callerPhone = parsedArgs.phone;
                  }

                  if (fc.name === 'transfer_call' && result?.success && callSid) {
                    // Cell resolution already happened inside handleToolCall — use those results directly
                    const transferCellPhone = result.resolved_cell || staffCellPhone || '';
                    const transferRepName = result.resolved_name || forwardedRepName || '';

                    if (!transferCellPhone) {
                      console.error(`[Sarah] Cannot transfer: no cell phone found (handleToolCall should have caught this)`);
                    } else {
                      console.log(`[Sarah] TRANSFER requested: callSid=${callSid}, cell=${transferCellPhone}, rep=${transferRepName}`);
                      setTimeout(async () => {
                        try {
                          const twilioSettings = await callBase44API('getTwilioSettings', callCompanyId);
                          if (twilioSettings?.account_sid && twilioSettings?.auth_token) {
                            const tSid = twilioSettings.account_sid;
                            const tToken = twilioSettings.auth_token;
                            const authStr = Buffer.from(`${tSid}:${tToken}`).toString('base64');
                            const host = getPublicHost(null);
                            const transferUrl = `https://${host}/twiml/transfer?cellPhone=${encodeURIComponent(transferCellPhone)}&callerId=${encodeURIComponent(twilioSettings.main_phone_number || '')}&repName=${encodeURIComponent(transferRepName)}&callerPhone=${encodeURIComponent(callerPhone || '')}`;

                            const updateResp = await fetch(
                              `https://api.twilio.com/2010-04-01/Accounts/${tSid}/Calls/${callSid}.json`,
                              {
                                method: 'POST',
                                headers: {
                                  'Authorization': `Basic ${authStr}`,
                                  'Content-Type': 'application/x-www-form-urlencoded'
                                },
                                body: `Url=${encodeURIComponent(transferUrl)}&Method=POST`
                              }
                            );
                            console.log(`[Sarah] Transfer API response: ${updateResp.status}`);
                            saveCallToBase44();
                          } else {
                            console.error('[Sarah] Cannot transfer: Twilio settings not found');
                          }
                        } catch (err) {
                          console.error('[Sarah] Transfer failed:', err.message);
                        }
                      }, 2000);
                    }
                  }

                  const responseObj = (typeof result === 'object' && result !== null) ? result : { output: String(result) };
                  toolResponses.push({
                    id: fc.id,
                    name: fc.name,
                    response: responseObj
                  });
                }

                if (geminiWs.readyState === WebSocket.OPEN) {
                  const toolResponseMsg = {
                    tool_response: {
                      function_responses: toolResponses
                    }
                  };
                  console.log('[Sarah] Sending tool responses to Gemini:', JSON.stringify(toolResponseMsg));
                  geminiWs.send(JSON.stringify(toolResponseMsg));
                  console.log('[Sarah] Tool responses sent, sending nudge to resume speaking');

                  const toolNames = functionCalls.map(fc => fc.name).join(', ');
                  const nudgeMsg = {
                    client_content: {
                      turns: [{
                        role: "user",
                        parts: [{ text: `[System: ${toolNames} completed. Now respond to the caller naturally with the result. Keep it brief and conversational.]` }]
                      }],
                      turn_complete: true
                    }
                  };
                  geminiWs.send(JSON.stringify(nudgeMsg));
                } else {
                  console.error('[Sarah] Gemini WS not open when trying to send tool response, state:', geminiWs.readyState);
                }
              }

              if (data.serverContent?.outputTranscript) {
                // Sarah's audio response transcribed back to text via output_audio_transcription
                const sarahText = data.serverContent.outputTranscript;
                if (sarahText && sarahText.trim()) {
                  conversationLog.push({ role: assistantName, text: sarahText.trim() });
                  console.log(`[Sarah] Output transcript captured: "${sarahText.substring(0, 80)}..."`);
                }
              }

              if (data.serverContent?.inputTranscript) {
                const transcriptText = data.serverContent.inputTranscript;
                conversationLog.push({ role: 'Caller', text: transcriptText });
                
                // Log to DB for real-time dashboard
                try {
                  const pool = getLocalPool();
                  await pool.query(
                    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
                     VALUES ($1, 'Communication', $2, $3, NOW(), NOW())`,
                    [
                      `live_in_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                      callCompanyId,
                      JSON.stringify({
                        contact_phone: callerPhone,
                        direction: 'inbound',
                        communication_type: 'call',
                        message: transcriptText,
                        call_sid: callSid,
                        status: 'in-progress',
                        created_date: new Date().toISOString()
                      })
                    ]
                  );
                } catch (e) { console.error('[Sarah] Live log error:', e.message); }
              }

              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.text) {
                    const isThinking = /\*\*/.test(part.text) || part.text.includes('I\'m starting') || part.text.includes('I\'ve formulated') || part.text.includes('My immediate focus') || part.text.includes('I will leverage') || part.text.includes('The aim is') || part.text.includes('This fulfills');
                    if (!isThinking) {
                      conversationLog.push({ role: assistantName, text: part.text });
                      
                      // Log to DB for real-time dashboard
                      try {
                        const pool = getLocalPool();
                        await pool.query(
                          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
                           VALUES ($1, 'Communication', $2, $3, NOW(), NOW())`,
                          [
                            `live_out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                            callCompanyId,
                            JSON.stringify({
                              contact_phone: callerPhone,
                              direction: 'outbound',
                              communication_type: 'call',
                              message: part.text,
                              call_sid: callSid,
                              status: 'in-progress',
                              created_date: new Date().toISOString()
                            })
                          ]
                        );
                      } catch (e) { console.error('[Sarah] Live log error:', e.message); }
                    } else {
                      console.log('[Sarah] Filtered thinking text:', part.text.substring(0, 80));
                    }
                  }
                  if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
                    isSarahSpeaking = true;
                    if (echoGateCooldownTimer) { clearTimeout(echoGateCooldownTimer); echoGateCooldownTimer = null; }
                    if (!echoGateFailsafeTimer) {
                      echoGateFailsafeTimer = setTimeout(() => {
                        echoGateFailsafeTimer = null;
                        if (isSarahSpeaking) {
                          console.warn(`[${assistantName}] Echo gate failsafe fired — forcing isSarahSpeaking=false`);
                          isSarahSpeaking = false;
                          if (echoGateCooldownTimer) { clearTimeout(echoGateCooldownTimer); echoGateCooldownTimer = null; }
                        }
                      }, 5000);
                    }
                    if (waitingForOutboundGreeting) {
                      waitingForOutboundGreeting = false;
                      if (outboundGreetingGateTimer) { clearTimeout(outboundGreetingGateTimer); outboundGreetingGateTimer = null; }
                      console.log(`[${assistantName}] Outbound gate: Gemini started speaking — opening caller mic`);
                    }
                    if (currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
                      const mulawB64 = geminiToTwilio(part.inlineData.data);
                      twilioWs.send(JSON.stringify({
                        event: 'media',
                        streamSid: currentStreamSid,
                        media: { payload: mulawB64 }
                      }));
                    }
                  }
                }
              }

              if (data.serverContent?.turnComplete) {
                if (echoGateFailsafeTimer) { clearTimeout(echoGateFailsafeTimer); echoGateFailsafeTimer = null; }
                echoGateCooldownTimer = setTimeout(() => { isSarahSpeaking = false; echoGateCooldownTimer = null; }, 300);
              }

              if (data.serverContent?.interrupted) {
                console.log('[Sarah] Speech interrupted by caller');
                isSarahSpeaking = false;
                if (echoGateCooldownTimer) { clearTimeout(echoGateCooldownTimer); echoGateCooldownTimer = null; }
                if (echoGateFailsafeTimer) { clearTimeout(echoGateFailsafeTimer); echoGateFailsafeTimer = null; }
                if (currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
                  twilioWs.send(JSON.stringify({
                    event: 'clear',
                    streamSid: currentStreamSid
                  }));
                }
              }
            } catch (err) {
              console.error('[Sarah] Gemini message parse error:', err.message);
            }
          });

          geminiWs.on('close', (code, reason) => {
            console.log('[Sarah] Gemini disconnected:', code, reason?.toString());
            if (geminiKeepaliveInterval) {
              clearInterval(geminiKeepaliveInterval);
              geminiKeepaliveInterval = null;
            }

            const bailoutMsg = (outboundCampaign?.bailout_message) || "I'm having a technical glitch. I'll have a human manager call you right back. I apologize for the inconvenience.";
            if (callSid) {
              try {
                const activeSid = twilioSid || process.env.TWILIO_ACCOUNT_SID;
                const activeToken = twilioToken || process.env.TWILIO_AUTH_TOKEN;
                const safeMsg = bailoutMsg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const twiml = `<Response><Say voice="alice">${safeMsg}</Say><Hangup/></Response>`;
                const callUpdateUrl = `https://api.twilio.com/2010-04-01/Accounts/${activeSid}/Calls/${callSid}.json`;
                const authHeader = `Basic ${Buffer.from(`${activeSid}:${activeToken}`).toString('base64')}`;
                console.log(`[Sarah] Bailout: redirecting call ${callSid} to play disconnect message`);
                fetch(callUpdateUrl, {
                  method: 'POST',
                  headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: `Twiml=${encodeURIComponent(twiml)}`,
                }).then(r => {
                  if (r.ok) console.log('[Sarah] Bailout TTS delivered to caller successfully');
                  else r.text().then(t => console.warn('[Sarah] Bailout TTS failed:', t));
                }).catch(e => console.error('[Sarah] Bailout Twilio REST error:', e.message));
              } catch (e) {
                console.error('[Sarah] Bailout error:', e.message);
              }
            }
            if (callCompanyId) {
              callBase44API('createAlert', callCompanyId, {
                type: 'ai_disconnect',
                urgency: 'high',
                message: `AI call disconnected unexpectedly. Caller: ${callerPhone || 'unknown'}. Call SID: ${callSid}. The bailout message was played. A human should call back immediately.`,
                caller_phone: callerPhone
              }).catch(e => console.error('[Sarah] Bailout alert failed:', e.message));
            }

            saveCallToBase44();
          });

          geminiWs.on('error', (err) => {
            console.error('[Sarah] Gemini error:', err.message);
          });
        }

        twilioWs.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());

            if (msg.event === 'start') {
              currentStreamSid = msg.start.streamSid;
              callStartTime = Date.now();
              const customParams = msg.start.customParameters || {};
              if (customParams.companyId) {
                callCompanyId = customParams.companyId;
              }
              if (customParams.maxCallDuration) {
                maxCallDurationSec = parseInt(customParams.maxCallDuration) || 1800;
              }
              callSid = msg.start.callSid || null;
              callerPhone = customParams.callerPhone || null;
              if (customParams.direction === 'outbound' || customParams.outbound === 'true' || customParams.isOutbound === 'true') {
                isOutboundCall = true;
                outboundLeadName = customParams.leadName || '';
                outboundLeadService = customParams.leadService || '';
                outboundLeadAddress = customParams.leadAddress || '';
                // Build campaign from individual stream params (new approach avoids URL length limits)
                if (customParams.introScript || customParams.talkingPoints || customParams.callGoals) {
                  outboundCampaign = {
                    id: customParams.campaignId || '',
                    intro: customParams.introScript || '',
                    points: customParams.talkingPoints || '',
                    goals: customParams.callGoals || '',
                  };
                } else if (customParams.campaign) {
                  try { outboundCampaign = JSON.parse(customParams.campaign); } catch(e) { outboundCampaign = null; }
                }
                console.log(`[Sarah] OUTBOUND call started: lead=${outboundLeadName}, service=${outboundLeadService}, campaign=${outboundCampaign?.id || 'default'}`);
              }
              callRoutingMode = customParams.callRoutingMode || 'sarah_answers';
              staffCellPhone = customParams.staffCellPhone || '';
              if (customParams.forwardedRepName) {
                forwardedRepName = customParams.forwardedRepName;
              }
              if (customParams.forwardedRepEmail) {
                forwardedRepEmail = customParams.forwardedRepEmail;
              }
              if (customParams.forwardedRepPhone) {
                forwardedRepPhone = customParams.forwardedRepPhone;
              }
              if (customParams.isForwardedCall === 'true' || callRoutingMode === 'sarah_then_transfer' || callRoutingMode === 'forward_to_cell') {
                isForwardedCall = true;
                console.log(`[Sarah] ROUTED call: rep=${forwardedRepName}, email=${forwardedRepEmail}, routing=${callRoutingMode}, cell=${staffCellPhone}`);
              }
              const callDirection = isForwardedCall ? 'forwarded' : (isOutboundCall ? 'outbound' : 'inbound');
              console.log(`[Sarah] Stream started: ${currentStreamSid}, company: ${callCompanyId}, caller: ${callerPhone}, callSid: ${callSid}, direction: ${callDirection}, maxDuration: ${maxCallDurationSec}s`);

              setTimeout(() => {
                const elapsed = Math.round((Date.now() - callStartTime) / 1000);
                if (elapsed >= maxCallDurationSec - 5) {
                  console.log(`[${assistantName}] Call duration limit reached (${elapsed}s / ${maxCallDurationSec}s), ending call`);
                  saveCallToBase44();
                  geminiWs?.close();
                  twilioWs.close();
                }
              }, maxCallDurationSec * 1000);

              connectGemini();
            }

            if (msg.event === 'media' && geminiWs?.readyState === WebSocket.OPEN && setupComplete && !waitingForOutboundGreeting && !isSarahSpeaking) {
              const pcmB64 = twilioToGemini(msg.media.payload);
              geminiWs.send(JSON.stringify({
                realtime_input: {
                  media_chunks: [{
                    mime_type: "audio/pcm;rate=16000",
                    data: pcmB64
                  }]
                }
              }));
            }

            if (msg.event === 'stop') {
              console.log('[Sarah] Stream stopped');
              if (echoGateCooldownTimer) { clearTimeout(echoGateCooldownTimer); echoGateCooldownTimer = null; }
              geminiWs?.close();
            }
          } catch (err) {
            console.error('[Sarah] Twilio message error:', err.message);
          }
        });

        twilioWs.on('close', () => {
          console.log('[Sarah] Twilio stream closed');
          if (geminiKeepaliveInterval) {
            clearInterval(geminiKeepaliveInterval);
            geminiKeepaliveInterval = null;
          }
          saveCallToBase44();
          geminiWs?.close();
        });

        twilioWs.on('error', (err) => {
          console.error('[Sarah] Twilio stream error:', err.message);
        });
      });

      server.middlewares.use('/api/sarah-voice', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method === 'GET') {
          const settings = loadSettings();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(settings));
        } else if (req.method === 'POST' || req.method === 'PUT') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const current = loadSettings();
              const updated = { ...current, ...data };
              saveSettings(updated);
              console.log(`[Sarah] Voice settings updated:`, updated);
              if (data.voice && data.company_id && VALID_GEMINI_VOICES.includes(data.voice)) {
                try {
                  await pool.query(
                    `UPDATE generic_entities SET data = data || jsonb_build_object('voice_id', $2::text), updated_date = NOW() WHERE entity_type = 'AssistantSettings' AND company_id = $1`,
                    [data.company_id, data.voice]
                  );
                  console.log(`[Sarah] Voice updated in DB for company ${data.company_id}: ${data.voice}`);
                } catch (dbErr) {
                  console.error('[Sarah] Failed to update voice_id in DB:', dbErr.message);
                }
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, settings: updated }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
        }
      });

      server.middlewares.use('/api/sarah-voice-preview', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'POST only' }));
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const { voice, text } = JSON.parse(body);
            const voiceName = voice || 'Kore';
            const previewText = text || "Say in a friendly, professional tone: Hi there! This is your AI assistant calling from the roofing company. How can I help you today?";
            const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Gemini API key not configured' }));
              return;
            }

            console.log(`[Sarah] Generating real Gemini voice preview: voice=${voiceName}`);

            const geminiRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{
                    parts: [{ text: previewText }]
                  }],
                  generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                      voiceConfig: {
                        prebuiltVoiceConfig: {
                          voiceName: voiceName
                        }
                      }
                    }
                  }
                })
              }
            );

            if (!geminiRes.ok) {
              const errText = await geminiRes.text();
              console.error('[Sarah] Gemini TTS error:', geminiRes.status, errText);
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'Gemini TTS failed', details: errText }));
              return;
            }

            const geminiData = await geminiRes.json();
            const audioPart = geminiData?.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
            if (!audioPart) {
              console.error('[Sarah] No audio in Gemini response');
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'No audio returned from Gemini' }));
              return;
            }

            const pcmBase64 = audioPart.inlineData.data;
            const pcmBuffer = Buffer.from(pcmBase64, 'base64');

            const sampleRate = 24000;
            const numChannels = 1;
            const bitsPerSample = 16;
            const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
            const blockAlign = numChannels * (bitsPerSample / 8);
            const dataSize = pcmBuffer.length;
            const headerSize = 44;

            const wavBuffer = Buffer.alloc(headerSize + dataSize);
            wavBuffer.write('RIFF', 0);
            wavBuffer.writeUInt32LE(36 + dataSize, 4);
            wavBuffer.write('WAVE', 8);
            wavBuffer.write('fmt ', 12);
            wavBuffer.writeUInt32LE(16, 16);
            wavBuffer.writeUInt16LE(1, 20);
            wavBuffer.writeUInt16LE(numChannels, 22);
            wavBuffer.writeUInt32LE(sampleRate, 24);
            wavBuffer.writeUInt32LE(byteRate, 28);
            wavBuffer.writeUInt16LE(blockAlign, 32);
            wavBuffer.writeUInt16LE(bitsPerSample, 34);
            wavBuffer.write('data', 36);
            wavBuffer.writeUInt32LE(dataSize, 40);
            pcmBuffer.copy(wavBuffer, headerSize);

            console.log(`[Sarah] Gemini voice preview generated: WAV ${wavBuffer.length} bytes, voice=${voiceName}`);
            res.setHeader('Content-Type', 'audio/wav');
            res.setHeader('Content-Length', wavBuffer.length);
            res.end(wavBuffer);
          } catch (e) {
            console.error('[Sarah] Voice preview error:', e.message);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });

      // ============================================================
      // CACHE UPDATE ENDPOINT (dev)
      // ============================================================
      server.middlewares.use('/api/twilio/update-cache', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.phone_number && data.company_id) {
              setCachedSubscriber(data.phone_number, {
                companyId: data.company_id,
                companyName: data.company_name || '',
                repName: data.rep_name || '',
                repEmail: data.rep_email || '',
                cellPhone: data.cell_phone || '',
                routingMode: data.routing_mode || 'sarah_answers',
                twilioSid: data.twilio_sid || '',
                twilioToken: data.twilio_token || '',
                twilioPhone: data.phone_number,
                availabilityStatus: data.availability_status || 'available',
              });
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, cached: normalizePhone(data.phone_number) }));
            } else {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'phone_number and company_id required' }));
            }
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ============================================================
      // AUTO-PROVISIONING ENDPOINT (dev)
      // ============================================================
      server.middlewares.use('/api/twilio/auto-provision', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            const { account_sid, auth_token, phone_number, company_id, company_name, rep_name, rep_email, cell_phone, routing_mode } = data;
            if (!account_sid || !auth_token || !phone_number) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'account_sid, auth_token, and phone_number required' }));
              return;
            }
            const host = getPublicHost(req.headers);
            const voiceWebhookUrl = `https://${host}/twiml/voice`;
            const smsWebhookUrl = `https://${host}/api/whatsapp-webhook`;
            const statusCallbackUrl = `https://${host}/api/sarah-missed-call`;
            const normalizedPhone = normalizePhone(phone_number);
            const authStr = Buffer.from(`${account_sid}:${auth_token}`).toString('base64');

            const listResp = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalizedPhone)}`,
              { headers: { 'Authorization': `Basic ${authStr}` } }
            );
            const listData = await listResp.json();
            if (!listData.incoming_phone_numbers?.length) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `Phone number ${normalizedPhone} not found in your Twilio account.` }));
              return;
            }
            const phoneSid = listData.incoming_phone_numbers[0].sid;

            const updateBody = new URLSearchParams({
              VoiceUrl: voiceWebhookUrl, VoiceMethod: 'POST',
              SmsUrl: smsWebhookUrl, SmsMethod: 'POST',
              StatusCallback: statusCallbackUrl, StatusCallbackMethod: 'POST',
            });
            const updateResp = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers/${phoneSid}.json`,
              { method: 'POST', headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: updateBody.toString() }
            );
            const updateData = await updateResp.json();
            if (!updateResp.ok) {
              res.statusCode = updateResp.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: updateData.message || 'Failed to update webhooks', details: updateData }));
              return;
            }

            // Step 3: Create API Key for WebRTC token generation
            let apiKeySid = '', apiKeySecret = '';
            try {
              const keyResp = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Keys.json`,
                { method: 'POST', headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({ FriendlyName: 'CompanySync Browser Dialer' }).toString() }
              );
              const keyData = await keyResp.json();
              if (keyResp.ok && keyData.sid) {
                apiKeySid = keyData.sid;
                apiKeySecret = keyData.secret;
                console.log(`[AutoProvision] API Key created: ${apiKeySid}`);
              } else {
                console.warn('[AutoProvision] API Key creation failed:', JSON.stringify(keyData));
              }
            } catch (keyErr) {
              console.warn('[AutoProvision] API Key error:', keyErr.message);
            }

            // Step 4: Create TwiML App for browser-to-PSTN dialing
            const browserCallTwimlUrl = `https://${host}/api/twilio/browser-call-twiml`;
            let twimlAppSid = '';
            try {
              const appResp = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/Applications.json`,
                { method: 'POST', headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: new URLSearchParams({ FriendlyName: 'CompanySync Browser Dialer', VoiceUrl: browserCallTwimlUrl, VoiceMethod: 'POST' }).toString() }
              );
              const appData = await appResp.json();
              if (appResp.ok && appData.sid) {
                twimlAppSid = appData.sid;
                console.log(`[AutoProvision] TwiML App created: ${twimlAppSid}, URL: ${browserCallTwimlUrl}`);
              } else {
                console.warn('[AutoProvision] TwiML App creation failed:', JSON.stringify(appData));
              }
            } catch (appErr) {
              console.warn('[AutoProvision] TwiML App error:', appErr.message);
            }

            setCachedSubscriber(normalizedPhone, {
              companyId: company_id || '', companyName: company_name || '',
              repName: rep_name || '', repEmail: rep_email || '',
              cellPhone: cell_phone || '', routingMode: routing_mode || 'sarah_answers',
              twilioSid: account_sid, twilioToken: auth_token, twilioPhone: normalizedPhone,
              availabilityStatus: 'available',
            });

            // Persist to call_routing_cache DB so routing survives server restarts
            try {
              const { getPool } = await import('./db/schema.js');
              const dbPool = getPool();
              if (dbPool) {
                await dbPool.query(
                  `INSERT INTO call_routing_cache (phone_number, company_id, company_name, assistant_name, routing_mode, cell_phone, rep_name, rep_email, availability_status)
                   VALUES ($1, $2, $3, 'sarah', $4, $5, $6, $7, 'available')
                   ON CONFLICT (phone_number) DO UPDATE SET
                     company_id = EXCLUDED.company_id, company_name = EXCLUDED.company_name,
                     routing_mode = EXCLUDED.routing_mode, cell_phone = EXCLUDED.cell_phone,
                     rep_name = EXCLUDED.rep_name, rep_email = EXCLUDED.rep_email`,
                  [normalizedPhone, company_id || '', company_name || '', routing_mode || 'sarah_answers', cell_phone || '', rep_name || '', rep_email || '']
                );
                // Also update the staff profile's twilio_number column if rep_email is known
                if (rep_email) {
                  await dbPool.query(
                    `UPDATE staff_profiles SET twilio_number = $1, updated_at = NOW() WHERE (user_email = $2 OR email = $2) AND company_id = $3`,
                    [normalizedPhone, rep_email, company_id || '']
                  );
                }
                console.log(`[AutoProvision] Persisted ${normalizedPhone} routing to DB for company ${company_id}`);
              }
            } catch (dbErr) {
              console.warn('[AutoProvision] DB persist error (non-fatal):', dbErr.message);
            }

            console.log(`[AutoProvision] Provisioned ${normalizedPhone}: voice=${voiceWebhookUrl}, sms=${smsWebhookUrl}`);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true, phone_sid: phoneSid,
              voice_webhook: voiceWebhookUrl, sms_webhook: smsWebhookUrl,
              browser_call_twiml_url: browserCallTwimlUrl,
              api_key_sid: apiKeySid, api_key_secret: apiKeySecret, twiml_app_sid: twimlAppSid,
              webrtc_ready: !!(apiKeySid && twimlAppSid),
              message: 'Webhooks configured. Sarah is ready to answer calls. Browser dialer is' + (apiKeySid && twimlAppSid ? ' active.' : ' not configured (API key creation failed).')
            }));
          } catch (err) {
            console.error('[AutoProvision] Error:', err.message);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ==========================================
      // CONFIGURE SINGLE NUMBER WEBHOOKS
      // ==========================================
      server.middlewares.use('/api/twilio/configure-number', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            const { account_sid, auth_token, phone_number, company_id, assigned_to_email } = data;
            if (!account_sid || !auth_token || !phone_number) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'account_sid, auth_token, and phone_number required' }));
              return;
            }
            const host = getPublicHost(req.headers);
            const voiceWebhookUrl = `https://${host}/twiml/voice`;
            const smsWebhookUrl = `https://${host}/api/whatsapp-webhook`;
            const statusCallbackUrl = `https://${host}/api/sarah-missed-call`;
            const normalizedPhone = normalizePhone(phone_number);
            const authStr = Buffer.from(`${account_sid}:${auth_token}`).toString('base64');

            const listResp = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalizedPhone)}`,
              { headers: { 'Authorization': `Basic ${authStr}` } }
            );
            const listData = await listResp.json();
            if (!listData.incoming_phone_numbers?.length) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `Phone number ${normalizedPhone} not found in your Twilio account.` }));
              return;
            }
            const phoneSid = listData.incoming_phone_numbers[0].sid;
            const updateBody = new URLSearchParams({
              VoiceUrl: voiceWebhookUrl, VoiceMethod: 'POST',
              SmsUrl: smsWebhookUrl, SmsMethod: 'POST',
              StatusCallback: statusCallbackUrl, StatusCallbackMethod: 'POST',
            });
            const updateResp = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers/${phoneSid}.json`,
              { method: 'POST', headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: updateBody.toString() }
            );
            if (!updateResp.ok) {
              const errData = await updateResp.json().catch(() => ({}));
              res.statusCode = updateResp.status;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: errData.message || 'Failed to update webhooks' }));
              return;
            }

            if (assigned_to_email && company_id) {
              const { getPool } = await import('./db/schema.js');
              const pool = getPool();
              const assigned_to_name = data.assigned_to_name || assigned_to_email;
              const cellPhone = data.cell_phone ? data.cell_phone.replace(/[^\d+]/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^1(\d{10})$/, '+1$1') : null;
              const updateResult = await pool.query(
                `UPDATE staff_profiles SET twilio_number = $1, ${cellPhone ? 'cell_phone = $4,' : ''} updated_at = NOW()
                 WHERE (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2)) AND company_id = $3`,
                cellPhone ? [normalizedPhone, assigned_to_email, company_id, cellPhone] : [normalizedPhone, assigned_to_email, company_id]
              );
              if (updateResult.rowCount === 0) {
                // No existing staff_profiles row — create one so routing works
                const newId = 'sp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
                await pool.query(
                  `INSERT INTO staff_profiles (id, company_id, full_name, name, user_email, email, twilio_number, cell_phone, is_active, created_at, updated_at)
                   VALUES ($1, $2, $3, $3, $4, $4, $5, $6, true, NOW(), NOW())
                   ON CONFLICT (id) DO UPDATE SET twilio_number = EXCLUDED.twilio_number, cell_phone = COALESCE(EXCLUDED.cell_phone, staff_profiles.cell_phone), updated_at = NOW()`,
                  [newId, company_id, assigned_to_name, assigned_to_email, normalizedPhone, cellPhone || null]
                );
                console.log(`[ConfigureNumber] Created staff_profiles row for ${assigned_to_email} twilio=${normalizedPhone} cell=${cellPhone || 'none'}`);
              } else {
                console.log(`[ConfigureNumber] Updated staff_profiles for ${assigned_to_email} twilio=${normalizedPhone} cell=${cellPhone || 'unchanged'}`);
              }
            }

            console.log(`[ConfigureNumber] Webhooks configured for ${normalizedPhone}`);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, message: `Webhooks configured for ${normalizedPhone}` }));
          } catch (err) {
            console.error('[ConfigureNumber] Error:', err.message);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        });
      });

      // ==========================================
      // WEBRTC TOKEN ENDPOINT
      // ==========================================
      server.middlewares.use('/api/twilio/webrtc-token', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
        if (req.method !== 'GET') { res.statusCode = 405; res.end(); return; }
        (async () => {
          try {
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const companyId = url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
            const identity = url.searchParams.get('identity') || 'agent';
            const { getPool } = await import('./db/schema.js');
            const pool = getPool();
            const settings = await pool.query(
              "SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1",
              [companyId]
            ).then(r => r.rows[0]?.data || {}).catch(() => ({}));
            const accountSid = settings.account_sid || process.env.TWILIO_ACCOUNT_SID;
            const apiKeySid = settings.api_key_sid;
            const apiKeySecret = settings.api_key_secret;
            const twimlAppSid = settings.twiml_app_sid;
            if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'WebRTC not configured. Please re-run "Connect Sarah to This Number" in Twilio Setup.' }));
              return;
            }
            const token = generateTwilioToken(accountSid, apiKeySid, apiKeySecret, identity, twimlAppSid);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ token, identity }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: err.message }));
          }
        })();
      });

      // ==========================================
      // BROWSER CALL TWIML (called by Twilio when browser places a call)
      // ==========================================
      server.middlewares.use('/api/twilio/browser-call-twiml', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', async () => {
          try {
            const params = new URLSearchParams(body);
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const to = params.get('To') || url.searchParams.get('To') || '';
            const companyId = params.get('CompanyId') || url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
            const contactName = params.get('ContactName') || url.searchParams.get('contactName') || '';
            const callSid = params.get('CallSid') || '';
            const host = getPublicHost(req.headers);
            const transcriptionCallbackUrl = `https://${host}/api/twilio/transcription-done?companyId=${encodeURIComponent(companyId)}&contactName=${encodeURIComponent(contactName)}`;
            const { getPool } = await import('./db/schema.js');
            const pool = getPool();
            const settings = await pool.query(
              "SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1",
              [companyId]
            ).then(r => r.rows[0]?.data || {}).catch(() => ({}));
            // Use rep's dedicated Twilio number if provided, otherwise fall back to company main
            const repPhone = (params.get('RepPhone') || url.searchParams.get('RepPhone') || '').replace(/[^\d+]/g, '');
            const callerId = (repPhone ? (repPhone.startsWith('+') ? repPhone : `+1${repPhone}`) : null)
              || settings.main_phone_number || process.env.TWILIO_PHONE_NUMBER || '';
            const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="30">
    <Number>${to}</Number>
  </Dial>
</Response>`;
            res.setHeader('Content-Type', 'text/xml');
            res.end(twiml);
            console.log(`[Dialer] Browser call TwiML: to=${to}, from=${callerId}, company=${companyId}${repPhone ? ' (rep line)' : ''}`);
          } catch (err) {
            const errTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>We're sorry, the call could not be connected. Please try again.</Say></Response>`;
            res.setHeader('Content-Type', 'text/xml');
            res.end(errTwiml);
          }
        });
      });

      // ==========================================
      // TRANSCRIPTION WEBHOOK (called by Twilio when transcription is ready)
      // ==========================================
      server.middlewares.use('/api/twilio/transcription-done', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', async () => {
          try {
            const params = new URLSearchParams(body);
            const url = new URL(req.url || '', `http://${req.headers.host}`);
            const transcriptionText = params.get('TranscriptionText') || '';
            const callSid = params.get('CallSid') || '';
            const companyId = url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
            const contactName = url.searchParams.get('contactName') || '';
            if (transcriptionText && companyId) {
              let pool;
              try { const db = await import('./db/queries.js'); pool = db.getPool ? db.getPool() : null; } catch(e) {}
              if (!pool) { pool = (await import('./db/local-db.cjs')).default?.getPool?.(); }
              if (pool) {
                // Update existing communication record or create new one
                const existing = await pool.query(
                  "SELECT id FROM generic_entities WHERE entity_type='Communication' AND company_id=$1 AND data->>'call_sid'=$2 LIMIT 1",
                  [companyId, callSid]
                ).catch(() => ({ rows: [] }));
                if (existing.rows[0]) {
                  await pool.query(
                    "UPDATE generic_entities SET data = data || $1::jsonb WHERE id=$2",
                    [JSON.stringify({ transcript: transcriptionText, transcription_status: 'completed' }), existing.rows[0].id]
                  );
                } else {
                  const newId = `comm_trans_${Date.now()}`;
                  await pool.query(
                    "INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1,'Communication',$2,$3,NOW(),NOW()) ON CONFLICT DO NOTHING",
                    [newId, companyId, JSON.stringify({ id: newId, company_id: companyId, call_sid: callSid, contact_name: contactName, transcript: transcriptionText, transcription_status: 'completed', communication_type: 'call', direction: 'outbound', status: 'completed' })]
                  );
                }
                console.log(`[Dialer] Transcription saved for call ${callSid} (${transcriptionText.length} chars)`);
              }
            }
            res.statusCode = 204;
            res.end();
          } catch (err) {
            console.error('[Dialer] Transcription webhook error:', err.message);
            res.statusCode = 200;
            res.end('ok');
          }
        });
      });

      server.middlewares.use('/twiml/voice', (req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          let callerPhone = '';
          let calledNumber = '';
          try {
            const params = new URLSearchParams(body);
            callerPhone = params.get('From') || params.get('Caller') || '';
            calledNumber = params.get('To') || params.get('Called') || '';
          } catch (e) {}

          // === FAST PATH: Check in-memory cache first ===
          const urlParams = new URL(req.url || '', `http://${req.headers.host}`).searchParams;
          let cached = getCachedSubscriber(calledNumber);
          let resolvedCompanyId = urlParams.get('companyId') || cached?.companyId || null;
          let forwardedRepName = urlParams.get('repName') || cached?.repName || '';
          let forwardedRepEmail = urlParams.get('repEmail') || cached?.repEmail || '';
          let forwardedRepPhone = cached?.cellPhone || '';
          let isForwardedCall = !!(forwardedRepName || urlParams.get('forwarded') === 'true');
          let effectiveRoutingMode = cached?.routingMode || 'sarah_answers';
          let cellPhone = cached?.cellPhone || '';

          if (cached && cached.availabilityStatus === 'unavailable') {
            effectiveRoutingMode = 'sarah_answers';
          }

          // Cache miss: try local PostgreSQL first (fast), then Base44 API (slow)
          if (!cached && calledNumber) {
            console.log(`[Sarah] Cache miss for ${calledNumber}, trying local DB...`);

            // FAST PATH: Direct local PostgreSQL query (same process, no HTTP)
            try {
              const { getCallRouting, getStaffByTwilioNumber } = await import('./db/queries.js');

              const localRouting = await Promise.race([
                getCallRouting(calledNumber),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
              ]);

              if (localRouting) {
                const lr = localRouting;
                resolvedCompanyId = lr.company_id;
                forwardedRepName = lr.rep_name || '';
                forwardedRepEmail = lr.rep_email || '';
                forwardedRepPhone = lr.cell_phone || '';
                cellPhone = lr.cell_phone || '';
                effectiveRoutingMode = lr.availability_status === 'unavailable' ? 'sarah_answers' : (lr.routing_mode || 'sarah_answers');
                isForwardedCall = !!forwardedRepName;
                console.log(`[Sarah] Local DB routing: rep=${forwardedRepName}, mode=${effectiveRoutingMode}, cell=${cellPhone}`);
                setCachedSubscriber(calledNumber, {
                  companyId: resolvedCompanyId, companyName: lr.company_name || '', repName: forwardedRepName, repEmail: forwardedRepEmail,
                  cellPhone, routingMode: lr.routing_mode || 'sarah_answers',
                  twilioSid: lr.twilio_sid || '', twilioToken: lr.twilio_token || '', twilioPhone: calledNumber,
                  availabilityStatus: lr.availability_status || 'available',
                });
                cached = getCachedSubscriber(calledNumber);
              }

              // Also check staff_profiles in local DB
              if (!cached) {
                const staffRow = await Promise.race([
                  getStaffByTwilioNumber(calledNumber),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
                ]);

                if (staffRow) {
                  resolvedCompanyId = staffRow.company_id;
                  forwardedRepName = staffRow.name || '';
                  forwardedRepEmail = staffRow.email || '';
                  forwardedRepPhone = staffRow.cell_phone || '';
                  cellPhone = staffRow.cell_phone || '';
                  effectiveRoutingMode = staffRow.availability_status === 'unavailable' ? 'sarah_answers' : (staffRow.call_routing_mode || 'sarah_answers');
                  isForwardedCall = true;
                  console.log(`[Sarah] Local DB staff routing: rep=${forwardedRepName}, mode=${effectiveRoutingMode}`);
                  setCachedSubscriber(calledNumber, {
                    companyId: resolvedCompanyId, companyName: '', repName: forwardedRepName, repEmail: forwardedRepEmail,
                    cellPhone, routingMode: staffRow.call_routing_mode || 'sarah_answers',
                    twilioSid: '', twilioToken: '', twilioPhone: calledNumber,
                    availabilityStatus: staffRow.availability_status || 'available',
                  });
                  cached = getCachedSubscriber(calledNumber);
                }
              }
            } catch (e) { console.log(`[Sarah] Local DB lookup failed (will try Base44):`, e.message); }
          }

          // SLOW PATH: Full Base44 API fallback (only if local DB didn't resolve)
          if (!cached && !resolvedCompanyId && calledNumber && BASE44_API_URL) {
            console.log(`[Sarah] Local DB miss, falling back to Base44 API for ${calledNumber}...`);
            try {
              const lookup = await callBase44API('lookupByPhone', null, { phone_number: calledNumber });
              if (lookup?.success && lookup.company_id) {
                resolvedCompanyId = lookup.company_id;
              }
            } catch (e) { console.warn(`[Sarah] Base44 lookup failed:`, e.message); }

            if (resolvedCompanyId) {
              try {
                const staffLookup = await callBase44API('lookupStaffByTwilioNumber', resolvedCompanyId, { twilio_number: calledNumber });
                if (staffLookup?.success && staffLookup.staff) {
                  const staff = staffLookup.staff;
                  isForwardedCall = true;
                  forwardedRepName = staff.full_name || '';
                  forwardedRepEmail = staff.email || '';
                  forwardedRepPhone = staff.cell_phone || staff.phone || '';
                  cellPhone = staff.cell_phone || staff.phone || '';
                  effectiveRoutingMode = staff.availability_status === 'unavailable' ? 'sarah_answers' : (staff.call_routing_mode || 'sarah_answers');
                  console.log(`[Sarah] Base44 staff routing: rep=${forwardedRepName}, mode=${effectiveRoutingMode}, cell=${cellPhone}`);
                  setCachedSubscriber(calledNumber, {
                    companyId: resolvedCompanyId, companyName: '', repName: forwardedRepName, repEmail: forwardedRepEmail,
                    cellPhone: cellPhone, routingMode: staff.call_routing_mode || 'sarah_answers',
                    twilioSid: '', twilioToken: '', twilioPhone: calledNumber,
                    availabilityStatus: staff.availability_status || 'available',
                  });
                }
              } catch (e) { console.log(`[Sarah] Base44 staff lookup: not a staff number`); }
            }
          }

          if (!resolvedCompanyId) {
            console.warn(`[Sarah] REJECTED: No subscriber for ${calledNumber}`);
            res.setHeader('Content-Type', 'text/xml');
            res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We're sorry, this number is not configured for AI voice service.</Say><Hangup/></Response>`);
            return;
          }

          if (cached) {
            isForwardedCall = true;
            console.log(`[Sarah] CACHE HIT: ${calledNumber} -> company=${resolvedCompanyId}, rep=${forwardedRepName}, routing=${effectiveRoutingMode}`);
          }

          let maxCallDuration = 1800;
          if (BASE44_API_URL) {
            try {
              const accessCheck = await callBase44API('checkVoiceAccess', resolvedCompanyId);
              if (accessCheck?.allowed === false) {
                res.setHeader('Content-Type', 'text/xml');
                res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Voice service is unavailable. ${accessCheck.reason || ''}</Say><Hangup/></Response>`);
                return;
              }
              if (accessCheck?.max_call_duration_seconds) maxCallDuration = accessCheck.max_call_duration_seconds;
            } catch (e) { console.warn(`[Sarah] Access check failed, allowing:`, e.message); }
          }

          if (effectiveRoutingMode === 'forward_to_cell' && cellPhone) {
            // Detect self-call: caller IS the rep's cell phone (e.g. rep testing their own number)
            const normalizePhone = p => (p || '').replace(/\D/g, '').slice(-10);
            const isSelfCall = normalizePhone(callerPhone) === normalizePhone(cellPhone);
            if (isSelfCall) {
              console.log(`[Sarah] SELF-CALL DETECTED: ${callerPhone} is the rep's own cell — routing to Sarah instead of forwarding`);
              // Fall through to Sarah WebSocket below
            } else {
              const forwardTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="${calledNumber}" timeout="20" action="https://${getPublicHost(req.headers)}/twiml/forward-fallback?companyId=${resolvedCompanyId}&amp;callerPhone=${encodeURIComponent(callerPhone)}&amp;repName=${encodeURIComponent(forwardedRepName)}&amp;repEmail=${encodeURIComponent(forwardedRepEmail)}&amp;maxDuration=${maxCallDuration}">
        <Number>${cellPhone}</Number>
    </Dial>
</Response>`;
              res.setHeader('Content-Type', 'text/xml');
              res.end(forwardTwiml);
              console.log(`[Sarah] FORWARD TO CELL: ${callerPhone} -> ${cellPhone} for ${forwardedRepName}`);
              return;
            }
          }

          const pubHost = getPublicHost(req.headers);
          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect record="record-from-answer" recordingStatusCallback="https://${pubHost}/api/twilio/recording-callback" recordingStatusCallbackMethod="POST">
        <Stream url="wss://${pubHost}/ws/twilio">
            <Parameter name="companyId" value="${resolvedCompanyId}" />
            <Parameter name="callerPhone" value="${callerPhone}" />
            <Parameter name="maxCallDuration" value="${maxCallDuration}" />
            <Parameter name="isForwardedCall" value="${isForwardedCall ? 'true' : 'false'}" />
            <Parameter name="forwardedRepName" value="${forwardedRepName}" />
            <Parameter name="forwardedRepEmail" value="${forwardedRepEmail}" />
            <Parameter name="forwardedRepPhone" value="${forwardedRepPhone}" />
            <Parameter name="callRoutingMode" value="${effectiveRoutingMode}" />
            <Parameter name="staffCellPhone" value="${cellPhone}" />
            <Parameter name="calledNumber" value="${calledNumber}" />
        </Stream>
    </Connect>
</Response>`;
          res.setHeader('Content-Type', 'text/xml');
          res.end(twiml);
          console.log(`[Sarah] TwiML: caller=${callerPhone}, company=${resolvedCompanyId}, rep=${forwardedRepName}, routing=${effectiveRoutingMode}`);
        });
      });

      server.middlewares.use('/api/twilio/recording-callback', (req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          const params = new URLSearchParams(body);
          const callSid = params.get('CallSid') || '';
          const recordingUrl = params.get('RecordingUrl') || '';
          const recordingStatus = params.get('RecordingStatus') || '';
          console.log(`[Sarah] Recording callback: callSid=${callSid}, status=${recordingStatus}`);
          if (recordingStatus === 'completed' && recordingUrl && callSid) {
            const mp3Url = recordingUrl + '.mp3';
            try {
              const prodDb = require('./db/prod-db.cjs');
              const pool = prodDb.getPool();
              const { rows } = await pool.query(
                `UPDATE communications SET recording_url = $1, updated_at = NOW() WHERE data->>'call_sid' = $2 RETURNING id, data->>'transcription' AS transcript, company_id`,
                [mp3Url, callSid]
              );
              if (rows.length > 0) {
                console.log(`[Sarah] Recording URL saved for comm ${rows[0].id}: ${mp3Url}`);
                const transcript = rows[0].transcript || '';
                if (transcript && transcript.length > 10) {
                  (async () => {
                    try {
                      const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
                      if (!geminiKey) return;
                      const summaryResp = await fetch(
                        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            contents: [{ parts: [{ text: `Summarize this phone call transcript in ONE concise sentence (max 120 chars). Focus on the caller's intent and outcome.\n\nTranscript:\n${transcript}` }] }],
                            generationConfig: { maxOutputTokens: 100, temperature: 0.2 }
                          })
                        }
                      );
                      if (summaryResp.ok) {
                        const summaryData = await summaryResp.json();
                        const summary = summaryData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                        if (summary) {
                          await pool.query(`UPDATE communications SET ai_summary = $1, updated_at = NOW() WHERE data->>'call_sid' = $2`, [summary, callSid]);
                          console.log(`[Sarah] AI summary saved for callSid ${callSid}: ${summary}`);
                        }
                      }
                    } catch (e) { console.warn('[Sarah] AI summary generation failed:', e.message); }
                  })();
                }
              } else {
                console.warn(`[Sarah] No communication record found for callSid ${callSid}`);
              }
            } catch (e) { console.error('[Sarah] Recording callback DB error:', e.message); }
          }
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end('<Response/>');
        });
      });

      server.middlewares.use('/twiml/forward-fallback', (req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
          const companyId = urlParams.get('companyId') || '';
          const callerPhone = urlParams.get('callerPhone') || '';
          const repName = urlParams.get('repName') || '';
          const repEmail = urlParams.get('repEmail') || '';
          const maxDuration = urlParams.get('maxDuration') || '1800';

          let dialStatus = '';
          try {
            const params = new URLSearchParams(body);
            dialStatus = params.get('DialCallStatus') || '';
          } catch (e) {}

          let dialDuration = 0;
          try { dialDuration = parseInt(params.get('DialCallDuration') || '0', 10); } catch (e) {}
          console.log(`[Sarah] Forward fallback: dialStatus=${dialStatus}, dialDuration=${dialDuration}s, company=${companyId}, rep=${repName}`);

          // Only hang up if rep actually talked for >15s (real conversation). Short "completed" = voicemail auto-answer.
          if (dialStatus === 'completed' && dialDuration > 15) {
            const doneTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;
            res.setHeader('Content-Type', 'text/xml');
            res.end(doneTwiml);
            return;
          }

          // Rep did not answer — notify them and admins (non-blocking)
          if (companyId && (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed' || dialStatus === 'completed')) {
            const statusNote = dialStatus === 'no-answer' ? 'did not answer' : dialStatus === 'busy' ? 'was busy' : dialStatus === 'completed' ? 'went to voicemail' : 'call failed';
            notifyAdminsWithSms(companyId, {
              title: `📞 Forwarded call missed — ${callerPhone}`,
              message: `${repName || 'Rep'} ${statusNote}. Sarah took over the call with ${callerPhone}.`,
              type: 'missed_forwarded_call',
              linkUrl: '/SarahWorkspace',
              smsBody: `📞 Missed forwarded call from ${callerPhone}. ${repName || 'Rep'} ${statusNote}. Sarah covered it.`,
            }).catch(e => console.warn('[Sarah] Forward fallback notify error:', e.message));
          }

          const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${repName ? repName + ' is not available at the moment.' : 'The person you are trying to reach is not available right now.'} Let me connect you with our AI assistant who can help.</Say>
    <Connect>
        <Stream url="wss://${getPublicHost(req.headers)}/ws/twilio">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${callerPhone}" />
            <Parameter name="maxCallDuration" value="${maxDuration}" />
            <Parameter name="isForwardedCall" value="true" />
            <Parameter name="forwardedRepName" value="${repName}" />
            <Parameter name="forwardedRepEmail" value="${repEmail}" />
            <Parameter name="forwardedRepPhone" value="" />
            <Parameter name="callRoutingMode" value="sarah_answers" />
            <Parameter name="staffCellPhone" value="" />
        </Stream>
    </Connect>
</Response>`;
          res.setHeader('Content-Type', 'text/xml');
          res.end(fallbackTwiml);
          console.log(`[Sarah] Cell didn't answer (${dialStatus}), falling back to Sarah for company ${companyId}`);
        });
      });

      server.middlewares.use('/twiml/transfer', (req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
          const cellPhone = urlParams.get('cellPhone') || '';
          const callerIdNumber = urlParams.get('callerId') || '';
          const repName = urlParams.get('repName') || '';
          const callerPhone = urlParams.get('callerPhone') || '';

          if (!cellPhone) {
            const errorTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">I'm sorry, I don't have a phone number to transfer to. Let me continue helping you.</Say>
</Response>`;
            res.setHeader('Content-Type', 'text/xml');
            res.end(errorTwiml);
            return;
          }

          // Detect self-call: caller IS the rep's cell (e.g. rep testing their own number)
          const normalizePhone = p => (p || '').replace(/\D/g, '').slice(-10);
          const isSelfCall = callerPhone && normalizePhone(callerPhone) === normalizePhone(cellPhone);
          if (isSelfCall) {
            console.log(`[Sarah] TRANSFER SELF-CALL: ${callerPhone} is the rep's own cell — skipping transfer dial`);
            const selfCallTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">I detected that you are calling from the rep's own phone. Transfer skipped. How else can I help you?</Say>
</Response>`;
            res.setHeader('Content-Type', 'text/xml');
            res.end(selfCallTwiml);
            return;
          }

          const transferTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Let me transfer you to ${repName || 'your representative'} now. One moment please.</Say>
    <Dial callerId="${callerIdNumber || ''}" timeout="30">
        <Number>${cellPhone}</Number>
    </Dial>
    <Say voice="alice">I'm sorry, ${repName || 'the representative'} is not available right now. Please try again later or leave a message.</Say>
</Response>`;
          res.setHeader('Content-Type', 'text/xml');
          res.end(transferTwiml);
          console.log(`[Sarah] TRANSFER: connecting ${callerPhone} to ${cellPhone} for rep ${repName}`);
        });
      });

      server.middlewares.use('/twiml/outbound', async (req, res) => {
        let companyId = '';
        let leadPhone = '';
        let leadName = '';
        let leadService = '';
        let leadAddress = '';
        let maxCallDuration = 600;
        let campaignId = '';
        try {
          const url = new URL(req.url, `https://${getPublicHost(req.headers)}`);
          companyId = url.searchParams.get('companyId') || '';
          leadPhone = url.searchParams.get('leadPhone') || '';
          leadName = url.searchParams.get('leadName') || '';
          leadService = url.searchParams.get('leadService') || '';
          leadAddress = url.searchParams.get('leadAddress') || '';
          maxCallDuration = parseInt(url.searchParams.get('maxDuration') || '600') || 600;
          campaignId = url.searchParams.get('campaignId') || '';
        } catch (e) {}

        const publicHost = getPublicHost(req.headers);
        const wsUrl = `wss://${publicHost}/ws/twilio`;

        // Fetch campaign details from DB if we have a campaignId
        let introScript = '';
        let talkingPoints = '';
        let callGoals = '';

        let urlIntroScript = '';
        let urlTalkingPoints = '';
        let urlCallGoals = '';
        try {
          const url2 = new URL(req.url, `https://${getPublicHost(req.headers)}`);
          urlIntroScript = url2.searchParams.get('introScript') || '';
          urlTalkingPoints = url2.searchParams.get('talkingPoints') || '';
          urlCallGoals = url2.searchParams.get('callGoals') || '';
        } catch (e) {}

        if (campaignId) {
          try {
            const pool = getLocalPool();
            const { rows } = await pool.query(
              `SELECT data FROM generic_entities WHERE entity_type = 'OutboundCampaign' AND id = $1 LIMIT 1`,
              [campaignId]
            );
            if (rows.length > 0) {
              const c = rows[0].data;
              introScript = c.intro_script || '';
              talkingPoints = c.talking_points || '';
              callGoals = c.goals || '';
            }
          } catch (e) { console.error('[Sarah] Campaign fetch error:', e.message); }
        }

        if (!introScript && urlIntroScript) introScript = urlIntroScript;
        if (!talkingPoints && urlTalkingPoints) talkingPoints = urlTalkingPoints;
        if (!callGoals && urlCallGoals) callGoals = urlCallGoals;
        console.log(`[Sarah] TwiML/outbound: campaign=${campaignId}, introScript=${introScript ? 'yes' : 'empty'}, source=${introScript === urlIntroScript ? 'url-fallback' : 'db'}`);

        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${leadPhone}" />
            <Parameter name="leadName" value="${leadName}" />
            <Parameter name="leadService" value="${leadService}" />
            <Parameter name="leadAddress" value="${leadAddress}" />
            <Parameter name="maxCallDuration" value="${maxCallDuration}" />
            <Parameter name="isOutbound" value="true" />
            <Parameter name="campaignId" value="${campaignId}" />
            <Parameter name="introScript" value="${(introScript || '').substring(0, 1000)}" />
            <Parameter name="talkingPoints" value="${(talkingPoints || '').substring(0, 1000)}" />
            <Parameter name="callGoals" value="${(callGoals || '').substring(0, 500)}" />
        </Stream>
    </Connect>
</Response>`;

        res.setHeader('Content-Type', 'text/xml');
        res.end(twiml);
      });

      server.middlewares.use('/api/sarah-outbound-call', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            let { companyId, leadPhone, leadName, leadService, leadAddress, twilioAccountSid, twilioAuthToken, fromNumber } = data;

            if (!companyId || !leadPhone) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Missing required fields: companyId, leadPhone' }));
              return;
            }

            if (!twilioAccountSid || !twilioAuthToken || !fromNumber) {
              if (BASE44_API_URL) {
                try {
                  console.log(`[Sarah] Fetching Twilio config for company ${companyId} from Base44...`);
                  const twilioData = await callBase44API('getTwilioConfig', companyId);
                  if (twilioData && twilioData.account_sid) {
                    twilioAccountSid = twilioData.account_sid;
                    twilioAuthToken = twilioData.auth_token;
                    fromNumber = twilioData.main_phone_number;
                    console.log(`[Sarah] Got Twilio config: SID=${twilioAccountSid?.substring(0, 10)}..., from=${fromNumber}`);
                  } else {
                    console.warn('[Sarah] getTwilioConfig returned no credentials:', JSON.stringify(twilioData));
                  }
                } catch (e) {
                  console.warn('[Sarah] Failed to fetch Twilio config from Base44:', e.message);
                }
              }

              if (!twilioAccountSid || !twilioAuthToken || !fromNumber) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Twilio not configured for this company. Set up Twilio in Settings first.' }));
                return;
              }
            }

            const maxDuration = data.maxCallDuration || 600;
            const publicHost = getPublicHost(req.headers);
            const fallbackIntro = encodeURIComponent((data.introScript || '').substring(0, 500));
            const fallbackPoints = encodeURIComponent((data.talkingPoints || '').substring(0, 500));
            const fallbackGoals = encodeURIComponent((data.callGoals || '').substring(0, 300));
            const twimlUrl = `https://${publicHost}/twiml/outbound?companyId=${encodeURIComponent(companyId)}&leadPhone=${encodeURIComponent(leadPhone)}&leadName=${encodeURIComponent(leadName || '')}&leadService=${encodeURIComponent(leadService || '')}&leadAddress=${encodeURIComponent(leadAddress || '')}&maxDuration=${maxDuration}&campaignId=${encodeURIComponent(data.campaignId || '')}&introScript=${fallbackIntro}&talkingPoints=${fallbackPoints}&callGoals=${fallbackGoals}`;

            const cleanTo = leadPhone.replace(/[^\d+]/g, '');
            const cleanFrom = fromNumber.replace(/[^\d+]/g, '');

            const authStr = Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString('base64');
            const callParams = new URLSearchParams({
              To: cleanTo.startsWith('+') ? cleanTo : `+1${cleanTo}`,
              From: cleanFrom.startsWith('+') ? cleanFrom : `+1${cleanFrom}`,
              Url: twimlUrl,
              StatusCallback: `https://${publicHost}/api/sarah-call-status`,
              StatusCallbackEvent: 'initiated ringing answered completed',
              StatusCallbackMethod: 'POST',
              Timeout: '30',
              MachineDetection: 'Enable',
              MachineDetectionTimeout: '5',
            });

            console.log(`[Sarah] Initiating outbound call: to=${cleanTo}, from=${cleanFrom}, company=${companyId}, lead=${leadName}, twimlUrl=${twimlUrl}`);

            const twilioResp = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Calls.json`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${authStr}`,
                  'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: callParams.toString(),
              }
            );

            const twilioData = await twilioResp.json();

            if (!twilioResp.ok) {
              console.error(`[Sarah] Twilio outbound call failed (HTTP ${twilioResp.status}):`, JSON.stringify(twilioData));
              console.error(`[Sarah] Twilio error details: code=${twilioData.code}, status=${twilioData.status}, to=${cleanTo}, from=${cleanFrom}, accountSid=${twilioAccountSid?.substring(0, 10)}...`);
              res.statusCode = twilioResp.status === 401 ? 401 : 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ 
                error: twilioData.message || 'Failed to initiate call', 
                twilio_error_code: twilioData.code,
                twilio_status: twilioResp.status,
                details: twilioData 
              }));
              return;
            }

            console.log(`[Sarah] Outbound call initiated: SID=${twilioData.sid}, status=${twilioData.status}`);

            if (BASE44_API_URL) {
              try {
                await callBase44API('saveCallLog', companyId, {
                  caller_phone: leadPhone,
                  caller_name: leadName || 'Outbound Lead',
                  duration_seconds: 0,
                  transcript: '',
                  call_sid: twilioData.sid,
                  tool_calls_made: [],
                  assistant_name: 'Sarah',
                  direction: 'outbound',
                });
              } catch (e) {
                console.warn('[Sarah] Failed to pre-save outbound call log:', e.message);
              }
            }

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              success: true,
              callSid: twilioData.sid,
              status: twilioData.status,
              to: twilioData.to,
              from: twilioData.from,
            }));
          } catch (e) {
            console.error('[Sarah] Outbound call error:', e.message);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });

      server.middlewares.use('/api/sarah-call-status', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const params = new URLSearchParams(body);
            const callSid = params.get('CallSid') || '';
            const callStatus = params.get('CallStatus') || '';
            const answeredBy = params.get('AnsweredBy') || '';
            const callDurationSecs = parseInt(params.get('CallDuration') || '0');
            const toNumber = params.get('To') || '';
            const fromNumber = params.get('From') || '';
            console.log(`[Sarah] Call status update: SID=${callSid}, status=${callStatus}, answeredBy=${answeredBy}, duration=${callDurationSecs}s`);

            if (callStatus === 'completed' && callDurationSecs > 0) {
              let companyId = null;
              try {
                const { getCallRouting } = await import('./db/queries.js');
                const routingTo = await getCallRouting(toNumber);
                if (routingTo?.company_id) companyId = routingTo.company_id;
                if (!companyId) {
                  const routingFrom = await getCallRouting(fromNumber);
                  if (routingFrom?.company_id) companyId = routingFrom.company_id;
                }
              } catch (e) { console.warn('[Sarah] Could not resolve company for usage logging:', e.message); }

              if (companyId) {
                const minutes = Math.max(1, Math.ceil(callDurationSecs / 60));
                logUsageEvent(companyId, 'sarah', minutes).catch(() => {});
              }
            }
          } catch (e) { console.warn('[Sarah] call-status handler error:', e.message); }
          res.statusCode = 200;
          res.end('OK');
        });
      });

      server.middlewares.use('/api/whatsapp-webhook', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const params = new URLSearchParams(body);
            const from = params.get('From') || '';
            const to = params.get('To') || '';
            const messageBody = params.get('Body') || '';
            const messageSid = params.get('MessageSid') || '';
            const numMedia = parseInt(params.get('NumMedia') || '0');

            const isWhatsApp = from.startsWith('whatsapp:') || to.startsWith('whatsapp:');
            const cleanFrom = from.replace('whatsapp:', '');
            const cleanTo = to.replace('whatsapp:', '');

            console.log(`[Sarah] ${isWhatsApp ? 'WhatsApp' : 'SMS'} webhook: from=${cleanFrom}, to=${cleanTo}, body="${messageBody.substring(0, 100)}", SID=${messageSid}`);

            const normalizedTo = cleanTo.replace(/[^\d]/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^1(\d{10})$/, '+1$1').replace(/^(\d{11})$/, '+$1');
            const e164To = normalizedTo.startsWith('+') ? normalizedTo : `+${normalizedTo}`;

            let resolvedCompanyId = null;
            try {
              console.log(`[Sarah] Looking up company for phone: ${e164To}`);
              const { getCallRouting } = await import('./db/queries.js');
              const routing = await getCallRouting(e164To);
              if (routing) {
                resolvedCompanyId = routing.company_id;
                console.log(`[Sarah] SMS local routing hit: ${e164To} -> ${resolvedCompanyId}`);
              }
            } catch (e) { console.warn(`[Sarah] Local SMS lookup error: ${e.message}`); }

            if (!resolvedCompanyId) {
              try {
                const lookup = await callBase44API('lookupByPhone', null, { phone_number: e164To });
                if (lookup?.success && lookup.company_id) {
                  resolvedCompanyId = lookup.company_id;
                }
              } catch (e) {}
            }

            // Also check in-memory subscriber cache (set when "Connect to Sarah" is clicked)
            if (!resolvedCompanyId) {
              const cached = getCachedSubscriber(e164To);
              if (cached?.companyId) {
                resolvedCompanyId = cached.companyId;
                console.log(`[Sarah] SMS cache hit: ${e164To} -> ${resolvedCompanyId}`);
              }
            }

            if (!resolvedCompanyId) {
              console.log(`[Sarah] WhatsApp/SMS from ${cleanFrom} to unregistered number ${cleanTo}, ignoring`);
              res.setHeader('Content-Type', 'text/xml');
              res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
              return;
            }

            // Check if the `To` number matches a staff member's personal Twilio number.
            // If so, route the message to that rep's inbox and skip Sarah's auto-reply.
            let routedToRepStaff = null;
            if (!isWhatsApp) {
              try {
                const { getPool } = await import('./db/schema.js');
                const pool = getPool();
                const normalizedE164 = e164To;
                const staffResult = await pool.query(
                  `SELECT user_email, full_name, twilio_number FROM staff_profiles
                   WHERE company_id = $1
                     AND is_active = true
                     AND twilio_number IS NOT NULL
                     AND twilio_number != ''
                   ORDER BY full_name`,
                  [resolvedCompanyId]
                );
                for (const row of staffResult.rows) {
                  const n = (row.twilio_number || '').replace(/[^\d+]/g, '');
                  const norm = n.startsWith('+') ? n : (n.length === 10 ? `+1${n}` : n.length === 11 ? `+${n}` : n);
                  if (norm === normalizedE164) {
                    routedToRepStaff = row;
                    break;
                  }
                }
              } catch (e) { console.warn('[Sarah] Rep twilio_number lookup error:', e.message); }
            }

            if (routedToRepStaff) {
              // This message came in on a rep's personal Twilio number — save to inbox, no AI auto-reply.
              console.log(`[Sarah] SMS to rep number ${e164To} -> ${routedToRepStaff.full_name} (${routedToRepStaff.user_email}), routing to inbox`);
              try {
                const { getPool } = await import('./db/schema.js');
                const pool = getPool();
                const commId = `comm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                await pool.query(
                  `INSERT INTO communications
                     (id, company_id, communication_type, direction, contact_phone, contact_name,
                      body, message, status, is_read, data, created_at, updated_at)
                   VALUES ($1,$2,'sms','inbound',$3,$4,$5,$5,'received',false,$6,NOW(),NOW())`,
                  [
                    commId,
                    resolvedCompanyId,
                    cleanFrom,
                    cleanFrom,
                    messageBody,
                    JSON.stringify({
                      routed_to_rep_email: routedToRepStaff.user_email,
                      routed_to_rep_name: routedToRepStaff.full_name,
                      to_number: cleanTo,
                      message_sid: messageSid,
                    }),
                  ]
                );
              } catch (e) { console.warn('[Sarah] Failed to save rep-routed SMS to inbox:', e.message); }
              res.setHeader('Content-Type', 'text/xml');
              res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
            } else {
              try {
                const msgSettings = await callBase44API('getMessagingSettings', resolvedCompanyId);
                const whatsappEnabled = isWhatsApp ? (msgSettings?.whatsapp_enabled === true) : true;

                if (!whatsappEnabled) {
                  console.log(`[Sarah] WhatsApp disabled for company ${resolvedCompanyId}, ignoring message`);
                  res.setHeader('Content-Type', 'text/xml');
                  res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
                  return;
                }

                const aiResponse = await callBase44API('handleIncomingMessage', resolvedCompanyId, {
                  from: cleanFrom,
                  to: cleanTo,
                  body: messageBody,
                  message_sid: messageSid,
                  channel: isWhatsApp ? 'whatsapp' : 'sms',
                  num_media: numMedia
                });

                if (aiResponse?.reply) {
                  const responsePrefix = isWhatsApp ? '' : '';
                  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${responsePrefix}${aiResponse.reply}</Message></Response>`;
                  res.setHeader('Content-Type', 'text/xml');
                  res.end(twimlResponse);
                  logUsageEvent(resolvedCompanyId, 'sms_ai', 1).catch(() => {});
                } else {
                  res.setHeader('Content-Type', 'text/xml');
                  res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
                }
              } catch (e) {
                console.error(`[Sarah] WhatsApp/SMS processing error:`, e.message);
                res.setHeader('Content-Type', 'text/xml');
                res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
              }
            }
          } catch (e) {
            console.error('[Sarah] WhatsApp webhook error:', e.message);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/xml');
            res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
          }
        });
      });

      server.middlewares.use('/api/sarah-missed-call', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const params = new URLSearchParams(body);
            const callStatus = params.get('CallStatus') || '';
            const callerPhone = params.get('From') || params.get('Caller') || '';
            const calledNumber = params.get('To') || params.get('Called') || '';
            const callSid = params.get('CallSid') || '';

            if (callStatus !== 'no-answer' && callStatus !== 'busy' && callStatus !== 'failed') {
              res.statusCode = 200;
              res.end('OK');
              return;
            }

            console.log(`[Sarah] Missed call detected: from=${callerPhone}, to=${calledNumber}, status=${callStatus}`);

            let resolvedCompanyId = null;
            try {
              const { getCallRouting } = await import('./db/queries.js');
              const routing = await getCallRouting(calledNumber);
              if (routing) {
                resolvedCompanyId = routing.company_id;
                console.log(`[Sarah] Missed call local lookup: ${calledNumber} -> ${resolvedCompanyId}`);
              }
            } catch (e) {}

            if (!resolvedCompanyId) {
              try {
                const lookup = await callBase44API('lookupByPhone', null, { phone_number: calledNumber });
                if (lookup?.success && lookup.company_id) resolvedCompanyId = lookup.company_id;
              } catch (e) {}
            }

            if (!resolvedCompanyId) {
              res.statusCode = 200;
              res.end('OK');
              return;
            }

            // Always notify rep + admins about the missed call
            notifyAdminsWithSms(resolvedCompanyId, {
              title: `📵 Missed call from ${callerPhone}`,
              message: `A call to ${calledNumber} went unanswered (${callStatus}). No one picked up.`,
              type: 'missed_call',
              linkUrl: '/SarahWorkspace',
              smsBody: `📵 Missed call from ${callerPhone} on ${calledNumber}. Status: ${callStatus}. Check CompanySync.`,
            }).catch(e => console.warn('[Sarah] Missed call notify error:', e.message));

            try {
              const msgSettings = await callBase44API('getMessagingSettings', resolvedCompanyId);
              if (msgSettings?.missed_call_followup_enabled !== true) {
                console.log(`[Sarah] Missed call follow-up disabled for company ${resolvedCompanyId}`);
                res.statusCode = 200;
                res.end('OK');
                return;
              }

              await callBase44API('sendMissedCallFollowup', resolvedCompanyId, {
                caller_phone: callerPhone,
                called_number: calledNumber,
                call_sid: callSid,
                call_status: callStatus,
                channel: msgSettings.missed_call_channel || 'sms'
              });

              console.log(`[Sarah] Missed call follow-up sent to ${callerPhone} for company ${resolvedCompanyId}`);
            } catch (e) {
              console.error(`[Sarah] Missed call follow-up error:`, e.message);
            }

            res.statusCode = 200;
            res.end('OK');
          } catch (e) {
            console.error('[Sarah] Missed call webhook error:', e.message);
            res.statusCode = 200;
            res.end('OK');
          }
        });
      });

      server.middlewares.use('/api/messaging-settings', (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method === 'GET') {
          const url = new URL(req.url, `https://${getPublicHost(req.headers)}`);
          const companyId = url.searchParams.get('companyId');
          if (!companyId) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Missing companyId' }));
            return;
          }

          if (!BASE44_API_URL) {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              whatsapp_enabled: false,
              missed_call_followup_enabled: false,
              appointment_reminders_enabled: false,
              missed_call_channel: 'sms',
              missed_call_template: '',
              appointment_reminder_template: '',
              dedup_window_hours: 24
            }));
            return;
          }

          callBase44API('getMessagingSettings', companyId).then(settings => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(settings || {
              whatsapp_enabled: false,
              missed_call_followup_enabled: false,
              appointment_reminders_enabled: false,
              missed_call_channel: 'sms',
              missed_call_template: '',
              appointment_reminder_template: '',
              dedup_window_hours: 24
            }));
          }).catch(e => {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: e.message }));
          });
          return;
        }

        if (req.method === 'POST' || req.method === 'PUT') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const { companyId, ...settings } = data;
              if (!companyId) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Missing companyId' }));
                return;
              }

              if (!BASE44_API_URL) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, ...settings }));
                return;
              }

              const result = await callBase44API('saveMessagingSettings', companyId, settings);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, ...result }));
            } catch (e) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }

        res.statusCode = 405;
        res.end();
      });

      console.log('[Sarah] Twilio WebSocket bridge plugin loaded');
      console.log('[Sarah] TwiML endpoint: /twiml/voice (inbound)');
      console.log('[Sarah] TwiML endpoint: /twiml/outbound (outbound)');
      console.log('[Sarah] Outbound call API: /api/sarah-outbound-call');
      console.log('[Sarah] WhatsApp/SMS webhook: /api/whatsapp-webhook');
      console.log('[Sarah] Missed call handler: /api/sarah-missed-call');
      console.log('[Sarah] Messaging settings: /api/messaging-settings');
      console.log(`[Sarah] Public host resolved to: ${getPublicHost(null)}`);
      console.log('[Sarah] WebSocket endpoint: /ws/twilio');
      console.log(`[Sarah] CRM API: ${BASE44_API_URL ? 'configured' : 'NOT configured'}`);
    }
  };
}
