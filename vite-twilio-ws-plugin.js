import { WebSocketServer, WebSocket } from 'ws';
import { createHmac } from 'crypto';
import twilio from 'twilio';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'node:module';
import { notifyAdmins, notifyAdminsWithSms } from './vite-notification-helper.js';

const __require = createRequire(import.meta.url);
const { invalidateCallerCache: _invalidateCallerCache } = __require('./lib/lookupCallerByCrmPhone.cjs');
const { fetchWithRetry } = __require('./lib/fetchWithRetry.cjs');
const { getVerifiedLexiChannels, canonicalPhone } = __require('./lib/insuranceClaimWelcome.cjs');
const {
  getCustomerPublicProgress,
  buildVoiceProgressScript,
  isExactVoiceProgressTranscript,
} = __require('./lib/customerProjectProgress.cjs');
// The assistant is always "Alex"; stale AssistantSettings rows still say
// "sarah"/"lexi" and must not win. Logic is shared with prod-server.cjs.
const { ASSISTANT_NAME, resolveAssistantName } = __require('./lib/assistantName.cjs');
const callerMemory = __require('./lib/callerMemory.cjs');
const {
  deriveSpokenBrandName,
  applySpokenCompanyName,
  rewriteVoiceText,
} = __require('./lib/spokenBrandName.cjs');
const { toolDedupeKey, createToolCallCache } = __require('./lib/toolDedupe.cjs');
const { authorizeTwilioTenant, assertTwilioIdentityAvailable } = __require('./lib/twilioTenantGuard.cjs');
const {
  authorizeOutboundCall,
  consumeOutboundCallRateLimit,
  normalizeOutboundDestination,
} = __require('./lib/outboundCallGuard.cjs');
// Staff phone mode: caller-ID candidate match + spoken-PIN verification
// (shared with prod-server.cjs — logic lives ONCE in lib/staffVoiceAuth.cjs).
const {
  findStaffByCallerPhone,
  verifyPinAttempt,
  redactPinDigits,
  buildStaffPhonePrompt,
  VERIFY_STAFF_PIN_TOOL,
  MAX_ATTEMPTS_PER_CALL: STAFF_PIN_MAX_ATTEMPTS_PER_CALL,
} = __require('./lib/staffVoiceAuth.cjs');
// Verified staff callers get Lexi's FULL CRM tool set, executed by the same
// dev-side handler the in-app Lexi voice assistant uses (single source of truth).
import { LEXI_CRM_TOOLS, handleLocalToolCall as handleLexiLocalToolCall } from './vite-lexi-native-plugin.js';

// ============================================================
// SHARED PG POOL — one pool for the whole dev bridge (lockstep with
// prod-server.cjs, which already uses a single shared pool).
// Previously every lookup opened and closed its own pg.Pool, paying a
// fresh TCP+TLS+auth handshake per query — including per-transcription-
// chunk live logs DURING calls. That was a major source of dev-only
// latency/jitter. NEVER call .end() on this pool.
// ============================================================
let __sharedPgPool = null;
function getSharedPool() {
  if (!__sharedPgPool) {
    const { Pool } = __require('pg');
    __sharedPgPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
    __sharedPgPool.on('error', (e) => console.error('[SharedPgPool] Idle client error:', e.message));
  }
  return __sharedPgPool;
}


const SETTINGS_FILE = path.resolve('.sarah-voice-settings.json');

// ============================================================
// AI RECEPTIONIST ENHANCEMENTS — shared dev/prod logic.
// deriveSpokenBrandName lives once in lib/spokenBrandName.cjs.
// The transcript helpers below stay verbatim in prod-server.cjs.
// Keep those two in LOCKSTEP across both files.
// ============================================================

// Merge consecutive same-role conversation fragments into clean turns,
// then render a readable transcript string. Gemini's live transcription
// emits many tiny same-role chunks; this collapses them.
function buildCleanTranscript(conversationLog) {
  const merged = [];
  for (const e of (conversationLog || [])) {
    if (!e) continue;
    const text = String(e.text == null ? '' : e.text).trim();
    if (!text) continue;
    const role = e.role || 'unknown';
    const last = merged[merged.length - 1];
    if (last && last.role === role) last.text += ' ' + text;
    else merged.push({ role, text });
  }
  return merged.map((e) => `${e.role}: ${e.text}`).join('\n');
}

// Best-effort post-call synopsis via the Gemini text model. NEVER throws
// (returns null on any failure) and has a hard timeout so it can never
// block the call-log save.
async function generateCallSynopsis(transcript, apiKey) {
  if (!apiKey || !transcript || transcript.trim().length < 25) return null;
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are summarizing a phone call for a roofing company's CRM. Today is ${today}.
From the transcript below, return ONLY a JSON object with these keys:
- caller_name (string or null)
- phone (string or null)
- address (string or null)
- service_needed (string or null): what the caller wants (e.g. "roof leak repair", "free inspection", "quote")
- appointment_datetime (string or null): the date/time if an appointment or inspection was scheduled, otherwise null
- summary (string): a 1-3 sentence plain-English recap of the call
- next_action (string or null): the follow-up the team should take

TRANSCRIPT:
${transcript.slice(0, 8000)}`;
  try {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' },
        }),
      },
      { timeoutMs: 12000 }
    );
    if (!res.ok) { console.warn('[Synopsis] Gemini error:', res.status); return null; }
    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) return null;
    let parsed = null;
    try { parsed = JSON.parse(text); }
    catch (_) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch (__) {} } }
    if (!parsed || typeof parsed !== 'object') return null;
    const summary = (parsed.summary || '').toString().trim();
    if (!summary) return null;
    return { call_summary: summary, call_synopsis: parsed };
  } catch (e) {
    console.warn('[Synopsis] generateCallSynopsis failed:', e.message);
    return null;
  }
}

// ============================================================
// USAGE LOGGING — logs a SubscriptionUsage row to the DB
// Called after Sarah calls (per-minute), SMS AI replies, etc.
// ============================================================
const USAGE_UNIT_COSTS = { sarah: 0.10, sms_ai: 0.02, lexi: 0.05 };

async function logUsageEvent(companyId, feature, units = 1) {
  if (!companyId || companyId === 'companysync_master_001') return;
  try {
    const pool = getSharedPool();
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

function readBodyWithLimit(req, maxBytes = 1 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalBytes = 0;
    let limitExceeded = false;
    req.on('data', chunk => {
      if (limitExceeded) return;
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        limitExceeded = true;
        req.resume();
        return reject(Object.assign(new Error(`Request body too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB)`), { statusCode: 413 }));
      }
      body += chunk;
    });
    req.on('end', () => { if (!limitExceeded) resolve(body); });
    req.on('error', err => reject(err));
  });
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
    voice: 'Puck',
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
    const pool = getSharedPool();
    try {
      // Resolve Base44 ID → local company ID if needed
      const { rows: companyRows } = await pool.query(
        `SELECT id, name, data FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`,
        [companyId]
      );
      const company = companyRows[0] || {};
      const localCompanyId = company.id || companyId;

      // Latency: all five lookups below only depend on localCompanyId, so run
      // them in parallel instead of serially (this runs on the call-start hot
      // path before the greeting can be spoken). Same behavior on failure as
      // the old per-query try/catch: each one degrades to empty independently.
      const safeQuery = (sql, params) => pool.query(sql, params).then(r => r.rows).catch(() => []);
      const [settingsRows, staffRows, memories, articles, training] = await Promise.all([
        safeQuery(
          `SELECT data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND company_id = $1 ORDER BY (LOWER(BTRIM(COALESCE(data->>'assistant_name',''))) <> 'lexi') DESC, (LOWER(BTRIM(COALESCE(data->>'assistant_name',''))) IN ('sarah','')) DESC, COALESCE(updated_date > created_date + interval '5 seconds', false) DESC, updated_date DESC NULLS LAST LIMIT 1`,
          [localCompanyId]
        ),
        safeQuery(
          `SELECT full_name, role, cell_phone, twilio_number, availability_status FROM staff_profiles WHERE company_id = $1 AND is_active = true ORDER BY full_name`,
          [localCompanyId]
        ),
        safeQuery(
          `SELECT data FROM generic_entities WHERE entity_type = 'AIMemory' AND company_id = $1 AND (data->>'is_active')::boolean = true ORDER BY (data->>'importance')::int DESC NULLS LAST LIMIT 50`,
          [localCompanyId]
        ),
        safeQuery(
          `SELECT data FROM generic_entities WHERE entity_type = 'KnowledgeBaseArticle' AND company_id = $1 AND data->>'status' = 'published' LIMIT 30`,
          [localCompanyId]
        ),
        safeQuery(
          `SELECT data FROM generic_entities WHERE entity_type = 'AITrainingData' AND company_id = $1 AND data->>'status' = 'active' LIMIT 50`,
          [localCompanyId]
        ),
      ]);
      const settings = settingsRows[0]?.data || {};

      const companyName = settings.brand_short_name || company.name || company.data?.company_name || 'our company';
      const companyTimezone = company.data?.timezone || 'America/New_York';
      const assistantDisplayName = resolveAssistantName(
        settings.intent_templates?._assistant_display_name,
        settings.assistant_name
      );

      // Staff list so Sarah knows team members by name
      let staffContext = '';
      if (staffRows.length > 0) {
        staffContext = '\n\nTEAM MEMBERS:\n' + staffRows.map(s =>
          `- ${s.full_name}${s.role ? ` (${s.role})` : ''}${s.availability_status === 'available' ? ' — available' : ' — unavailable'}`
        ).join('\n');
      }

      let knowledgeParts = [];

      // Include inline knowledge_base text from AssistantSettings (same as prod-server)
      if (settings.knowledge_base) {
        knowledgeParts.push(settings.knowledge_base);
      }

      if (memories.length > 0) {
        knowledgeParts.push(memories.map(m => `- ${m.data?.title || ''}: ${m.data?.content || ''}`).join('\n'));
      }

      if (articles.length > 0) {
        knowledgeParts.push(articles.map(a => `- ${a.data?.title || ''}: ${(a.data?.content || a.data?.summary || '').substring(0, 500)}`).join('\n'));
      }

      if (training.length > 0) {
        knowledgeParts.push(training.map(t => `- ${t.data?.category || 'General'}: ${t.data?.content || ''}`).join('\n'));
      }

      if (staffContext) knowledgeParts.push(staffContext);

      const fullKnowledge = knowledgeParts.filter(Boolean).join('\n');
      console.log(`[localGetSettings] company=${companyName}, assistant=${assistantDisplayName}, timezone=${companyTimezone}, settings_keys=${Object.keys(settings).length}, localId=${localCompanyId}`);

      return {
        settings,
        companyName,
        assistantName: assistantDisplayName,
        timezone: companyTimezone,
        customSystemPrompt: settings.system_prompt || '',
        transferInstructions: settings.transfer_instructions || '',
        screeningEnabled: settings.screen_calls_enabled || false,
        screeningInstructions: settings.screening_instructions || '',
        knowledgeBase: fullKnowledge,
        companyDescription: company.data?.description || '',
        companyServices: company.data?.services || '',
        localCompanyId,
      };
    } finally {
    }
  } catch (err) {
    console.error('[localGetSettings] Error:', err.message);
    return { error: err.message };
  }
}

async function localGetMessagingSettings(companyId) {
  try {
    const pool = getSharedPool();
    try {
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
    } finally {}
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

    if (bookingUrl) {
      systemPrompt += `\n\nAPPOINTMENT BOOKING: When someone wants to schedule an appointment or inspection, include the booking link directly in your reply as plain text: ${bookingUrl} — do NOT say "I'm sending you a link" or "I'll send it now." Just include the link in this same message because this is your ONLY reply. Example: "You can grab a time here: ${bookingUrl}"`;
    } else {
      systemPrompt += `\n\nAPPOINTMENT BOOKING — CRITICAL: You are NOT able to send a second message, a follow-up, or a link. This single text reply is ALL you can send. NEVER say "I'm sending you a link," "I'll text you a link," or anything that promises a separate message — because nothing will arrive. Instead, collect their name, address, and preferred date/time one question at a time, and let them know a team member will call or text to confirm. If you say you're sending a link and don't, it destroys trust.`;
    }

    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[LocalSMS] GOOGLE_GEMINI_API_KEY not set');
      return { reply: null };
    }

    const geminiRes = await fetchWithRetry(
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
      },
      { timeoutMs: 20000 }
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
      const pool = getSharedPool();
      const commType = channel === 'whatsapp' ? 'whatsapp' : 'sms';
      try {
        // Look up contact name from customers or leads by phone number
        let contactName = from; // fallback to phone number
        try {
          const custRes = await pool.query(
            `SELECT name FROM customers WHERE company_id = $1 AND (phone = $2 OR phone_2 = $2 OR regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')) AND name IS NOT NULL AND name != '' LIMIT 1`,
            [localCompanyId, from]
          );
          if (custRes.rows.length > 0) {
            contactName = custRes.rows[0].name;
          } else {
            const leadRes = await pool.query(
              `SELECT name FROM leads WHERE company_id = $1 AND (phone = $2 OR regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')) AND name IS NOT NULL AND name != '' LIMIT 1`,
              [localCompanyId, from]
            );
            if (leadRes.rows.length > 0) contactName = leadRes.rows[0].name;
          }
        } catch (lookupErr) { console.warn('[LocalSMS] Contact name lookup failed:', lookupErr.message); }

        // Save inbound message to the communications table
        const inboundId = `comm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await pool.query(
          `INSERT INTO communications (id, company_id, communication_type, direction, contact_phone, contact_name, body, message, status, is_read, data, created_at, updated_at)
           VALUES ($1, $2, $3, 'inbound', $4, $5, $6, $6, 'delivered', false, $7, NOW(), NOW())`,
          [
            inboundId, localCompanyId, commType, from, contactName, body,
            JSON.stringify({ company_phone: to, message_sid, channel, ai_handled: true }),
          ]
        );
        // Save AI reply as outbound message
        if (reply) {
          const outboundId = `comm_${Date.now() + 1}_${Math.random().toString(36).slice(2, 8)}`;
          await pool.query(
            `INSERT INTO communications (id, company_id, communication_type, direction, contact_phone, contact_name, body, message, status, is_read, data, created_at, updated_at)
             VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $6, 'sent', true, $7, NOW(), NOW())`,
            [
              outboundId, localCompanyId, commType, from, contactName, reply,
              JSON.stringify({ company_phone: to, message_sid, channel, ai_sent: true }),
            ]
          );
        }
        console.log(`[LocalSMS] Saved ${commType} conversation for ${contactName} (${from})`);
      } finally {}
    } catch (logErr) {
      console.warn('[LocalSMS] Failed to log communication:', logErr.message);
    }

    // Resolve contact name for notifications (look up separately to keep notification clean)
    let notifContactName = from;
    try {
      const nPool = getSharedPool();
      const nCust = await nPool.query(`SELECT name FROM customers WHERE company_id = $1 AND (phone = $2 OR phone_2 = $2) AND name IS NOT NULL AND name != '' LIMIT 1`, [localCompanyId, from]);
      if (nCust.rows.length > 0) notifContactName = nCust.rows[0].name;
      else {
        const nLead = await nPool.query(`SELECT name FROM leads WHERE company_id = $1 AND phone = $2 AND name IS NOT NULL AND name != '' LIMIT 1`, [localCompanyId, from]);
        if (nLead.rows.length > 0) notifContactName = nLead.rows[0].name;
      }
    } catch (e) {}

    // Fire bell + email + SMS cell notification to admins for every inbound message (non-blocking)
    const callerSnippet = body ? `"${body.substring(0, 100)}"` : 'New inbound message';
    const replySnippet = reply ? `Sarah replied: "${reply.substring(0, 80)}"` : '';
    const displayName = notifContactName !== from ? `${notifContactName} (${from})` : from;
    notifyAdminsWithSms(localCompanyId, {
      title: `New message from ${notifContactName}`,
      message: `${callerSnippet}${replySnippet ? '\n\n' + replySnippet : ''}`,
      type: 'inbound_sms',
      linkUrl: '/SarahWorkspace',
      smsBody: `Message from ${displayName}:\n${body ? body.substring(0, 140) : '(no message)'}\n\nSarah replied: ${reply ? reply.substring(0, 100) : '(no reply)'}\n\nReply via app: getcompanysync.com`
    }).catch(e => console.warn('[LocalSMS] Notification fire failed:', e.message));

    if (reply && localCompanyId) {
      try {
        const usagePool = getSharedPool();
        const usageId = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await usagePool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
          [usageId, localCompanyId, JSON.stringify({ company_id: localCompanyId, feature: 'sms_ai', units: 1, unit_cost: 0.02, total_cost: 0.02, usage_month: new Date().toISOString().slice(0, 7), logged_at: new Date().toISOString() })]
        );
        console.log(`[LocalSMS] Usage logged: sms_ai $0.02 for ${companyId}`);
      } catch (ue) {
        console.warn('[LocalSMS] Failed to log usage:', ue.message);
      }
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

    const pool = getSharedPool();
    let twilioSid, twilioToken, twilioPhone;
    try {
      const { rows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
        [companyId]
      );
      const tw = rows[0]?.data || {};
      twilioSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
      twilioToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
      twilioPhone = tw.main_phone_number || called_number;
    } finally {}

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

// Named export so scripts/test-voice-access-trial-expiry.cjs can e2e-test the
// real gate against the dev DB (keep in LOCKSTEP with prod-server.cjs copy).
// Monthly platform-voice cap: applies only when the company has NOT configured
// their own Twilio account (BYOK Twilio → unlimited, as sold).
// 500 min/mo covers the "typical" profile with ~3× headroom; a legitimate
// heavy subscriber who hits it gets a clear nudge to add their own Twilio creds.
const PLATFORM_VOICE_MINUTES_CAP = 500;

async function claimVoiceNudge(pool, companyId, usageMonth) {
  const id = `usagenudge_${companyId}_${usageMonth}_voice_minutes`;
  const res = await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'SubscriptionUsageNudge', $2, $3, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO NOTHING`,
    [id, companyId, JSON.stringify({ company_id: companyId, nudge_month: usageMonth, cap_type: 'voice_minutes', sent_at: new Date().toISOString() })]
  );
  return res.rowCount > 0;
}

// ── Voice usage nudge (80% of monthly cap) ───────────────────────────────────
// Fires at most once per calendar month per company via a deterministic
// SubscriptionUsageNudge entity (ON CONFLICT DO NOTHING de-duplication).
// BYOK Twilio companies never reach this — they early-return above.
async function sendVoiceUsageNudge(companyId, minutesUsed, cap) {
  const nudgeMonth = new Date().toISOString().slice(0, 7);
  const pool = getSharedPool();
  if (!(await claimVoiceNudge(pool, companyId, nudgeMonth))) return; // already sent this month

  const title = `You've used ${minutesUsed} of ${cap} platform voice minutes this month`;
  const message = `You're approaching your monthly voice-minutes limit (${minutesUsed}/${cap} min). Add your own Twilio account in Settings → API Keys to remove this limit entirely.`;
  try {
    await notifyAdmins(companyId, {
      title,
      message,
      type: 'usage_nudge',
      linkUrl: '/APIKeysSettings',
    });
    console.log(`[Voice] 80% nudge sent for ${companyId} — ${minutesUsed}/${cap} min (${nudgeMonth})`);
  } catch (e) {
    // Roll back the claim so a transient outage doesn't permanently silence this month's nudge.
    await pool.query(
      `DELETE FROM generic_entities WHERE id = $1 AND entity_type = 'SubscriptionUsageNudge'`,
      [`usagenudge_${companyId}_${nudgeMonth}_voice_minutes`]
    ).catch(() => {});
    console.warn('[Voice] sendVoiceUsageNudge failed:', e.message);
  }
}

export async function localCheckVoiceAccess(companyId) {
  try {
    const pool = getSharedPool();
    // SELECT * on purpose: subscription_status is a real column in dev but lives
    // only in the data JSONB blob in prod (prod-db.cjs's companies table has no
    // such column) — naming it in the column list would throw there. (Task #672)
    const { rows } = await pool.query(
      `SELECT * FROM companies WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
      [companyId]
    );
    const company = rows[0];
    if (!company) {
      console.warn(`[localCheckVoiceAccess] Company ${companyId} not found in local DB — allowing call (phone routing already validated)`);
      return { allowed: true };
    }

    const plan = (company.subscription_plan || company.data?.subscription_plan || 'trial').toLowerCase();
    // Status: real column (dev) → data JSONB (prod) fallback.
    const status = String(company.subscription_status ?? company.data?.subscription_status ?? 'active').toLowerCase();
    // Trials started via the startCompanyTrial action historically wrote only
    // data->>'trial_ends_at' (JSONB), not the trial_end_date column — fall back
    // to it so those trials are still enforced here. (Task #672)
    const trialEndRaw = company.trial_end_date
      ?? (company.data && typeof company.data === 'object' ? company.data.trial_ends_at : null);
    const trialExpired = company.data?.trial_expired === true ||
      (trialEndRaw && new Date(trialEndRaw) < new Date());

    // Expiry keys on subscription_status, not subscription_plan: action-started
    // trials carry the chosen plan name ('basic'/'business'/...) with
    // status='trial', so a plan-only check never fires for them. 'expired' is
    // what the processTrialLifecycle cron writes once the trial lapses.
    // Defense-in-depth: a live Stripe subscription means the company converted
    // to paid — never trial-block them even if a webhook gap left status='trial'
    // (prod's Stripe webhook has no customer.subscription.* handler that flips
    // status to 'active'). Explicit cancelled/suspended still blocks below.
    const hasStripeSub = !!(company.stripe_subscription_id || company.data?.stripe_subscription_id);
    if (!hasStripeSub && (status === 'expired' || (trialExpired && (status === 'trial' || plan === 'trial')))) {
      return { allowed: false, reason: 'Trial expired. Please upgrade to continue using voice features.' };
    }
    if (status === 'cancelled' || status === 'suspended') {
      return { allowed: false, reason: `Subscription ${status}. Please contact support to reactivate.` };
    }

    // BYOK Twilio check: if the company has their own Twilio account configured,
    // "unlimited call minutes" applies fully — skip the platform-key cap.
    let hasByokTwilio = false;
    try {
      const { rows: keyRows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'CompanyApiKeys' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
      const keyData = keyRows[0]?.data;
      hasByokTwilio = !!(keyData?.twilio_account_sid && keyData?.twilio_auth_token);
    } catch (e) {
      console.warn(`[localCheckVoiceAccess] Could not check BYOK Twilio status: ${e.message}`);
    }

    if (!hasByokTwilio) {
      // Platform Twilio: enforce monthly voice-minutes cap.
      try {
        const usageMonth = new Date().toISOString().slice(0, 7);
        const { rows: usageRows } = await pool.query(
          `SELECT COALESCE(SUM((data->>'units')::numeric), 0) AS used
           FROM generic_entities
           WHERE entity_type = 'SubscriptionUsage' AND company_id = $1
             AND data->>'feature' = 'sarah' AND data->>'usage_month' = $2`,
          [companyId, usageMonth]
        );
        const minutesUsed = Number(usageRows[0]?.used || 0);
        // 80% nudge: checked BEFORE the hard cap so a jump from <80% directly to ≥100%
        // in one call still creates the nudge. Skipped for active trials (status or
        // plan === 'trial') — only paid platform-key subscribers should be nudged.
        const isTrial = (status === 'trial' || plan === 'trial');
        if (!isTrial && minutesUsed >= PLATFORM_VOICE_MINUTES_CAP * 0.8) {
          sendVoiceUsageNudge(companyId, minutesUsed, PLATFORM_VOICE_MINUTES_CAP).catch((e) =>
            console.warn('[Voice] sendVoiceUsageNudge async failed:', e.message));
        }
        if (minutesUsed >= PLATFORM_VOICE_MINUTES_CAP) {
          console.warn(`[localCheckVoiceAccess] Company ${companyId} hit platform voice cap: ${minutesUsed}/${PLATFORM_VOICE_MINUTES_CAP} min`);
          return {
            allowed: false,
            reason: `Monthly voice minutes limit reached (${minutesUsed}/${PLATFORM_VOICE_MINUTES_CAP} min). Add your own Twilio account in Settings → API Keys to remove this limit.`,
            call_minutes_used: minutesUsed,
            call_minutes_limit: PLATFORM_VOICE_MINUTES_CAP,
          };
        }
        console.log(`[localCheckVoiceAccess] Company ${companyId} (${company.name}) allowed — plan=${plan}, voice=${minutesUsed}/${PLATFORM_VOICE_MINUTES_CAP} min (platform Twilio)`);
        return { allowed: true, plan, call_minutes_used: minutesUsed, call_minutes_limit: PLATFORM_VOICE_MINUTES_CAP };
      } catch (e) {
        console.warn(`[localCheckVoiceAccess] Could not check voice usage limits — allowing: ${e.message}`);
      }
    }

    console.log(`[localCheckVoiceAccess] Company ${companyId} (${company.name}) allowed — plan=${plan}, status=${status}${hasByokTwilio ? ' (BYOK Twilio)' : ''}`);
    return { allowed: true, plan, call_minutes_used: 0, call_minutes_limit: -1 };
  } catch (err) {
    console.error('[localCheckVoiceAccess] Error:', err.message);
    return { allowed: true };
  }
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
      const pool = getSharedPool();
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

  if ((action === 'sendCalendarInvite' || action === 'bookAppointment' || action === 'scheduleInspection') && companyId) {
    // NEW FLOW: a caller-requested appointment NEVER books the calendar directly.
    // Instead we (1) find/create the Lead and (2) create a "pending appointment
    // approval" ActionItem. A human approves it in the app, which is what creates
    // the real CalendarEvent (status 'scheduled') that drives the existing reminders.
    try {
      const pool = getSharedPool();

      // companyId may be a Base44 id — resolve to the local companies.id.
      const { rows: companyRows } = await pool.query(
        `SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]
      );
      const localId = companyRows[0]?.id || companyId;

      const customerName = data?.customer_name || data?.name || 'Customer';
      const rawPhone = (data?.customer_phone || data?.phone || data?.contact_phone || '').toString();
      const cleanPhone = rawPhone.replace(/[^\d+]/g, '');
      const address = data?.address || data?.property_address || data?.location || '';
      const rawDateTime = data?.date_time || data?.slot_time || data?.start_time || data?.appointment_time || data?.datetime || '';
      const title = data?.title || (action === 'scheduleInspection' ? `Roof Inspection - ${customerName}` : `Appointment - ${customerName}`);
      const description = data?.description || data?.notes || data?.service_needed || '';

      // Never silently turn a vague/missing time into "about a day from now".
      // That made "tomorrow morning" look like a confirmed appointment at the
      // current clock time and allowed the model to submit before confirmation.
      if (!rawDateTime) {
        return { success: false, requires_exact_time: true, message: 'I need the exact inspection date and time before I can submit the request.' };
      }
      const startTime = new Date(rawDateTime);
      if (isNaN(startTime.getTime())) {
        return { success: false, requires_exact_time: true, message: 'I need an exact inspection date and time, not a general period such as tomorrow morning.' };
      }
      const endTime = new Date(startTime.getTime() + 3600000);
      const startIso = startTime.toISOString();
      const friendlyTime = startTime.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

      // 1) Find or create the Lead (dedicated leads table), keyed by phone.
      let leadId = '';
      let leadName = customerName;
      if (cleanPhone) {
        const phoneVariants = [cleanPhone, cleanPhone.replace(/^\+1/, ''), '+1' + cleanPhone.replace(/^\+1/, '')];
        const existingLead = await pool.query(
          `SELECT id, name FROM leads WHERE company_id = $1 AND phone = ANY($2) ORDER BY updated_at DESC LIMIT 1`,
          [localId, phoneVariants]
        );
        if (existingLead.rows.length > 0) {
          leadId = existingLead.rows[0].id;
          leadName = existingLead.rows[0].name || customerName;
        }
      }
      if (!leadId) {
        leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await pool.query(
          `INSERT INTO leads (id, company_id, name, phone, source, status, service_needed, notes, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'sarah_ai', 'new', $5, $6, $7, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [leadId, localId, customerName, cleanPhone, description, address,
           JSON.stringify({ source: 'sarah_ai', address, requested_appointment: startIso })]
        );
        if (cleanPhone) { try { _invalidateCallerCache(localId, cleanPhone); } catch (_) {} }
        console.log(`[Sarah CRM] Appointment: created Lead ${leadId} for ${customerName}`);
      }

      // 2) Idempotency — skip if a pending approval already exists for this
      //    lead/phone + time.
      const dupCheck = await pool.query(
        `SELECT id FROM generic_entities
         WHERE entity_type = 'ActionItem' AND company_id = $1
           AND data->>'type' = 'pending_appointment_approval'
           AND data->>'status' IN ('pending','snoozed')
           AND data#>>'{proposed_appointment,start_time}' = $2
           AND (data->>'related_lead_id' = $3 OR data#>>'{proposed_appointment,contact_phone}' = $4)
         LIMIT 1`,
        [localId, startIso, leadId, cleanPhone]
      );
      if (dupCheck.rows.length > 0) {
        console.log(`[Sarah CRM] Appointment approval already pending — skipping duplicate`);
        return { success: true, message: `You're all set — I've already got that request in for our team to confirm. Anything else I can help with?` };
      }

      // 3) Create the pending-approval ActionItem (NO calendar event yet).
      const aiId = `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const dueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      const proposed = {
        start_time: startIso, end_time: endTime.toISOString(),
        address, title, description, contact_phone: cleanPhone, contact_name: customerName,
      };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'ActionItem', $2, $3, NOW(), NOW())`,
        [aiId, localId, JSON.stringify({
          id: aiId,
          company_id: localId,
          type: 'pending_appointment_approval',
          title: `Confirm appointment: ${leadName}`,
          description: `${title} requested for ${friendlyTime}${address ? ` at ${address}` : ''}. Phone: ${cleanPhone || 'N/A'}. Approve to add it to the calendar.`,
          status: 'pending',
          priority: 'high',
          due_at: dueAt,
          related_lead_id: leadId,
          proposed_appointment: proposed,
          source: 'sarah_ai',
          created_by: 'system',
          escalation_level: 0,
          created_at: new Date().toISOString(),
        })]
      );
      console.log(`[Sarah CRM] Appointment pending approval created (${aiId}) for ${localId}`);

      // Alert the team so they can confirm it.
      try {
        await notifyAdmins(localId, {
          title: `📅 Appointment to confirm — ${leadName}`,
          message: `${title} requested for ${friendlyTime}${address ? ` at ${address}` : ''}. Open Action Items to approve.`,
          type: 'appointment_request',
          linkUrl: '/ActionItems',
        });
      } catch (_) {}

      return {
        success: true,
        message: `Perfect — I've got you down for ${friendlyTime}. Someone from our team will give you a quick confirmation shortly. Anything else I can help with?`,
      };
    } catch (e) {
      console.warn(`[Sarah CRM] Local ${action} failed:`, e.message);
      return { success: false, message: 'I had trouble noting that appointment. Let me take your details and have someone follow up.' };
    }
  }

  if (action === 'getLeadHistory' && companyId && data?.phone) {
    try {
      const pool = getSharedPool();
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
      const pool = getSharedPool();
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
      const pool = getSharedPool();
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
      const pool = getSharedPool();
      const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = companyRows[0]?.id || companyId;
      const phone = (data?.phone || data?.caller_phone || '').replace(/[^\d+]/g, '');
      const callSid = data?.call_sid || '';
      const leadName = data?.name || data?.customer_name || '';
      const leadEmail = data?.email || '';
      const leadAssigned = data?.assigned_to || data?.rep_name || '';
      const leadService = data?.service_needed || data?.service_type || '';
      const leadNotes = data?.notes || data?.address || '';
      const leadData = JSON.stringify({ source: 'sarah_ai', call_sid: callSid, address: data?.address || '', ...data });

      // ONE lead per call. Alex calls save_lead_details repeatedly as details
      // accumulate, and the early saves have no phone number yet — matching on
      // phone alone meant every pre-phone save inserted a brand-new duplicate
      // (a single real call produced five leads). Match this call's own row
      // first via call_sid, then fall back to phone for repeat callers.
      let existingId = null;
      if (callSid) {
        const bySid = await pool.query(
          `SELECT id FROM leads WHERE company_id = $1 AND data->>'call_sid' = $2 ORDER BY created_at LIMIT 1`,
          [localId, callSid]
        );
        existingId = bySid.rows[0]?.id || null;
      }
      if (!existingId && phone) {
        const byPhone = await pool.query(`SELECT id FROM leads WHERE company_id = $1 AND phone = $2 LIMIT 1`, [localId, phone]);
        existingId = byPhone.rows[0]?.id || null;
      }

      if (existingId) {
        // Only overwrite a column when this save actually learned a new value,
        // so a later partial save can't blank out details captured earlier.
        await pool.query(
          `UPDATE leads SET
             name = CASE WHEN $3 <> '' THEN $3 ELSE name END,
             phone = CASE WHEN $4 <> '' THEN $4 ELSE phone END,
             email = CASE WHEN $5 <> '' THEN $5 ELSE email END,
             assigned_to = CASE WHEN $6 <> '' THEN $6 ELSE assigned_to END,
             service_needed = CASE WHEN $7 <> '' THEN $7 ELSE service_needed END,
             notes = CASE WHEN $8 <> '' THEN $8 ELSE notes END,
             data = COALESCE(data, '{}'::jsonb) || $9::jsonb,
             updated_at = NOW()
           WHERE id = $1 AND company_id = $2`,
          [existingId, localId, leadName, phone, leadEmail, leadAssigned, leadService, leadNotes, leadData]
        );
        console.log(`[Sarah CRM] saveLead LOCAL: enriched existing lead ${existingId} for ${localId}`);
        if (phone) {
          _invalidateCallerCache(localId, phone);
        }
        return { success: true, leadId: existingId };
      }

      const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await pool.query(
        `INSERT INTO leads (id, company_id, name, phone, email, source, status, assigned_to, service_needed, notes, data, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'sarah_ai', 'new', $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT DO NOTHING`,
        [leadId, localId, leadName || 'Unknown Caller', phone, leadEmail, leadAssigned, leadService, leadNotes, leadData]
      );
      console.log(`[Sarah CRM] saveLead LOCAL: ${leadName || 'Unknown'} for ${localId}`);
      if (phone) {
        _invalidateCallerCache(localId, phone);
      }
      return { success: true, leadId };
    } catch (e) { console.warn('[Sarah CRM] Local saveLead error:', e.message); }
  }

  // Local: saveCallLog — save call record to DB.
  // Writes to the dedicated `communications` table (NOT generic_entities):
  // the entity API maps Communication reads to that table, so rows written
  // anywhere else are invisible to the UI. Mirrors prod-server.cjs saveCallLog.
  if (action === 'saveCallLog' && companyId) {
    try {
      const pool = getSharedPool();
      const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = companyRows[0]?.id || companyId;
      const commId = data?.comm_id || `comm_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const durMins = data?.duration_seconds ? Math.max(1, Math.round(data.duration_seconds / 60)) : null;
      const extraData = {
        call_sid: data?.call_sid || '',
        twilio_sid: data?.call_sid || '',
        transcription: data?.transcript || '',
        transcript: data?.transcript || '',
        assistant_name: data?.assistant_name || 'Sarah',
        tool_calls_made: data?.tool_calls_made || 0,
        source: 'ai_voice',
        live: false,
        screening_outcome: data?.screening_outcome || null,
      };
      // UPSERT so a recording-webhook fallback row (or a pre-existing live row)
      // with the same id gets finalized instead of duplicated.
      await pool.query(
        `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, status, duration_minutes, data, created_at, updated_at)
         VALUES ($1,$2,'call','call',$3,$4,$5,'completed',$6,$7,NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           direction = EXCLUDED.direction,
           contact_phone = EXCLUDED.contact_phone,
           contact_name = EXCLUDED.contact_name,
           status = 'completed',
           duration_minutes = EXCLUDED.duration_minutes,
           data = communications.data || EXCLUDED.data,
           updated_at = NOW()`,
        [commId, localId, data?.direction || 'inbound', data?.caller_phone || 'Unknown', data?.caller_name || 'Voice Caller', durMins, JSON.stringify(extraData)]
      );
      console.log(`[Sarah CRM] saveCallLog LOCAL to communications: ${commId} for ${localId}`);
      return { success: true, commId };
    } catch (e) { console.warn('[Sarah CRM] Local saveCallLog error:', e.message); }
  }

  // Local: trackCallMinutes — log usage
  if (action === 'trackCallMinutes' && companyId) {
    try {
      const pool = getSharedPool();
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
      const pool = getSharedPool();
      const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = companyRows[0]?.id || companyId;
      await notifyAdmins(localId, {
        title: data?.title || (action === 'notifyRep' ? 'New lead from Alex' : 'Alex Alert'),
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
        assigned_to: { type: "string", description: "Staff member name or email to assign this lead to. Use this when a call was forwarded from a specific rep." },
        screening_outcome: { type: "string", enum: ["approved", "self_handled", "declined"], description: "When call screening is active: set 'self_handled' if you booked/handled the call without transferring, 'declined' if you ended the call (solicitor/robocall). Only set 'approved' here if used without transfer_call." }
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
    description: "Submit a roof inspection request for staff approval. This does NOT create a calendar event or confirm the appointment. Only call after checking availability and explicitly reading back the caller's full name, callback number, exact property address, exact date, and exact time, then receiving a clear confirmation. Never pass vague times such as 'tomorrow morning'.",
    parameters: {
      type: "object",
      properties: {
        date_time: { type: "string", description: "Exact date and time for the inspection, preferably ISO format; vague times are not allowed" },
        customer_name: { type: "string", description: "Full name, read back and confirmed by the caller" },
        customer_phone: { type: "string", description: "Callback phone number; use the caller's verified number when available" },
        address: { type: "string", description: "Complete property address, read back and confirmed by the caller" },
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
    description: "Transfer the current call to a staff member's cell phone. BEFORE calling this you MUST have already collected and confirmed THREE things: the caller's name, a callback phone number, and the reason for their call. Never transfer without all three. Use this when: 1) the caller asks to speak to a specific person by name (pass target_person), or 2) the call routing mode is sarah_then_transfer and you have gathered the caller's info. If the transfer cannot be completed, take a message instead of dropping the call. When call screening is active, always include screening_outcome.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "The reason the caller is calling / why the call is being transferred" },
        target_person: { type: "string", description: "Name of the specific staff member the caller wants to speak to (e.g. 'Vicky', 'Kevin'). Leave empty to transfer to the default rep." },
        caller_name: { type: "string", description: "The caller's full name — must be collected and confirmed before transferring" },
        callback_number: { type: "string", description: "A phone number to reach the caller back on — must be collected and confirmed before transferring" },
        screening_outcome: { type: "string", enum: ["approved", "self_handled", "declined"], description: "Result of call screening: 'approved' if caller was screened and approved for transfer, 'self_handled' if inspection/appointment was booked directly without a transfer, 'declined' if call was ended (solicitor, robocall). Omit if screening is not enabled." }
      },
      required: ["caller_name", "callback_number", "reason"]
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
  },
  callerMemory.LOOKUP_CUSTOMER_TOOL
];

const CUSTOMER_LEXI_VOICE_TOOLS = [
  {
    name: 'get_customer_public_progress',
    description: "Read only this caller's current project milestone and updates explicitly published for homeowners. Never request customer or project IDs. If multiple projects exist, ask which property address to check.",
    parameters: {
      type: 'object',
      properties: {
        property_address: { type: 'string', description: "The exact property address the caller provided, only to choose among their own projects." },
      },
      required: [],
    },
  },
  {
    name: 'request_customer_callback',
    description: 'Ask the office team to call this caller back. Use only when they request a person or accept a callback offer.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Brief reason for the requested callback.' } },
      required: ['reason'],
    },
  },
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

// Pre-computed 500ms typing-sound chunk (3 brief click pulses at 16kHz PCM, converted
// to Twilio mulaw 8kHz). Injected on loop while the AI processes the caller's utterance.
const TYPING_CHUNK_MULAW = (() => {
  const RATE = 16000;
  const samples = Math.floor(RATE * 0.5); // 500ms
  const buf = Buffer.alloc(samples * 2, 0);
  for (const clickMs of [80, 220, 360]) {
    const start = Math.floor(clickMs * RATE / 1000);
    const len = Math.floor(7 * RATE / 1000); // 7ms per click
    for (let i = 0; i < len && (start + i) < samples; i++) {
      const decay = Math.exp(-i / (len * 0.35));
      const noise = (Math.random() * 2 - 1);
      buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(3200 * decay * noise))), (start + i) * 2);
    }
  }
  return geminiToTwilio(buf.toString('base64'));
})();

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
    case 'get_customer_public_progress': {
      if (!context.customerLexiVoiceEnabled || !context.callerPhone) {
        return { ok: false, reason: 'unverified_phone', voice_script: buildVoiceProgressScript({ ok: false, reason: 'unverified_phone' }) };
      }
      const progress = await getCustomerPublicProgress(
        getSharedPool(),
        companyId,
        context.callerPhone,
        parsedArgs.property_address || '',
      );
      return { ...progress, voice_script: buildVoiceProgressScript(progress) };
    }

    case 'request_customer_callback': {
      if (!context.customerLexiVoiceEnabled) return { success: false, message: 'Customer callback requests are unavailable on this line.' };
      const reason = String(parsedArgs.reason || '').trim().slice(0, 300);
      if (!reason) return { success: false, message: 'Ask what the caller would like the team to discuss.' };
      return callBase44API('sendAlert', companyId, {
        message: `Homeowner requested a callback: ${reason}`,
        caller_name: '',
        caller_phone: context.callerPhone || '',
        urgency: 'medium',
        category: 'callback_request',
      });
    }

    case 'save_lead_details': {
      const result = await callBase44API('saveLead', companyId, {
        // Forward everything the model supplied — prod does the same, and the
        // old dev-only whitelist silently dropped fields like screening_outcome.
        ...parsedArgs,
        phone: parsedArgs.phone || parsedArgs.caller_phone || context.callerPhone || '',
        assigned_to: parsedArgs.assigned_to || '',
        // Lets saveLead recognise repeat saves within the same call instead of
        // inserting a duplicate lead each time.
        call_sid: context.callSid || ''
      });
      return result;
    }

    case 'check_availability': {
      const result = await callBase44API('checkAvailability', companyId);
      if (context.schedulingState && result && result.success !== false && !result.error) {
        context.schedulingState.availabilityChecked = true;
      }
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
      if (!context.schedulingState?.availabilityChecked) {
        return {
          success: false,
          requires_availability_check: true,
          message: 'Before I can submit an inspection request, I must check the calendar and offer a real available time. Ask for an exact date and time if needed, then call check_availability first.'
        };
      }
      if (context.schedulingState.submitted) {
        return {
          success: false,
          duplicate_request: true,
          message: 'This inspection request was already submitted during this call. Do not submit another one unless the caller clearly changes the confirmed date or time.'
        };
      }
      const result = await callBase44API('scheduleInspection', companyId, {
        date_time: parsedArgs.date_time,
        customer_name: parsedArgs.customer_name,
        customer_phone: parsedArgs.customer_phone || context.callerPhone || '',
        address: parsedArgs.address,
        notes: parsedArgs.notes || '',
        assigned_to: parsedArgs.assigned_to || ''
      });
      if (result?.success && context.schedulingState) context.schedulingState.submitted = true;
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
      // Block entirely when sarah_only mode is active.
      if (callRoutingMode === 'sarah_only') {
        console.log('[Sarah] transfer_call BLOCKED — routing mode is sarah_only');
        return { success: false, message: "Transfer is disabled in this routing mode. Do not tell the caller the person is unavailable — say they aren't taking calls directly on this line and offer to take a message. Save it with save_lead_details and notify the team with notify_rep." };
      }
      // Guard: must have caller name + callback number + reason before transferring.
      const guardCallerName = (parsedArgs.caller_name || '').trim();
      const guardCallback = ((parsedArgs.callback_number || '').replace(/[^\d+]/g, '')).trim();
      const guardReason = (parsedArgs.reason || '').trim();
      const missingInfo = [];
      if (!guardCallerName) missingInfo.push("the caller's name");
      if (!guardCallback) missingInfo.push('a callback phone number');
      if (!guardReason) missingInfo.push('the reason for their call');
      if (missingInfo.length > 0) {
        console.log(`[Sarah] Transfer BLOCKED — must collect first: ${missingInfo.join(', ')}`);
        return { success: false, message: `Don't transfer yet — you still need ${missingInfo.join(' and ')}. Ask the caller for the missing detail(s), one at a time, confirm what they say, and only call transfer_call once you have their name, a callback number, and the reason for their call.` };
      }

      // Resolve the target cell phone before reporting success to Sarah,
      // so she says the right thing to the caller (transfer vs. "I'll have them call back")
      const targetPerson = (parsedArgs.target_person || '').trim();
      let resolvedCell = context.staffCellPhone || '';
      let resolvedName = context.forwardedRepName || '';

      if (targetPerson) {
        // Check in-memory subscriber cache first (fastest), with nickname awareness
        if (context.subscriberCache) {
          for (const [, entry] of context.subscriberCache.entries()) {
            if (entry.companyId === companyId && entry.repName && nameMatchesSearch(entry.repName, targetPerson)) {
              resolvedCell = entry.cellPhone || '';
              resolvedName = entry.repName;
              break;
            }
          }
        }
        // Fall back to DB routing lookup
        if (!resolvedCell) {
          try {
            const allRouting = await callBase44API('getAllSubscriberRouting', null);
            if (allRouting?.subscribers) {
              const matched = allRouting.subscribers.find(s =>
                s.company_id === companyId && s.rep_name && nameMatchesSearch(s.rep_name, targetPerson)
              );
              if (matched) { resolvedCell = matched.cell_phone || ''; resolvedName = matched.rep_name; }
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
        const pool = getSharedPool();
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
        } finally {}
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

    case 'lookup_customer': {
      if (!companyId) return { found: false, error: 'company_id is required' };
      if (context.customerLexiVoiceEnabled) return { found: false, error: 'Caller memory is not available on the homeowner line.' };
      try {
        return await callerMemory.lookupCustomerDetail(getSharedPool(), {
          companyId,
          phone: parsedArgs.phone || context.callerPhone || '',
          customerId: parsedArgs.customer_id || '',
          leadId: parsedArgs.lead_id || '',
        });
      } catch (lookupErr) {
        console.warn('[Sarah CRM] lookup_customer failed:', lookupErr.message);
        return { found: false, error: 'Lookup failed' };
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

      const transferContextMap = new Map();

      wss.on('connection', (twilioWs, req) => {
        console.log('[Sarah] Twilio media stream connected');

        let geminiWs = null;
        let currentStreamSid = null;
        let setupComplete = false;
        let waitingForOutboundGreeting = false;
        let outboundGreetingGateTimer = null;
        let callCompanyId = null;
        let callerPhone = null;
        // The Twilio number that was dialed. Required by handleToolCall for
        // subscriber/routing lookups — without it every CRM tool throws a
        // ReferenceError that the broad catch turns into a friendly-sounding
        // "I'm having trouble" reply. Mirrors prod-server.cjs.
        let calledTwilioNumber = '';
        // Gemini routinely re-issues the SAME tool call many times in one turn
        // (one emergency call fired 19 identical send_alerts). Key the first
        // in-flight promise by tool name + args so the side effect happens once
        // per call while the model still gets an answer every time it asks.
        const toolCallCache = createToolCallCache();
        // Tool calls inside one Gemini response run via Promise.all, so two
        // progressive lead saves could both miss the existing row and insert
        // duplicates. Serialise lead saves for the lifetime of the call.
        let leadSaveChain = Promise.resolve();
        // Scheduling is also serialized so Gemini cannot create two pending
        // inspection requests when it re-issues the same intent with slightly
        // different arguments.
        let appointmentScheduleChain = Promise.resolve();
        const schedulingState = { availabilityChecked: false, submitted: false };
        let callSid = null;
        let callStartTime = Date.now();
        let conversationLog = [];
        let toolCallsMade = [];
        let collectedCallerName = null;
        let callLogSaved = false;
        let typingInterval = null;       // setInterval handle for typing-sound loop
        let typingSoundsEnabled = false; // set from AssistantSettings.interim_audio + response_speed
        let responseSpeedSetting = 'normal'; // AssistantSettings.response_speed — also drives VAD tuning
        let subscriberGeminiModel = ''; // set from AssistantSettings.engine — overrides the hardcoded default
        let postToolNudgeTimer = null;   // watchdog: nudge only if Gemini stays silent after a tool response

        // --- STAFF PHONE MODE state (mirrored in prod-server.cjs) ---
        // staffCandidate: caller ID matched an active staff profile WITH a voice
        // PIN set — the call runs the staff prompt + Lexi tool set, but every
        // tool stays LOCKED server-side until the PIN verifies (caller ID is
        // spoofable; the PIN is the real factor).
        let staffCandidate = null;        // { staffId, fullName, userEmail, timezone } | null
        let staffVerified = false;        // flipped ONLY by a successful verify_staff_pin
        let staffPinAttemptsThisCall = 0; // in-call cap (persistent lockout lives in DB)
        let staffLookupPromise = Promise.resolve(null);

        // --- Latency instrumentation (mirrored in prod-server.cjs) ---
        // One line per milestone so slow calls can be diagnosed from logs alone:
        // stream start → settings loaded → Gemini open → setup complete → greeting → first audio,
        // plus per-turn caller→first-audio gaps and per-tool durations.
        let latT0 = Date.now();
        let latLast = latT0;
        let respPendingSince = 0;  // set when caller speech transcribed; cleared on first audio back
        let firstAudioSeen = false;
        const markLatency = (label) => {
          const now = Date.now();
          console.log(`[LATENCY][${callSid || currentStreamSid || 'pre-start'}] ${label}: +${now - latT0}ms (step ${now - latLast}ms)`);
          latLast = now;
        };

        const geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
        if (!geminiApiKey) {
          console.error('[Sarah] GOOGLE_GEMINI_API_KEY not set!');
          twilioWs.close();
          return;
        }

        let companyName = 'CompanySync';
        let spokenBrandName = ''; // letter-by-letter / override pronunciation, set after CRM settings load
        let assistantName = ASSISTANT_NAME;
        let customerLexiVoiceEnabled = false;
        let customerLexiAudit = null;

        let maxCallDurationSec = 1800;

        async function saveCallToBase44() {
          if (callLogSaved) return;
          callLogSaved = true;

          const durationSec = Math.round((Date.now() - callStartTime) / 1000);
          // Collapse the many tiny same-role chunks Gemini emits into clean turns.
          const transcript = buildCleanTranscript(conversationLog);

          console.log(`[${assistantName}] Saving call log: ${durationSec}s, ${conversationLog.length} exchanges, ${toolCallsMade.length} tool calls`);

          let savedCommId = null;
          try {
            const saveRes = await callBase44API('saveCallLog', callCompanyId, {
              caller_phone: callerPhone || 'Unknown',
              caller_name: collectedCallerName || (isOutboundCall ? outboundLeadName : '') || 'Voice Caller',
              duration_seconds: durationSec,
              transcript: transcript,
              call_sid: callSid || '',
              tool_calls_made: toolCallsMade,
              assistant_name: assistantName,
              direction: isForwardedCall ? 'forwarded' : (isOutboundCall ? 'outbound' : 'inbound'),
              screening_outcome: callScreeningOutcome || null,
            });
            savedCommId = saveRes?.commId || null;
            console.log(`[${assistantName}] Call log saved to CRM successfully`);
          } catch (err) {
            console.error(`[${assistantName}] Failed to save call log:`, err.message);
          }

          // Best-effort post-call synopsis. The Communication is ALREADY saved above;
          // this only patches it in place and can never block or fail the call log.
          if (savedCommId && transcript) {
            (async () => {
              try {
                const synth = await generateCallSynopsis(transcript, geminiApiKey);
                if (!synth) return;
                const sPool = getSharedPool();
                const patch = {
                  call_summary: synth.call_summary,
                  call_synopsis: synth.call_synopsis,
                  ai_analyzed: true,
                  ai_summary_generated_at: new Date().toISOString(),
                };
                // saveCallLog now writes to the dedicated communications table
                await sPool.query(
                  `UPDATE communications SET data = data || $2::jsonb, updated_at = NOW() WHERE id = $1`,
                  [savedCommId, JSON.stringify(patch)]
                );
                console.log(`[${assistantName}] Call synopsis saved for ${savedCommId}`);
              } catch (e) {
                console.warn(`[${assistantName}] Synopsis generation failed:`, e.message);
              }
            })();
          }

          if (transcript && callerPhone && callCompanyId && !staffCandidate) {
            (async () => {
              try {
                const memPool = getSharedPool();
                await callerMemory.rememberCall(memPool, {
                  companyId: callCompanyId,
                  phone: callerPhone,
                  transcript,
                  apiKey: geminiApiKey,
                  sourceCallId: savedCommId,
                });
              } catch (e) {
                console.warn(`[${assistantName}] Caller memory failed:`, e.message);
              }
            })();
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
              const usagePool = getSharedPool();
              const callUnits = Math.max(1, Math.ceil(durationSec / 60));
              const usageId = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              await usagePool.query(
                `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
                [usageId, callCompanyId, JSON.stringify({ company_id: callCompanyId, feature: 'sarah', units: callUnits, unit_cost: 0.10, total_cost: parseFloat((callUnits * 0.10).toFixed(2)), usage_month: new Date().toISOString().slice(0, 7), duration_sec: durationSec, logged_at: new Date().toISOString() })]
              );
              console.log(`[${assistantName}] Usage logged: ${callUnits} min, $${(callUnits * 0.10).toFixed(2)} for ${callCompanyId}`);
            } catch (ue) {
              console.warn(`[${assistantName}] Failed to log usage:`, ue.message);
            }
          }
        }

        let companyKnowledge = '';
        let companyDescription = '';
        let subscriberSystemPrompt = '';
        let callScreeningEnabled = false;
        let callScreeningInstructions = '';
        let callScreeningOutcome = null;

        let isOutboundCall = false;
        let outboundLeadName = '';
        let outboundLeadService = '';
        let outboundLeadAddress = '';
        let outboundCampaign = null;

        let isForwardedCall = false;
        let isTransferReturn = false;
        let transferReturnRepName = '';
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

GREETING (vary each time — pick ONE, don't repeat):
- "Hey! You've reached ${cName}, I'm ${aName} picking up for ${rName}. What's going on?"
- "Hi there! This is ${aName} at ${cName} — ${rName}'s line. How can I help?"
- "Thanks for calling ${cName}! ${rName} stepped away so I've got you. What do you need?"

CALL FLOW:
1. Answer naturally — acknowledge what they say before asking anything.
2. If new lead: get their name first, then address, then what they need. One question at a time.
3. Save with save_lead_details (assigned_to="${rEmail || rName}") as soon as you have a name.
4. If they want scheduling: use schedule_inspection (assigned_to="${rEmail || rName}").
5. After booking or capturing info: use notify_rep to text ${rName} about the new lead/appointment.
6. Offer to text confirmation details: use send_text_to_caller with the caller's number.
7. Let them know: "${rName} will follow up with you shortly."

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
- When using notify_rep, include a clear message like: "New lead from [caller name] at [phone] — needs [service]. Appointment booked for [date/time]." so ${rName} has full context.

YOUR FIRST RESPONSE must be one of the greetings above — short, warm, under 20 words.`;

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

TRANSFER NOTE: ${callRoutingMode === 'sarah_only' ? 'Transfers are DISABLED in this mode. Do NOT use transfer_call under any circumstances. If a caller asks to speak to someone, be honest without implying the person is gone: say something like "[Name] isn\'t taking calls directly on this line, but I can take a message and make sure they get right back to you." Never say the person is "unavailable" or "not available" — you simply handle their calls. Save their info with save_lead_details and send a notification with notify_rep.' : 'If asked to speak to someone specific, FIRST check the staff list above. If that person is marked "— unavailable", do NOT attempt the transfer at all — tell the caller right away something like "I\'m sorry, [name] is off right now. I can take a message for them and make sure they call you back." If they ARE available (or not listed), use transfer_call with their name in target_person. If the transfer fails or they don\'t answer, do NOT re-introduce yourself or restart the conversation — immediately offer to take a message. Either way: get the caller\'s message and best callback number, save it with save_lead_details (note: "Message for [name]: [what they said]. Callback: [number]."), then use notify_rep to alert that person by SMS so they follow up right away.'}

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

          // Replace any Gemini voice persona names that may have leaked into a custom prompt
          // (e.g. Aoede, Kore, Zephyr) or any first-person "I'm X" / "My name is X" patterns
          // where X differs from the configured assistant name. These cause the AI to introduce
          // itself by the voice model's internal persona name instead of the configured one.
          // Keep IN LOCKSTEP with prod-server.cjs buildSystemPrompt.
          const GEMINI_VOICE_NAMES_LIST = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'];
          for (const vn of GEMINI_VOICE_NAMES_LIST) {
            if (vn.toLowerCase() !== aName.toLowerCase()) {
              prompt = prompt.replace(new RegExp(`\\b${vn}\\b`, 'gi'), aName);
            }
          }
          // Sanitize name-identity claims in custom prompts that could override the
          // configured assistant name. Covers "You are X", "I'm X", "I am X",
          // "My name is X", "Your name is X" where X is a proper name ≠ aName.
          // [A-Z][a-z]{2,14} only matches proper single-word names — it won't touch
          // "You are NOT…", "You are an expert…", "You are working in…" etc.
          // Keep IN LOCKSTEP with prod-server.cjs buildSystemPrompt.
          prompt = prompt.replace(
            /\b(You are|I(?:'m| am)|[Mm]y name is|[Yy]our name is)\s+["']?([A-Z][a-z]{2,14})["']?/g,
            (match, prefix, name) => (name.toLowerCase() === aName.toLowerCase() ? match : `${prefix} ${aName}`)
          );
          if (subscriberSystemPrompt) {
            const nameInPrompt = subscriberSystemPrompt.match(/\b(?:You are|I(?:'m| am)|[Mm]y name is|[Yy]our name is)\s+["']?([A-Z][a-z]{2,14})["']?/);
            if (nameInPrompt && nameInPrompt[1]?.toLowerCase() !== aName.toLowerCase()) {
              console.warn(`[${aName}] ⚠️  Subscriber prompt contains name "${nameInPrompt[1]}" but assistant is configured as "${aName}" — verify the custom system prompt does not override the assistant name`);
            }
          }
          console.log(`[${aName}] System prompt built (${prompt.length} chars), name=${aName}, company=${cName}`);

          prompt += `

VOICE RULES (non-negotiable):
- IDENTITY (non-negotiable): Your name is ${aName}. This overrides any name mentioned in the custom prompt, knowledge base, or any other instruction. Always introduce yourself as ${aName} — never as a different name.
- No internal thinking, reasoning, or markdown. Only say words you'd say out loud on a phone call.
- Keep responses under 25 words. Short and natural.
- NEVER speak for the caller or assume why they're calling. Do not mention leaks, storm damage, or any issue until the CALLER brings it up first.
- Ask ONE question, then STOP and wait for the caller to answer. NEVER answer your own question. NEVER continue as if the caller replied when they didn't.
- If you hear silence, background noise, or can't make out words, do NOT guess what was said. Wait quietly, or after a long silence ask "Are you still there?" — nothing more.
- Only respond to words you clearly heard the caller say. If in doubt, ask them to repeat it.
- LANGUAGE: Speak in whatever language the caller is using. If they speak Spanish, respond entirely in natural, fluent Spanish; if they switch languages, switch with them. Mirror the caller's language for the whole call — never announce that you're switching or translating.
- Never say "How can I assist you further today?" or similar robotic closers.
- Vary your responses. Don't repeat greetings, phrases, or patterns.
- Tone: warm but professional — like a polished front-desk receptionist at an established company. Composed and courteous, never goofy, slangy, or over-caffeinated. Use light, natural contractions and skip filler like "um", "totally", or "awesome".
- One thought at a time, calm and clear. Project quiet competence so the caller feels they're in good hands.
- Messages wrapped in [System: ...] or [System context: ...] are INTERNAL instructions, never words from the caller. NEVER read them aloud, quote them, or respond to them as if the caller said them — silently follow the instruction and continue the conversation naturally.

CRM TOOLS — use these automatically as info comes in:
- save_lead_details: Save as soon as caller shares name, phone, or what they need. Don't wait. Include service_needed. Every caller must be tracked.
- check_availability: Check open appointment slots before booking. Always offer these options to the caller.
  IF FAILS: "I'm having trouble pulling up the schedule right now — I'll have someone call you back shortly to lock in a time."
- book_appointment: Book after caller picks a slot. Always confirm the time before booking.
  IF FAILS: "I wasn't able to confirm that booking — I've got your info and someone will call you back to get that locked in."
- schedule_inspection: For roof inspection bookings. Include address and assigned_to.
  IF FAILS: "I wasn't able to book that automatically — I've got your info and someone will call you within the hour to confirm."
- transfer_call: Transfer to a staff member by name. Use target_person with their name.
  IF NO CELL FOUND: "I can't connect you directly right now, but I'll text them immediately and have them call you right back."
- notify_rep: Text a rep about new leads or appointments. Always use after saving a lead or booking.
- send_alert: For complaints, emergencies, or messages for someone specific. Set urgency (urgent/high/medium). Confirm to caller after sending.
- send_text_to_caller: Send an SMS to the caller's phone. Use for appointment confirmations, addresses, details they ask to receive by text.
  IF FAILS: "I had trouble sending that — I'll make sure someone follows up with the details."
- send_calendar_invite: Send an SMS calendar invite after booking. Include address if available.
- After EVERY tool call, respond to the caller immediately. Never go silent after a tool runs.`;

          if (callScreeningEnabled) {
            const screeningRules = callScreeningInstructions && callScreeningInstructions.trim()
              ? callScreeningInstructions.trim()
              : `- Ask the caller: "What's the reason for your call today?" before deciding what to do.\n- If they need an inspection or free estimate: book it directly using schedule_inspection — no transfer needed.\n- If they want to speak to a specific person and that person is available: gather their name, callback number, and reason, then use transfer_call.\n- If they're selling something, soliciting, or it's a robocall: politely decline and end the call.`;
            prompt += `\n\nCALL SCREENING — REQUIRED: Before transferring or booking, always learn the caller's reason for calling. Based on what they say:\n${screeningRules}\n\nAlways be courteous regardless of the outcome. If declining a call, say something like "Thanks for calling — we're not the right fit for that, but I hope you find what you need."\n\nSCREENING OUTCOME LOGGING (always do this when screening is active):\n- When you TRANSFER the call: pass screening_outcome='approved' in transfer_call.\n- When you HANDLE the call yourself (booked inspection, took message, etc.): pass screening_outcome='self_handled' in save_lead_details.\n- When you DECLINE/end the call (solicitor, robocall, etc.): pass screening_outcome='declined' in save_lead_details.\nYou MUST always record a screening_outcome before ending the call.`;
          }

          if (companyDescription) {
            prompt += `\n\nAbout ${cName}:\n${companyDescription}`;
          }

          if (companyKnowledge) {
            // Cap the knowledge block: an oversized system prompt measurably slows
            // the model's first token and buries the behavioral rules above.
            const MAX_KNOWLEDGE_CHARS = 6000;
            const kb = companyKnowledge.length > MAX_KNOWLEDGE_CHARS
              ? companyKnowledge.slice(0, MAX_KNOWLEDGE_CHARS) + '\n[...knowledge truncated]'
              : companyKnowledge;
            if (companyKnowledge.length > MAX_KNOWLEDGE_CHARS) {
              console.log(`[${aName}] Knowledge base truncated: ${companyKnowledge.length} → ${MAX_KNOWLEDGE_CHARS} chars`);
            }
            // NAME REMINDER guards against KB text (e.g. "My AI is Sierra") overriding
            // the configured assistant name. Keep in lockstep with prod-server.cjs.
            prompt += `\n\nNAME REMINDER: Your name is ${aName}. The knowledge base below is for business facts only — it may mention other names for context, but your name on this call is always ${aName}.\n\nKNOWLEDGE BASE — reference this to answer questions about ${cName}:\n${kb}`;
          }

          return prompt;
        }

        const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;
        let geminiKeepaliveInterval = null;
        let geminiReconnectAttempts = 0;
        let callTerminated = false;
        const MAX_GEMINI_RECONNECTS = 3;

        // Calm, professional hand-off used ONLY after we've exhausted reconnect attempts.
        function gracefulHandoff(closeCode) {
          if (callTerminated) { saveCallToBase44(); return; }
          callTerminated = true;
          console.log(`[${assistantName}] Gemini connection lost after ${geminiReconnectAttempts} reconnect attempt(s) (code=${closeCode}) — graceful hand-off to a human`);

          // 1) Play a calm message to the caller (needs Twilio creds + an open line).
          //    Prefer the subscriber's own Twilio creds (BYO-Twilio); fall back to platform creds.
          try {
            const activeSid = twilioSid || process.env.TWILIO_ACCOUNT_SID;
            const activeToken = twilioToken || process.env.TWILIO_AUTH_TOKEN;
            if (activeSid && activeToken && callSid && twilioWs.readyState === WebSocket.OPEN) {
              const handoffMsg = "I'm so sorry — it looks like our connection just cut out. Let me have someone from our team give you a call right back. Thanks so much for your patience.";
              const safeMsg = handoffMsg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
              const twiml = `<Response><Say voice="Polly.Joanna">${safeMsg}</Say><Hangup/></Response>`;
              const callUpdateUrl = `https://api.twilio.com/2010-04-01/Accounts/${activeSid}/Calls/${callSid}.json`;
              const authHeader = `Basic ${Buffer.from(`${activeSid}:${activeToken}`).toString('base64')}`;
              fetch(callUpdateUrl, {
                method: 'POST',
                headers: { 'Authorization': authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `Twiml=${encodeURIComponent(twiml)}`,
              }).then(r => { if (!r.ok) r.text().then(t => console.warn('[Sarah] Hand-off TTS failed:', t)); }).catch(e => console.error('[Sarah] Hand-off Twilio REST error:', e.message));
            } else {
              console.warn('[Sarah] Hand-off: no Twilio creds or line already closed — skipped caller message');
            }
          } catch (e) {
            console.error('[Sarah] Hand-off caller-message error:', e.message);
          }

          // 2) ALWAYS file a staff follow-up when we know the company, even if the caller
          //    message couldn't be played, so an unrecoverable drop is never silent.
          if (callCompanyId) {
            try {
              callBase44API('createAlert', callCompanyId, {
                type: 'ai_disconnect',
                urgency: 'high',
                message: `${assistantName}'s connection dropped during a call and couldn't recover. Caller: ${callerPhone || 'unknown'}. Call SID: ${callSid}. The caller was told someone would call back — please follow up.`,
                caller_phone: callerPhone
              }).catch(e => console.error('[Sarah] Hand-off alert failed:', e.message));
            } catch (notifErr) {
              console.error('[Sarah] Hand-off alert error:', notifErr.message);
            }
          }

          saveCallToBase44();
        }

        async function connectGemini(isReconnect = false) {
          const currentSettings = loadSettings();
          let voiceName = currentSettings.voice || 'Puck';

          const VALID_GEMINI_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr'];
          let inboundGreeting = '';

          // Latency: run the CRM-settings load, the caller-history lookup, and the
          // Gemini WebSocket handshake IN PARALLEL. Previously each step waited for
          // the one before it (settings → socket → setup → history → greeting),
          // and every millisecond of that chain was dead air for the caller.
          let callerMemoryInjected = false;
          const historyPromise = (!isReconnect && callerPhone && callCompanyId)
            ? (async () => {
                const [lead, memory] = await Promise.all([
                  callBase44API('getLeadHistory', callCompanyId, { phone: callerPhone }).catch(() => null),
                  callerMemory.loadCallerMemory(getSharedPool(), {
                    companyId: callCompanyId,
                    phone: callerPhone,
                  }).catch((memErr) => {
                    console.warn(`[${assistantName}] Caller memory lookup failed:`, memErr.message);
                    return null;
                  }),
                ]);
                return { ...(lead || {}), memory };
              })()
            : Promise.resolve(null);

          const settingsApplied = (async () => {
          if (callCompanyId) {
            try {
              const crmSettings = await callBase44API('getSettings', callCompanyId);
              
              // Read name from intent_templates._assistant_display_name (mutable field inside JSON object)
              // Priority: _assistant_display_name > assistant_name > fixed "Alex".
              // Legacy seeded values ("sarah"/"lexi") are ignored — see lib/assistantName.cjs.
              const rawDisplayName = (crmSettings.settings?.intent_templates?._assistant_display_name || '').trim();
              const rawAssistantName = (crmSettings.settings?.assistant_name || '').trim();
              const rawBrandName = (crmSettings.settings?.brand_short_name || '').trim();
              console.log(`[${ASSISTANT_NAME}] Raw DB fields: display_name="${rawDisplayName}", assistant_name="${rawAssistantName}", brand="${rawBrandName}"`);

              // Set company name
              if (rawBrandName) {
                companyName = rawBrandName;
              } else if (crmSettings.companyName) {
                companyName = crmSettings.companyName;
              }

              assistantName = resolveAssistantName(rawDisplayName, rawAssistantName);
              customerLexiVoiceEnabled = false;
              try {
                const customerChannels = await getVerifiedLexiChannels(getSharedPool(), callCompanyId);
                customerLexiVoiceEnabled = !isOutboundCall
                  && customerChannels.voice
                  && canonicalPhone(calledTwilioNumber) === customerChannels.phone;
                if (customerLexiVoiceEnabled) assistantName = 'Lexi';
              } catch (lexiError) {
                console.warn('[Lexi Customer Voice] Could not verify this inbound phone route:', lexiError.message);
              }
              console.log(`[${assistantName}] Resolved names: assistant="${assistantName}", company="${companyName}"`);

              // How the company name should be SPOKEN (acronym spell-out or per-company override).
              spokenBrandName = deriveSpokenBrandName(crmSettings.settings?.spoken_name, companyName);
              if (spokenBrandName && spokenBrandName !== companyName) {
                console.log(`[Sarah] Spoken brand name: "${spokenBrandName}"`);
              }
              
              console.log(`[${assistantName}] CRM voice fields: voice_id="${crmSettings.settings?.voice_id || ''}", voice="${crmSettings.settings?.voice || ''}", local="${currentSettings.voice || ''}"`);
              if (currentSettings.voice && VALID_GEMINI_VOICES.includes(currentSettings.voice)) {
                voiceName = currentSettings.voice;
                console.log(`[${assistantName}] Using LOCAL voice setting: ${voiceName}`);
              } else if (crmSettings.settings?.voice_id && VALID_GEMINI_VOICES.includes(crmSettings.settings.voice_id)) {
                voiceName = crmSettings.settings.voice_id;
                console.log(`[${assistantName}] Using CRM voice_id: ${voiceName}`);
              } else if (crmSettings.settings?.voice && VALID_GEMINI_VOICES.includes(crmSettings.settings.voice)) {
                voiceName = crmSettings.settings.voice;
                console.log(`[${assistantName}] Using CRM voice: ${voiceName}`);
              }
              if (!VALID_GEMINI_VOICES.includes(voiceName)) {
                console.warn(`[${assistantName}] Voice "${voiceName}" is not valid for Gemini. Falling back to Puck. Valid voices: ${VALID_GEMINI_VOICES.join(', ')}`);
                voiceName = 'Puck';
              }
              if (crmSettings.customSystemPrompt) {
                subscriberSystemPrompt = crmSettings.customSystemPrompt;
                console.log(`[${assistantName}] Loaded subscriber custom prompt (${subscriberSystemPrompt.length} chars)`);
              }
              if (crmSettings.knowledgeBase) {
                // Warn when the knowledge base text mentions a different name — a common
                // source of the AI introducing itself by the wrong name on live calls.
                // Keep in lockstep with prod-server.cjs settingsApplied block.
                const kbNameMatch = crmSettings.knowledgeBase.match(/\b(?:I(?:'m| am)|[Mm]y name is)\s+([A-Z][a-z]{2,14})\b/);
                if (kbNameMatch && kbNameMatch[1]?.toLowerCase() !== assistantName.toLowerCase()) {
                  console.warn(`[Sarah] ⚠️  Knowledge base contains name "${kbNameMatch[1]}" but assistant is configured as "${assistantName}" — this may cause the AI to introduce itself by the wrong name. Update the "What ${assistantName} knows" field to remove or correct any first-person name references.`);
                }
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
              if (crmSettings.screeningEnabled) {
                callScreeningEnabled = true;
                callScreeningInstructions = crmSettings.screeningInstructions || '';
                console.log(`[${assistantName}] Call screening ENABLED`);
              }
              console.log(`[${assistantName}] Loaded CRM settings: company=${companyName}, assistant=${assistantName}, voice=${voiceName}`);
              // Wire the typing-sound preference into the call pipeline
              const rawInterimAudio = crmSettings.settings?.interim_audio || currentSettings.interim_audio || 'typing';
              const rawResponseSpeed = crmSettings.settings?.response_speed || currentSettings.response_speed || 'normal';
              responseSpeedSetting = ['fast', 'normal', 'relaxed'].includes(rawResponseSpeed) ? rawResponseSpeed : 'normal';
              typingSoundsEnabled = rawInterimAudio === 'typing' && rawResponseSpeed === 'normal';
              console.log(`[${assistantName}] Typing sounds: ${typingSoundsEnabled} (interim_audio=${rawInterimAudio}, response_speed=${rawResponseSpeed})`);
              // Wire the AI Engine setting into the call model (only native-audio models are valid here)
              const VALID_NATIVE_AUDIO_MODELS = [
                'gemini-2.5-flash-native-audio-latest',
                'gemini-2.5-flash-native-audio-preview-12-2025',
                'gemini-2.5-flash-native-audio-preview-09-2025',
                'gemini-3.1-flash-live-preview',
              ];
              const rawEngine = crmSettings.settings?.engine || currentSettings.engine || '';
              if (rawEngine && VALID_NATIVE_AUDIO_MODELS.includes(rawEngine)) {
                subscriberGeminiModel = `models/${rawEngine}`;
                console.log(`[${assistantName}] Engine override: ${subscriberGeminiModel}`);
              }
            } catch (e) {
              console.warn(`[${assistantName}] Could not load CRM settings, using defaults:`, e.message);
            }
          }
          })();

          // Open the Gemini socket NOW — the WS/TLS handshake runs while the
          // settings queries above are still in flight. The 'open' handler
          // awaits settingsApplied before building the setup payload.
          if (callTerminated || twilioWs.readyState !== WebSocket.OPEN) {
            console.log(`[${assistantName}] Caller gone before (re)connecting to Gemini — aborting connect`);
            saveCallToBase44();
            return;
          }
          // Reset the setup gate so caller audio is NOT forwarded to the new socket until its
          // OWN setupComplete arrives — critical on reconnect, where it is already true.
          setupComplete = false;
          geminiWs = new WebSocket(geminiUrl);
          const thisWs = geminiWs; // guard against reconnects swapping the socket mid-handshake

          geminiWs.on('open', async () => {
            markLatency('gemini_ws_open');
            // Settings usually resolve before the TLS handshake finishes; if not,
            // this is the only remaining wait before setup can be sent.
            try { await settingsApplied; } catch (_) {}
            markLatency('settings_ready');

            // The caller may have hung up while the settings load was running —
            // don't send setup on an orphan socket (close handler does cleanup).
            if (callTerminated || twilioWs.readyState !== WebSocket.OPEN || thisWs !== geminiWs || thisWs.readyState !== WebSocket.OPEN) {
              console.log(`[${assistantName}] Caller gone (or socket replaced) before Gemini setup — skipping`);
              try { thisWs.close(); } catch (_) {}
              return;
            }

            console.log(`[${assistantName}] Connected to Gemini (voice: ${voiceName}), sending setup with CRM tools...`);
            console.log(`[${assistantName}] CRM integration: ${BASE44_API_URL ? 'ENABLED' : 'DISABLED'}`);

            // STAFF PHONE MODE: if the caller ID matched a staff profile with a
            // voice PIN, install the lean staff prompt + Lexi tool set instead of
            // the customer-facing script. The prompt deliberately carries NO
            // customer/knowledge data — the caller is unverified until the PIN
            // check passes, and all data flows through server-gated tools.
            if (!isReconnect) {
              try { staffCandidate = await staffLookupPromise; } catch (_) { staffCandidate = null; }
            }
            if (staffCandidate) {
              console.log(`[${assistantName}][StaffMode] Caller ID matched staff "${staffCandidate.fullName}" (${staffCandidate.userEmail}) — PIN verification required`);
            }

            let sysPrompt = buildSystemPrompt(companyName, assistantName);
            // Universal voice/behavior rules — appended AFTER every prompt branch
            // (default, forwarded, outbound, AND custom subscriber prompts) so the
            // live-phone conversational style is guaranteed regardless of prompt source.
            // Keep IDENTICAL to the copy in prod-server.cjs (dev/prod lockstep).
            sysPrompt += `\n\nVOICE & BEHAVIOR RULES (always apply):
1. BREVITY: Keep every response to 1 to 2 short sentences. Never give long speeches or bulleted lists.
2. NATURAL FLOW: Speak like a real person over the phone. Use natural, conversational language (e.g., "Gotcha," "Makes sense," "No problem").
3. ONE QUESTION AT A TIME: When you need information, end your turn with a single, clear question, then STOP speaking and wait for the caller to reply. Never stack questions.
4. HANDLING INTERRUPTIONS: If the caller cuts in or speaks over you, stop immediately and address what they just said.
5. INTENT: Be helpful, direct, and focused on guiding the conversation to the next step without sounding rigid or scripted.
6. INSPECTION SAFETY: Before requesting an inspection, collect the caller's full name, callback number, complete property address, exact date, and exact time. Read all five items back and ask for a clear confirmation. Never treat "tomorrow morning" or another vague period as a time, never invent a time, and never claim the appointment is confirmed.
7. CALENDAR CHECK: For an inspection, call check_availability before schedule_inspection and only offer times returned by that tool. If the caller changes the time, check availability again.
8. LEAD RECORD: Save the caller's name, phone, email when provided, address, service need, and scheduling details with save_lead_details. The caller's phone is the callback number unless they provide a different one.
9. APPROVAL LANGUAGE: schedule_inspection submits a request for staff approval; it does not create a calendar event. Tell the caller the request was sent to the team for confirmation, not that they are booked.
10. DUPLICATES: Do not call schedule_inspection more than once for the same confirmed request.`;

            if (customerLexiVoiceEnabled && !staffCandidate) {
              sysPrompt = `You are Lexi, ${companyName}'s AI project update assistant, not its COO or a human employee. Say that you are an AI assistant in your opening.

You may only answer customer project questions with a successful get_customer_public_progress result from this same call. Never use caller claims, old call history, company knowledge, or assumptions as proof. Read the server-provided voice_script exactly, without adding details or paraphrasing.

The tool is limited to one uniquely phone-matched customer and returns only that customer's current milestone and updates explicitly published for homeowners. Never disclose or infer money, insurance or adjuster details, internal notes, tasks, crew or schedule information, unpublished photos, addresses, or another customer's records. Do not accept customer or project IDs.

If a property selection is needed, ask for the exact address and use only the address the caller gives. If identity, project selection, or lookup fails, say you could not safely verify the information and offer a callback. Use request_customer_callback only when the caller asks for a person or accepts a callback.

Keep responses brief, conversational, and in the caller's language.`;
            }

            // STAFF PHONE MODE: replace the whole customer prompt with the lean
            // staff prompt (it carries its own voice/behavior rules and NO
            // customer data). Keep IDENTICAL semantics in prod-server.cjs.
            if (staffCandidate) {
              sysPrompt = buildStaffPhonePrompt(companyName, assistantName, staffCandidate.fullName, staffCandidate.timezone);
            }

            if (!staffCandidate && !customerLexiVoiceEnabled && callerPhone && callCompanyId) {
              const racedMemory = await Promise.race([
                historyPromise.then((h) => h?.memory || null),
                new Promise((resolve) => setTimeout(() => resolve('__PENDING__'), 400)),
              ]);
              if (racedMemory && racedMemory !== '__PENDING__') {
                const block = callerMemory.instructionBlock(racedMemory);
                if (block) {
                  sysPrompt += block;
                  callerMemoryInjected = true;
                }
              }
            }

            // Turn-taking speed follows the subscriber's response_speed setting.
            // silence_duration_ms is how long Gemini waits after the caller stops
            // talking before it starts answering — the single biggest lever on
            // perceived response lag. START stays LOW in all modes: phone lines
            // carry noise + echo of the assistant's own voice, and high start
            // sensitivity makes Gemini "hear" speech nobody said.
            const VAD_BY_SPEED = {
              fast:    { end: 'END_SENSITIVITY_HIGH', silenceMs: 400 },
              normal:  { end: 'END_SENSITIVITY_LOW',  silenceMs: 900 },
              relaxed: { end: 'END_SENSITIVITY_LOW',  silenceMs: 1400 },
            };
            const vad = VAD_BY_SPEED[responseSpeedSetting] || VAD_BY_SPEED.normal;
            console.log(`[${assistantName}] VAD tuning: speed=${responseSpeedSetting}, end=${vad.end}, silence=${vad.silenceMs}ms`);

            const setupMsg = {
              setup: {
                // Default verified against live ListModels + a real Live-API setup
                // handshake (3.1-flash-live-preview supersedes the 2.5 native-audio
                // line with better turn-taking/latency). Env var overrides for rollback.
                model: subscriberGeminiModel || process.env.GEMINI_NATIVE_AUDIO_MODEL || "models/gemini-3.1-flash-live-preview",
                generation_config: {
                  response_modalities: ["AUDIO"],
                  speech_config: {
                    voice_config: {
                      prebuilt_voice_config: { voice_name: voiceName }
                    }
                  }
                },
                input_audio_transcription: {},
                output_audio_transcription: {},
                realtime_input_config: {
                  automatic_activity_detection: {
                    disabled: false,
                    start_of_speech_sensitivity: "START_SENSITIVITY_LOW",
                    end_of_speech_sensitivity: vad.end,
                    prefix_padding_ms: 100,
                    silence_duration_ms: vad.silenceMs
                  }
                },
                system_instruction: {
                  parts: [{ text: applySpokenCompanyName(sysPrompt, companyName, spokenBrandName) }]
                },
                tools: [{
                  // Staff callers get Lexi's full CRM tool set + the PIN gate;
                  // execution stays LOCKED server-side until the PIN verifies.
                  function_declarations: staffCandidate
                    ? [VERIFY_STAFF_PIN_TOOL, ...LEXI_CRM_TOOLS]
                    : customerLexiVoiceEnabled
                      ? CUSTOMER_LEXI_VOICE_TOOLS
                      : (callRoutingMode === 'sarah_only'
                          ? CRM_TOOLS.filter(t => t.name !== 'transfer_call')
                          : CRM_TOOLS)
                }]
              }
            };

            thisWs.send(JSON.stringify(setupMsg));
            markLatency('gemini_setup_sent');
          });

          geminiWs.on('message', async (raw) => {
            try {
              const data = JSON.parse(raw.toString());

              if (data.setupComplete) {
                // If the caller hung up during the Gemini handshake, don't start a keepalive
                // on an orphan socket — close it and bail.
                if (callTerminated || twilioWs.readyState !== WebSocket.OPEN) {
                  console.log(`[${assistantName}] Caller gone by Gemini setupComplete — closing orphan socket`);
                  try { geminiWs.close(); } catch (_) {}
                  saveCallToBase44();
                  return;
                }
                console.log(`[${assistantName}] Gemini setup complete (with CRM tools), sending greeting as "${assistantName}" for "${companyName}" (outbound: ${isOutboundCall})...`);
                setupComplete = true;

                if (geminiKeepaliveInterval) clearInterval(geminiKeepaliveInterval);
                geminiKeepaliveInterval = setInterval(() => {
                  if (geminiWs?.readyState === WebSocket.OPEN) {
                    geminiWs.send(JSON.stringify({
                      realtime_input: {
                        audio: {
                          mimeType: "audio/pcm;rate=16000",
                          data: Buffer.alloc(320).toString('base64')
                        }
                      }
                    }));
                  } else {
                    clearInterval(geminiKeepaliveInterval);
                  }
                }, 5000);

                // Mid-call reconnect: the connection briefly dropped and we re-established it.
                // Skip the full greeting/caller-lookup and just smoothly resume the conversation.
                if (isReconnect) {
                  console.log(`[${assistantName}] Gemini reconnected mid-call (attempt ${geminiReconnectAttempts}) — resuming without re-greeting`);
                  if (geminiWs?.readyState === WebSocket.OPEN) {
                    geminiWs.send(JSON.stringify({ client_content: { turns: [{ role: "user", parts: [{ text: "[System: The audio connection briefly dropped and just reconnected. In ONE short, calm sentence, apologize for the brief cut-out and invite them to continue (for example: \"Sorry about that — I lost you for a second there. Please go ahead.\"). Do NOT re-introduce yourself or restart the conversation.]" }] }], turn_complete: true } }));
                  }
                  return;
                }

                markLatency('gemini_setup_complete');

                // Caller-history: the lookup was ALREADY started in parallel back in
                // connectGemini. Give it a short window to land so the greeting can
                // use the caller's name; if it's slower than that, greet generically
                // NOW and inject the context silently once it arrives (better a fast
                // generic greeting than dead air).
                const buildReturningLeadContext = (priorComms) => {
                  if (!priorComms || !priorComms.leadName) return '';
                  let ctx = `\n\nRETURNING CALLER CONTEXT: This caller (${callerPhone}) is ${priorComms.leadName}. `;
                  if (priorComms.lastInteraction) ctx += `Last interaction: ${priorComms.lastInteraction}. `;
                  if (priorComms.serviceNeeded) ctx += `They previously inquired about: ${priorComms.serviceNeeded}. `;
                  if (priorComms.notes) ctx += `Notes: ${priorComms.notes}. `;
                  return ctx;
                };

                let returningLeadContext = '';
                let historyStillPending = false;
                if (callerPhone && callCompanyId) {
                  const HISTORY_WAIT_MS = 250;
                  const raced = await Promise.race([
                    historyPromise,
                    new Promise(resolve => setTimeout(() => resolve('__HISTORY_PENDING__'), HISTORY_WAIT_MS)),
                  ]);
                  if (raced === '__HISTORY_PENDING__') {
                    historyStillPending = true;
                    console.log(`[${assistantName}] Caller history not ready within ${HISTORY_WAIT_MS}ms — greeting now, will inject context when it lands`);
                  } else if (raced && raced.leadName) {
                    returningLeadContext = buildReturningLeadContext(raced) + `Greet them by name and reference your prior conversation. Don't ask for info you already have.`;
                    console.log(`[${assistantName}] Returning lead detected: ${raced.leadName}`);
                  }
                  if (raced && raced !== '__HISTORY_PENDING__' && !callerMemoryInjected && raced.memory && !staffCandidate && !customerLexiVoiceEnabled) {
                    returningLeadContext += callerMemory.instructionBlock(raced.memory);
                    callerMemoryInjected = true;
                  }
                }

                let greetingText;
                const TOOL_FALLBACK_REMINDER = ' If any CRM tool fails, say a brief warm fallback line (e.g. "I\'ll make sure someone follows up right away") and keep the conversation moving — never go silent or repeat yourself.';

                if (staffCandidate) {
                  // STAFF PHONE MODE greeting: short, by first name, straight to the
                  // PIN challenge. Never use the customer greeting or returning-lead
                  // context — the caller is unverified until the PIN check passes.
                  const staffFirstName = (staffCandidate.fullName || '').split(' ')[0] || 'there';
                  greetingText = `An internal team member's phone number just called (matched to ${staffCandidate.fullName}). Greet them VERY briefly by first name ("Hey ${staffFirstName}!") and ask for their voice PIN to unlock CRM access. Keep it to one short sentence. Do not reveal any business information until they are verified.`;
          } else if (customerLexiVoiceEnabled && !isOutboundCall) {
            greetingText = `A homeowner has reached ${companyName}'s customer assistant. Introduce yourself as Lexi, clearly say you are an AI project update assistant, and ask how you can help with their project. Do not share project information until get_customer_public_progress returns a successful result.`;
          } else if (isTransferReturn) {
                  let transferContext = '';
                  if (callerPhone) {
                    const key = callerPhone.replace(/\D/g, '').slice(-10);
                    const saved = transferContextMap.get(key);
                    if (saved) {
                      transferContext = `\n\nPRIOR CONVERSATION (you were JUST speaking with this person before the transfer attempt):\n${saved.transcript}\n\nThe caller's name is: ${saved.callerName || 'unknown'}. You tried to transfer them to ${saved.repName || transferReturnRepName || 'a representative'} but they didn't pick up.`;
                      if (saved.callerName) collectedCallerName = saved.callerName;
                      transferContextMap.delete(key);
                      console.log(`[${assistantName}] Loaded transfer context for returning caller (${saved.transcript.length} chars)`);
                    }
                  }
                  greetingText = `You are ${assistantName}, an AI assistant for ${companyName}. You were JUST speaking with this caller moments ago. The transfer to ${transferReturnRepName || 'the representative'} did not go through — they didn't answer or are not available right now.${transferContext}${returningLeadContext}\n\nIMPORTANT: Do NOT greet them like a new caller and do NOT re-introduce yourself. Your VERY FIRST words must acknowledge the failed transfer naturally — something like: "Hey, I'm back — ${transferReturnRepName || 'they'} isn't picking up right now. I can take a message for ${transferReturnRepName ? 'them' : 'the team'} and make sure they get back to you — what would you like me to pass along, and what's the best number for them to reach you?" Do NOT re-ask for their name or any info you already have. Once you have their message and callback number, call save_lead_details with a note summarizing the message (e.g. "Caller left message for ${transferReturnRepName || 'rep'}: [their message]. Best callback: [number]."), then call notify_rep to send ${transferReturnRepName || 'the rep'} an SMS so they know to follow up immediately.${TOOL_FALLBACK_REMINDER}`;
                } else if (isForwardedCall && callRoutingMode === 'sarah_then_transfer') {
                  greetingText = `A customer just called ${forwardedRepName}'s line. Greet them warmly as ${assistantName}, an AI assistant for ${companyName}, answering for ${forwardedRepName}. YOU MUST identify yourself as an AI assistant in your opening line — this is legally required. Your goal is to: 1) Get their name, phone number, and what they need help with. 2) Save their info using save_lead_details (assign to ${forwardedRepName}). 3) Once you have their info, tell them you'll connect them with ${forwardedRepName} now and call transfer_call. Keep the conversation brief and focused on gathering info before transferring. Remember your name is ${assistantName}.${returningLeadContext}${TOOL_FALLBACK_REMINDER}`;
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
                      parts: [{ text: rewriteVoiceText(greetingText, companyName, spokenBrandName) }]
                    }],
                    turn_complete: true
                  }
                }));
                markLatency('greeting_request_sent');

                // Late-arriving caller history: append it silently (turn_complete:false
                // adds context WITHOUT triggering a new spoken response) so the assistant
                // knows who it's talking to from its next turn onward.
          if (historyStillPending && !customerLexiVoiceEnabled && !staffCandidate) {
                  const lateWs = geminiWs;
                  historyPromise.then((priorComms) => {
                    if (callTerminated || lateWs !== geminiWs || lateWs.readyState !== WebSocket.OPEN) return;
                    const ctx = buildReturningLeadContext(priorComms);
                    const mem = !callerMemoryInjected && priorComms?.memory ? callerMemory.instructionBlock(priorComms.memory) : '';
                    if (!ctx && !mem) return;
                    if (mem) callerMemoryInjected = true;
                    console.log(`[${assistantName}] Late caller history arrived — injecting context for ${priorComms?.leadName || 'caller'}`);
                    lateWs.send(JSON.stringify({
                      client_content: {
                        turns: [{
                          role: "user",
                          parts: [{ text: `[System context — do not read aloud or respond to this directly: ${`${ctx} ${mem}`.trim()} Use their name naturally from now on and don't ask for info you already have.]` }]
                        }],
                        turn_complete: false
                      }
                    }));
                  }).catch(() => {});
                }
              }

              if (data.toolCall) {
                console.log('[Sarah] Gemini requested tool call:', JSON.stringify(data.toolCall));
                const functionCalls = data.toolCall.functionCalls || [];
                const toolResponses = [];

                // Conditional filler: only ask for a spoken "one sec…" if the tools are
                // still running after 600ms. Fast tools (the common case) skip the extra
                // spoken turn entirely, so the model goes straight to the real answer —
                // the unconditional filler used to ADD a full spoken turn of latency.
                let fillerTimer = setTimeout(() => {
                  fillerTimer = null;
                  if (geminiWs.readyState === WebSocket.OPEN) {
                    geminiWs.send(JSON.stringify({
                      client_content: {
                        turns: [{ role: "user", parts: [{ text: "[System: Tool call in progress. Say a brief filler like 'One sec, let me check on that' or 'Sure, pulling that up now' while waiting. Keep it under 8 words.]" }] }],
                        turn_complete: true
                      }
                    }));
                  }
                }, 600);

                // Run ALL requested tools in parallel (they were serial before, so two
                // 3s tools = 6s of silence). Unified 5s per-tool timeout (dev was 4s,
                // prod 8s — same number both sides now).
                const toolResults = await Promise.all(functionCalls.map(async (fc) => {
                  const toolStart = Date.now();
                  let result;
                  try {
                    let toolPromise;
                    if (staffCandidate) {
                      // STAFF PHONE MODE dispatch (mirrored in prod-server.cjs):
                      // verify_staff_pin flips the gate; everything else is
                      // hard-locked server-side until then, and afterwards runs
                      // through the SAME handler the in-app Lexi assistant uses,
                      // attributed to the verified staff member's email.
                      if (fc.name === 'verify_staff_pin') {
                        toolPromise = (async () => {
                          if (staffVerified) return { success: true, message: 'Already verified.' };
                          if (staffPinAttemptsThisCall >= STAFF_PIN_MAX_ATTEMPTS_PER_CALL) {
                            return { success: false, out_of_attempts: true, message: 'No attempts left on this call. Treat the caller as a normal customer with no CRM access.' };
                          }
                          staffPinAttemptsThisCall++;
                          const args = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                          const v = await verifyPinAttempt(getSharedPool(), staffCandidate.staffId, args.pin);
                          if (v.ok) {
                            staffVerified = true;
                            console.log(`[${assistantName}][StaffMode] PIN VERIFIED for ${staffCandidate.userEmail} — CRM tools unlocked`);
                            return { success: true, message: `Verified. You are now assisting ${staffCandidate.fullName} with full CRM access.` };
                          }
                          if (v.locked) {
                            console.warn(`[${assistantName}][StaffMode] PIN LOCKED OUT for ${staffCandidate.userEmail}`);
                            return { success: false, locked_out: true, message: 'Too many failed attempts — voice access is locked for 15 minutes. Treat the caller as a normal customer with no CRM access.' };
                          }
                          const attemptsLeftThisCall = STAFF_PIN_MAX_ATTEMPTS_PER_CALL - staffPinAttemptsThisCall;
                          console.warn(`[${assistantName}][StaffMode] PIN incorrect for ${staffCandidate.userEmail} (${attemptsLeftThisCall} attempts left this call)`);
                          return attemptsLeftThisCall > 0
                            ? { success: false, message: `Incorrect PIN. ${attemptsLeftThisCall} attempt${attemptsLeftThisCall === 1 ? '' : 's'} left — ask them to try again.` }
                            : { success: false, out_of_attempts: true, message: 'Incorrect PIN and no attempts left on this call. Treat the caller as a normal customer with no CRM access.' };
                        })();
                      } else if (!staffVerified) {
                        toolPromise = Promise.resolve({ error: 'LOCKED: The caller has not verified their staff PIN. Ask for their PIN and call verify_staff_pin first. Do not reveal any business information.' });
                      } else {
                        toolPromise = handleLexiLocalToolCall(fc.name, typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {}), callCompanyId, staffCandidate.userEmail);
                      }
                      } else {
                        if (customerLexiVoiceEnabled && !staffCandidate
                          && !CUSTOMER_LEXI_VOICE_TOOLS.some(tool => tool.name === fc.name)) {
                          toolPromise = Promise.resolve({ error: 'LOCKED: Customer Lexi can only read public project progress or request a human callback.' });
                        } else {
                      const dedupeKey = toolDedupeKey(fc.name, fc.args);
                      const cachedCall = toolCallCache.get(dedupeKey);
                      if (cachedCall) {
                        console.log(`[${assistantName}] Duplicate ${fc.name} suppressed — identical request already handled moments ago on this call`);
                        toolPromise = cachedCall;
                      } else {
                        const runTool = () => handleToolCall(fc, callCompanyId, {
                          staffCellPhone,
                          forwardedRepName,
                          subscriberCache,
                          calledTwilioNumber,
                          callerPhone,
                          callSid,
                          schedulingState,
                          customerLexiVoiceEnabled
                        });
                        if (fc.name === 'save_lead_details') {
                          // Queue behind earlier saves so saveLead's call_sid
                          // lookup can see the row a concurrent save just made.
                          toolPromise = leadSaveChain.then(runTool, runTool);
                          leadSaveChain = toolPromise.catch(() => {});
                        } else if (fc.name === 'schedule_inspection') {
                          toolPromise = appointmentScheduleChain.then(runTool, runTool);
                          appointmentScheduleChain = toolPromise.catch(() => {});
                        } else {
                          toolPromise = runTool();
                        }
                        toolCallCache.set(dedupeKey, toolPromise);
                        }
                      }
                    }
                    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tool call timed out after 5s')), 5000));
                    result = await Promise.race([toolPromise, timeoutPromise]);
                    if (fc.name === 'get_customer_public_progress' && result?.voice_script) {
                      customerLexiAudit = {
                        script: result.voice_script,
                        transcript: '',
                        audio: [],
                        audioChars: 0,
                        fallbackAttempt: false,
                      };
                    }
                  } catch (err) {
                    console.error(`[Sarah] Tool call ${fc.name} failed:`, err.message);
                    result = { error: err.message, status: 'failed' };
                  }
                  console.log(`[LATENCY][${callSid || currentStreamSid || '?'}] tool ${fc.name}: ${Date.now() - toolStart}ms`);
                  return result;
                }));
                if (fillerTimer) { clearTimeout(fillerTimer); fillerTimer = null; }

                for (let fcIdx = 0; fcIdx < functionCalls.length; fcIdx++) {
                  const fc = functionCalls[fcIdx];
                  const result = toolResults[fcIdx];
                  toolCallsMade.push(fc.name);
                  conversationLog.push({ role: 'Tool', text: `${fc.name}(${JSON.stringify(fc.args || {})})` });

                  if (fc.name === 'save_lead_details') {
                    const parsedArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                    if (parsedArgs.name) collectedCallerName = parsedArgs.name;
                    if (parsedArgs.phone) callerPhone = parsedArgs.phone;
                    if (parsedArgs.screening_outcome) {
                      callScreeningOutcome = parsedArgs.screening_outcome;
                      console.log(`[${assistantName}] Screening outcome captured via save_lead: ${callScreeningOutcome}`);
                    }
                  }

                  if (fc.name === 'transfer_call') {
                    const parsedTransferArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
                    if (parsedTransferArgs.screening_outcome) {
                      callScreeningOutcome = parsedTransferArgs.screening_outcome;
                      console.log(`[${assistantName}] Screening outcome captured via transfer: ${callScreeningOutcome}`);
                    }
                  }

                  if (fc.name === 'transfer_call' && result?.success && callSid) {
                    const transferCellPhone = result.resolved_cell || staffCellPhone || '';
                    const transferRepName = result.resolved_name || forwardedRepName || '';

                    if (!transferCellPhone) {
                      console.error(`[Sarah] Cannot transfer: no cell phone found (handleToolCall should have caught this)`);
                    } else {
                      if (callerPhone && conversationLog.length > 0) {
                        const summary = conversationLog.map(e => `${e.role}: ${e.text}`).join('\n');
                        transferContextMap.set(callerPhone.replace(/\D/g, '').slice(-10), {
                          transcript: summary,
                          callerName: collectedCallerName || '',
                          repName: transferRepName,
                          timestamp: Date.now()
                        });
                        console.log(`[Sarah] Saved transfer context for ${callerPhone} (${conversationLog.length} exchanges)`);
                        setTimeout(() => {
                          const key = callerPhone.replace(/\D/g, '').slice(-10);
                          if (transferContextMap.has(key)) {
                            transferContextMap.delete(key);
                            console.log(`[Sarah] Expired transfer context for ${key}`);
                          }
                        }, 600000);
                      }
                      saveCallToBase44();
                      console.log(`[Sarah] TRANSFER requested: callSid=${callSid}, cell=${transferCellPhone}, rep=${transferRepName}`);
                      setTimeout(async () => {
                        try {
                          const twilioSettings = await callBase44API('getTwilioSettings', callCompanyId);
                          if (twilioSettings?.account_sid && twilioSettings?.auth_token) {
                            const tSid = twilioSettings.account_sid;
                            const tToken = twilioSettings.auth_token;
                            const authStr = Buffer.from(`${tSid}:${tToken}`).toString('base64');
                            const host = getPublicHost(null);
                            const transferUrl = `https://${host}/twiml/transfer?cellPhone=${encodeURIComponent(transferCellPhone)}&callerId=${encodeURIComponent(twilioSettings.main_phone_number || '')}&repName=${encodeURIComponent(transferRepName)}&callerPhone=${encodeURIComponent(callerPhone || '')}&companyId=${encodeURIComponent(callCompanyId || '')}`;

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
                      }, 1500); // was 2000ms — just enough for the goodbye line to start playing
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

                  // Watchdog nudge: the Live API normally resumes speaking from the
                  // tool_response alone. The old code sent a nudge turn UNCONDITIONALLY,
                  // which forced an extra model turn (a full round-trip of silence) after
                  // every tool call. Now the nudge only fires if no audio arrives within
                  // 1500ms — the audio handler clears this timer.
                  const toolNames = functionCalls.map(fc => fc.name).join(', ');
                  if (postToolNudgeTimer) clearTimeout(postToolNudgeTimer);
                  const nudgeWs = geminiWs;
                  postToolNudgeTimer = setTimeout(() => {
                    postToolNudgeTimer = null;
                    if (callTerminated || nudgeWs !== geminiWs || nudgeWs.readyState !== WebSocket.OPEN) return;
                    console.log(`[Sarah] No audio 1500ms after tool response (${toolNames}) — sending resume nudge`);
                    nudgeWs.send(JSON.stringify({
                      client_content: {
                        turns: [{
                          role: "user",
                          parts: [{ text: `[System: ${toolNames} completed. Now respond to the caller naturally with the result. Keep it brief and conversational.]` }]
                        }],
                        turn_complete: true
                      }
                    }));
                  }, 1500);
                } else {
                  console.error('[Sarah] Gemini WS not open when trying to send tool response, state:', geminiWs.readyState);
                }
              }

              if (data.serverContent?.outputTranscription?.text) {
                // Sarah's audio response transcribed back to text via output_audio_transcription.
                // Gemini Live sends this as outputTranscription.text (NOT outputTranscript) —
                // must match prod-server.cjs exactly (dev/prod lockstep).
                // STAFF PHONE MODE: while unverified, redact digit runs so a
                // read-back PIN never lands in stored transcripts.
                const sarahText = (staffCandidate && !staffVerified)
                  ? redactPinDigits(data.serverContent.outputTranscription.text)
                  : data.serverContent.outputTranscription.text;
                if (sarahText && sarahText.trim()) {
                  if (customerLexiAudit) {
                    customerLexiAudit.transcript += `${customerLexiAudit.transcript ? ' ' : ''}${sarahText.trim()}`;
                  } else {
                    conversationLog.push({ role: assistantName, text: sarahText.trim() });
                    console.log(`[Sarah] Output transcript captured: "${sarahText.substring(0, 80)}..."`);
                  }
                }
              }

              if (data.serverContent?.inputTranscription?.text) {
                // STAFF PHONE MODE: while unverified, redact digit runs so the
                // spoken PIN never lands in conversationLog or the live DB log.
                const transcriptText = (staffCandidate && !staffVerified)
                  ? redactPinDigits(data.serverContent.inputTranscription.text)
                  : data.serverContent.inputTranscription.text;
                conversationLog.push({ role: 'Caller', text: transcriptText });
                // Latency: measure the gap from caller speech to the first audio back
                respPendingSince = Date.now();
                
                // Log to DB for real-time dashboard
                try {
                  const pool = getSharedPool();
                  try {
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
                  } finally {}
                } catch (e) { console.error('[Sarah] Live log error:', e.message); }

                // Start typing-sound loop while AI processes this utterance
                if (typingSoundsEnabled && currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
                  if (typingInterval) clearInterval(typingInterval);
                  typingInterval = setInterval(() => {
                    if (twilioWs.readyState === WebSocket.OPEN && currentStreamSid) {
                      twilioWs.send(JSON.stringify({ event: 'media', streamSid: currentStreamSid, media: { payload: TYPING_CHUNK_MULAW } }));
                    } else {
                      clearInterval(typingInterval);
                      typingInterval = null;
                    }
                  }, 500);
                }
              }

              if (data.serverContent?.modelTurn?.parts) {
                for (const part of data.serverContent.modelTurn.parts) {
                  if (part.text) {
                    const isThinking = /\*\*/.test(part.text) || part.text.includes('I\'m starting') || part.text.includes('I\'ve formulated') || part.text.includes('My immediate focus') || part.text.includes('I will leverage') || part.text.includes('The aim is') || part.text.includes('This fulfills');
                    if (!isThinking && !customerLexiAudit) {
                      conversationLog.push({ role: assistantName, text: part.text });
                      
                      // Log to DB for real-time dashboard
                      try {
                        const pool = getSharedPool();
                        try {
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
                        } finally {}
                      } catch (e) { console.error('[Sarah] Live log error:', e.message); }
                    } else {
                      console.log('[Sarah] Filtered thinking text:', part.text.substring(0, 80));
                    }
                  }
                  if (part.inlineData && part.inlineData.mimeType?.startsWith("audio/")) {
                    // Stop typing sounds — AI is now speaking
                    if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
                    // Audio arrived — the post-tool watchdog nudge is not needed
                    if (postToolNudgeTimer) { clearTimeout(postToolNudgeTimer); postToolNudgeTimer = null; }
                    if (!firstAudioSeen) {
                      firstAudioSeen = true;
                      markLatency('first_audio_from_gemini');
                    }
                    if (respPendingSince) {
                      console.log(`[LATENCY][${callSid || currentStreamSid || '?'}] caller_speech_to_first_audio: ${Date.now() - respPendingSince}ms`);
                      respPendingSince = 0;
                    }
                    if (waitingForOutboundGreeting) {
                      waitingForOutboundGreeting = false;
                      if (outboundGreetingGateTimer) { clearTimeout(outboundGreetingGateTimer); outboundGreetingGateTimer = null; }
                      console.log(`[${assistantName}] Outbound gate: Gemini started speaking — opening caller mic`);
                    }
                    if (currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
                      if (customerLexiAudit) {
                        const audioData = part.inlineData.data || '';
                        customerLexiAudit.audioChars += audioData.length;
                        if (customerLexiAudit.audioChars <= 1_500_000) customerLexiAudit.audio.push(audioData);
                        else customerLexiAudit.oversized = true;
                      } else {
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
              }

              if (data.serverContent?.turnComplete && customerLexiAudit) {
                const audit = customerLexiAudit;
                const exact = !audit.oversized
                  && isExactVoiceProgressTranscript(audit.transcript, audit.script);
                customerLexiAudit = null;
                if (exact && currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
                  for (const audioChunk of audit.audio) {
                    const mulawB64 = geminiToTwilio(audioChunk);
                    twilioWs.send(JSON.stringify({
                      event: 'media',
                      streamSid: currentStreamSid,
                      media: { payload: mulawB64 }
                    }));
                  }
                  conversationLog.push({ role: assistantName, text: audit.script });
                } else if (!audit.fallbackAttempt && geminiWs?.readyState === WebSocket.OPEN) {
                  console.warn('[Lexi Customer Voice] Discarded speech that did not match the verified progress script; retrying with a fixed safe response.');
                  const fallbackScript = 'I could not safely verify your project information. Please contact the office team for help.';
                  customerLexiAudit = {
                    script: fallbackScript, transcript: '', audio: [], audioChars: 0,
                    fallbackAttempt: true,
                  };
                  geminiWs.send(JSON.stringify({
                    client_content: {
                      turns: [{
                        role: 'user',
                        parts: [{ text: `[Security instruction: Say exactly this sentence and nothing else: "${fallbackScript}"]` }],
                      }],
                      turn_complete: true,
                    },
                  }));
                } else {
                  console.warn('[Lexi Customer Voice] Discarded a second response that failed exact transcript validation.');
                }
              }

              if (data.serverContent?.interrupted) {
                console.log('[Sarah] Speech interrupted by caller');
                customerLexiAudit = null;
                // Stop any pending typing-sound loop on interruption
                if (typingInterval) { clearInterval(typingInterval); typingInterval = null; }
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

            // Caller already ended the call, or the line is gone — a normal end, not an error.
            if (callTerminated || twilioWs.readyState !== WebSocket.OPEN || !callSid) {
              saveCallToBase44();
              return;
            }

            // Caller still on the line but Gemini dropped — most drops are transient, so try
            // to reconnect and keep the conversation going instead of dropping the call.
            if (geminiReconnectAttempts < MAX_GEMINI_RECONNECTS) {
              geminiReconnectAttempts++;
              console.log(`[${assistantName}] Gemini connection dropped mid-call (code=${code}, reason=${reason?.toString() || 'none'}); reconnecting ${geminiReconnectAttempts}/${MAX_GEMINI_RECONNECTS} to keep the call alive`);
              setTimeout(() => {
                if (callTerminated || twilioWs.readyState !== WebSocket.OPEN) { saveCallToBase44(); return; }
                try {
                  connectGemini(true).catch((e) => { console.error(`[${assistantName}] Reconnect failed:`, e.message); gracefulHandoff(code); });
                } catch (e) {
                  console.error(`[${assistantName}] Reconnect threw:`, e.message);
                  gracefulHandoff(code);
                }
              }, 400);
              return;
            }

            // Out of reconnect attempts — calm, professional hand-off.
            gracefulHandoff(code);
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
              latT0 = callStartTime;
              latLast = callStartTime;
              const customParams = msg.start.customParameters || {};
              if (customParams.companyId) {
                callCompanyId = customParams.companyId;
              }
              if (customParams.maxCallDuration) {
                maxCallDurationSec = parseInt(customParams.maxCallDuration) || 1800;
              }
              callSid = msg.start.callSid || null;
              callerPhone = customParams.callerPhone || null;
              calledTwilioNumber = customParams.calledNumber || '';
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
              if (customParams.isTransferReturn === 'true') {
                isTransferReturn = true;
                transferReturnRepName = customParams.transferRepName || '';
                console.log(`[Sarah] TRANSFER RETURN: caller=${callerPhone} coming back after failed transfer to ${transferReturnRepName}`);
              }
              if (customParams.isForwardedCall === 'true' || callRoutingMode === 'sarah_then_transfer' || callRoutingMode === 'forward_to_cell') {
                isForwardedCall = true;
                console.log(`[Sarah] ROUTED call: rep=${forwardedRepName}, email=${forwardedRepEmail}, routing=${callRoutingMode}, cell=${staffCellPhone}`);
              }
              const callDirection = isForwardedCall ? 'forwarded' : (isOutboundCall ? 'outbound' : 'inbound');
              console.log(`[Sarah] Stream started: ${currentStreamSid}, company: ${callCompanyId}, caller: ${callerPhone}, callSid: ${callSid}, direction: ${callDirection}, maxDuration: ${maxCallDurationSec}s`);

              // STAFF PHONE MODE candidate check — plain inbound calls only
              // (never outbound campaigns, forwarded-rep lines, or transfer
              // returns). Runs in parallel with the Gemini handshake; the
              // 'open' handler awaits it before building the setup payload.
              // Matching requires an ACTIVE staff profile with a voice PIN
              // set — otherwise the caller gets the normal customer flow.
              if (!isOutboundCall && !isForwardedCall && !isTransferReturn && callerPhone && callCompanyId) {
                staffLookupPromise = findStaffByCallerPhone(getSharedPool(), callCompanyId, callerPhone)
                  .catch((e) => { console.warn('[Sarah][StaffMode] Lookup failed (continuing as customer call):', e.message); return null; });
              }

              // Start a dual-channel Twilio recording for this AI-answered call.
              // <Connect><Stream> never records on its own — without this REST
              // call there is no recording_url for the Communication page.
              // Fire-and-forget: recording failures must never affect the call.
              try {
                const { startCallRecording } = __require('./lib/callRecording.cjs');
                const recPool = getSharedPool();
                startCallRecording({
                  pool: recPool,
                  companyId: callCompanyId,
                  callSid,
                  publicHost: getPublicHost(req.headers),
                  callerPhone: callerPhone || '',
                }).catch(() => {});
              } catch (recErr) {
                console.warn('[Sarah] Could not start call recording (non-critical):', recErr.message);
              }

              setTimeout(() => {
                const elapsed = Math.round((Date.now() - callStartTime) / 1000);
                if (elapsed >= maxCallDurationSec - 5) {
                  console.log(`[${assistantName}] Call duration limit reached (${elapsed}s / ${maxCallDurationSec}s), ending call`);
                  saveCallToBase44();
                  geminiWs?.close();
                  twilioWs.close();
                }
              }, maxCallDurationSec * 1000);

              markLatency('twilio_stream_start');
              connectGemini();
            }

            if (msg.event === 'media' && geminiWs?.readyState === WebSocket.OPEN && setupComplete && !waitingForOutboundGreeting) {
              const pcmB64 = twilioToGemini(msg.media.payload);
              geminiWs.send(JSON.stringify({
                realtime_input: {
                  audio: {
                    mimeType: "audio/pcm;rate=16000",
                    data: pcmB64
                  }
                }
              }));
            }

            if (msg.event === 'stop') {
              console.log('[Sarah] Stream stopped');
              callTerminated = true;
              geminiWs?.close();
            }
          } catch (err) {
            console.error('[Sarah] Twilio message error:', err.message);
          }
        });

        twilioWs.on('close', () => {
          console.log('[Sarah] Twilio stream closed');
          callTerminated = true;
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

      // SSE endpoint for live call push updates (dev mode — keepalive only; broadcasts fire in prod)
      const liveCallSseClients = new Map();
      const LIVE_CALL_SSE_MAX_PER_COMPANY = 25;
      const LIVE_CALL_SSE_MAX_GLOBAL = 500;
      function liveCallSseTotalCount() {
        let total = 0;
        for (const set of liveCallSseClients.values()) total += set.size;
        return total;
      }
      server.middlewares.use('/api/live-call-events', async (req, res) => {
        const urlObj = new URL(req.url, `http://${req.headers.host}`);
        const companyId = urlObj.searchParams.get('companyId');
        if (!companyId) { res.statusCode = 400; res.end('Missing companyId'); return; }
        // Auth: verify session and company membership (inline session parsing, no CJS import needed)
        let sseAuthDenied = false;
        try {
          const SESSION_SECRET = process.env.SESSION_SECRET;
          function parseSseCookies(h) {
            const c = {}; if (!h) return c;
            h.split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) { const k = p.slice(0, i).trim(); try { c[k] = decodeURIComponent(p.slice(i + 1).trim()); } catch { c[k] = p.slice(i + 1).trim(); } } });
            return c;
          }
          function unsignSseCookie(v, secret) {
            if (!v || !v.startsWith('s:')) return null;
            const val = v.slice(2); const dot = val.lastIndexOf('.');
            if (dot === -1) return null;
            const sid = val.slice(0, dot); const sig = val.slice(dot + 1);
            const expected = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
            return sig === expected ? sid : null;
          }
          const pool = getSharedPool();
          let userEmail = '';
          try {
            if (SESSION_SECRET) {
              const cookies = parseSseCookies(req.headers.cookie);
              const signedSid = cookies['connect.sid'];
              const sid = signedSid ? unsignSseCookie(signedSid, SESSION_SECRET) : null;
              if (sid) {
                const result = await pool.query('SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()', [sid]);
                if (result.rows.length > 0) {
                  const sess = result.rows[0].sess;
                  const sessData = typeof sess === 'string' ? JSON.parse(sess) : sess;
                  const su = sessData?.passport?.user || sessData?.user;
                  userEmail = ((su?.claims?.email || su?.email) || '').toLowerCase();
                }
              }
            }
            if (!userEmail) {
              sseAuthDenied = true;
              res.statusCode = 401;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Not authenticated' }));
              return;
            }
            const memberCheck = await pool.query(
              `SELECT 1 FROM staff_profiles WHERE company_id = $1 AND LOWER(user_email) = $2 AND is_active = true LIMIT 1`,
              [companyId, userEmail]
            );
            const ownerCheck = memberCheck.rows.length === 0
              ? await pool.query(`SELECT 1 FROM companies WHERE id = $1 AND LOWER(created_by) = $2 LIMIT 1`, [companyId, userEmail])
              : { rows: [] };
            if (memberCheck.rows.length === 0 && ownerCheck.rows.length === 0) {
              sseAuthDenied = true;
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Not authorized for this company' }));
              return;
            }
          } finally {
          }
        } catch (authErr) {
          console.warn('[SSE-dev] Auth check failed:', authErr.message);
          if (!sseAuthDenied) { res.statusCode = 500; res.end('Auth error'); }
          return;
        }
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.statusCode = 200;
        res.write(': connected\n\n');
        if (!liveCallSseClients.has(companyId)) liveCallSseClients.set(companyId, new Set());
        // Enforce global connection cap: evict the oldest stream in the largest company when full
        if (liveCallSseTotalCount() >= LIVE_CALL_SSE_MAX_GLOBAL) {
          let largestSet = null;
          let largestCompanyId = null;
          for (const [cid, set] of liveCallSseClients.entries()) {
            if (!largestSet || set.size > largestSet.size) { largestSet = set; largestCompanyId = cid; }
          }
          if (largestSet && largestSet.size > 0) {
            const oldest = largestSet.values().next().value;
            console.warn(`[SSE-dev] Global cap of ${LIVE_CALL_SSE_MAX_GLOBAL} reached — evicting oldest stream from company ${largestCompanyId} (had ${largestSet.size} connections)`);
            try { oldest.write('event: error\ndata: {"reason":"connection_limit"}\n\n'); oldest.end(); } catch (_) {}
            largestSet.delete(oldest);
            if (largestSet.size === 0) liveCallSseClients.delete(largestCompanyId);
          }
        }
        // Re-fetch (or re-create) sseSet after any eviction that may have deleted this company's entry
        if (!liveCallSseClients.has(companyId)) liveCallSseClients.set(companyId, new Set());
        const sseSet = liveCallSseClients.get(companyId);
        // Enforce per-company connection cap: evict the oldest stream when full
        if (sseSet.size >= LIVE_CALL_SSE_MAX_PER_COMPANY) {
          const oldest = sseSet.values().next().value;
          console.warn(`[SSE-dev] Company ${companyId} hit ${LIVE_CALL_SSE_MAX_PER_COMPANY}-connection cap — evicting oldest stream`);
          try { oldest.write('event: error\ndata: {"reason":"connection_limit"}\n\n'); oldest.end(); } catch (_) {}
          sseSet.delete(oldest);
        }
        sseSet.add(res);
        const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25000);
        req.on('close', () => {
          clearInterval(keepAlive);
          const set = liveCallSseClients.get(companyId);
          if (set) { set.delete(res); if (set.size === 0) liveCallSseClients.delete(companyId); }
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
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const current = loadSettings();
              const updated = { ...current, ...data };
              saveSettings(updated);
              console.log(`[Sarah] Voice settings updated:`, updated);
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
            const voiceName = voice || 'Puck';
            const previewText = text || "Say in a friendly, professional tone: Hi there! This is your AI assistant calling from the roofing company. How can I help you today?";
            const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
            if (!apiKey) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Gemini API key not configured' }));
              return;
            }

            console.log(`[Sarah] Generating real Gemini voice preview: voice=${voiceName}`);

            const geminiRes = await fetchWithRetry(
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
              },
              { timeoutMs: 30000 }
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
        readBodyWithLimit(req, 1 * 1024 * 1024).then(async raw => {
          const data = JSON.parse(raw);
          if (data.phone_number && data.company_id) {
            const pool = getSharedPool();
            await authorizeTwilioTenant({ req, pool, companyId: data.company_id });
            await assertTwilioIdentityAvailable({
              pool,
              companyId: data.company_id,
              accountSid: data.twilio_sid,
              phoneNumber: data.phone_number,
            });
            if (data.validate_only === true) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, validated: true }));
              return;
            }
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
        }).catch(err => {
          const status = err?.statusCode === 413 ? 413 : 500;
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
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
            if (!account_sid || !auth_token || !phone_number || !company_id) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'account_sid, auth_token, phone_number, and company_id required' }));
              return;
            }
            const tenantPool = getSharedPool();
            await authorizeTwilioTenant({ req, pool: tenantPool, companyId: company_id });
            await assertTwilioIdentityAvailable({
              pool: tenantPool,
              companyId: company_id,
              accountSid: account_sid,
              phoneNumber: phone_number,
            });
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
            res.statusCode = err?.statusCode || 500;
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

      // Twilio recording-status callback for AI-answered + forwarded calls.
      // MUST stay mirrored in prod-server.cjs (dev/prod endpoint parity) —
      // the shared logic lives in lib/callRecording.cjs.
      server.middlewares.use('/api/functions/recordingWebhook', (req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
          try {
            const { getPool } = await import('./db/schema.js');
            const { handleRecordingWebhook } = __require('./lib/callRecording.cjs');
            // Connect strips the mount path from req.url — pass the full
            // original URL so Twilio signature validation sees what was signed.
            await handleRecordingWebhook(req, res, body, getPool(), {
              fullUrl: req.originalUrl || `/api/functions/recordingWebhook${req.url === '/' ? '' : req.url}`,
            });
          } catch (e) {
            console.error('[CallRecording] Dev webhook route error:', e.message);
            if (!res.headersSent) { res.statusCode = 200; res.end('ERROR'); }
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

          try {
            const { getPool } = await import('./db/schema.js');
            const { verifyTwilioWebhook, shouldRejectTwilio } = __require('./lib/twilioSignature.cjs');
            const result = await verifyTwilioWebhook(req, body, getPool());
            if (shouldRejectTwilio(result, 'twiml/voice')) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'text/xml');
              res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
              return;
            }
          } catch (e) { console.warn('[Sarah] Twilio signature check error (voice):', e.message); }

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
              const fwdHost = getPublicHost(req.headers);
              const recCallbackUrl = `https://${fwdHost}/api/functions/recordingWebhook?callerPhone=${encodeURIComponent(callerPhone)}&repName=${encodeURIComponent(forwardedRepName)}&companyId=${encodeURIComponent(resolvedCompanyId)}`;
              const forwardTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="${calledNumber}" timeout="20"
          record="record-from-ringing-dual"
          recordingStatusCallback="${recCallbackUrl}"
          recordingStatusCallbackMethod="POST"
          action="https://${fwdHost}/twiml/forward-fallback?companyId=${resolvedCompanyId}&amp;callerPhone=${encodeURIComponent(callerPhone)}&amp;repName=${encodeURIComponent(forwardedRepName)}&amp;repEmail=${encodeURIComponent(forwardedRepEmail)}&amp;maxDuration=${maxCallDuration}">
        <Number>${cellPhone}</Number>
    </Dial>
</Response>`;
              res.setHeader('Content-Type', 'text/xml');
              res.end(forwardTwiml);
              console.log(`[Sarah] FORWARD TO CELL: ${callerPhone} -> ${cellPhone} for ${forwardedRepName} (recording enabled)`);
              return;
            }
          }

          const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Connect>
        <Stream url="wss://${getPublicHost(req.headers)}/ws/twilio">
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
          let dialDuration = 0;
          try {
            const params = new URLSearchParams(body);
            dialStatus = params.get('DialCallStatus') || '';
            dialDuration = parseInt(params.get('DialCallDuration') || '0', 10);
          } catch (e) {}
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

          const host = getPublicHost(req.headers);
          const companyId = urlParams.get('companyId') || '';
          const transferFallbackUrl = `https://${host}/twiml/transfer-fallback?callerPhone=${encodeURIComponent(callerPhone)}&amp;repName=${encodeURIComponent(repName)}&amp;companyId=${encodeURIComponent(companyId)}`;
          const transferTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Let me transfer you to ${repName || 'your representative'} now. One moment please.</Say>
    <Dial callerId="${callerIdNumber || ''}" timeout="30" action="${transferFallbackUrl}">
        <Number>${cellPhone}</Number>
    </Dial>
</Response>`;
          res.setHeader('Content-Type', 'text/xml');
          res.end(transferTwiml);
          console.log(`[Sarah] TRANSFER: connecting ${callerPhone} to ${cellPhone} for rep ${repName}`);
        });
      });

      server.middlewares.use('/twiml/transfer-fallback', (req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
          const callerPhone = urlParams.get('callerPhone') || '';
          const repName = urlParams.get('repName') || '';
          const companyId = urlParams.get('companyId') || '';

          let dialStatus = '';
          let dialDuration = 0;
          try {
            const params = new URLSearchParams(body);
            dialStatus = params.get('DialCallStatus') || '';
            dialDuration = parseInt(params.get('DialCallDuration') || '0', 10);
          } catch (e) {}

          console.log(`[Sarah] Transfer fallback: dialStatus=${dialStatus}, dialDuration=${dialDuration}s, caller=${callerPhone}, rep=${repName}`);

          if (dialStatus === 'completed' && dialDuration > 15) {
            res.setHeader('Content-Type', 'text/xml');
            res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
            return;
          }

          const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${repName || 'The representative'} wasn't able to pick up. Let me reconnect you with your assistant.</Say>
    <Connect>
        <Stream url="wss://${getPublicHost(req.headers)}/ws/twilio">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${callerPhone}" />
            <Parameter name="maxCallDuration" value="1800" />
            <Parameter name="isForwardedCall" value="false" />
            <Parameter name="isTransferReturn" value="true" />
            <Parameter name="transferRepName" value="${repName}" />
            <Parameter name="callRoutingMode" value="sarah_answers" />
        </Stream>
    </Connect>
</Response>`;
          res.setHeader('Content-Type', 'text/xml');
          res.end(fallbackTwiml);
          console.log(`[Sarah] Transfer failed (${dialStatus}), reconnecting caller ${callerPhone} to Sarah with prior context`);
        });
      });

      server.middlewares.use('/twiml/outbound', async (req, res) => {
        let body = '';
        try {
          body = await readBodyWithLimit(req, 1 * 1024 * 1024);
        } catch (e) {
          if (e?.statusCode === 413) {
            res.statusCode = 413;
            res.setHeader('Content-Type', 'text/xml');
            res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
            return;
          }
        }

        try {
          const { getPool } = await import('./db/schema.js');
          const { verifyTwilioWebhook, shouldRejectTwilio } = __require('./lib/twilioSignature.cjs');
          const result = await verifyTwilioWebhook(req, body, getPool());
          if (!result.valid || shouldRejectTwilio(result, 'twiml/outbound')) {
            res.statusCode = 403;
            res.setHeader('Content-Type', 'text/xml');
            res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
            return;
          }
        } catch (e) {
          console.warn('[Sarah] Twilio signature check error (outbound):', e.message);
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/xml');
          res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
          return;
        }

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

        if (!companyId) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/xml');
          res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>');
          return;
        }

        // Voice-minutes cap: platform-Twilio companies are capped at 500 min/mo.
        // BYOK-Twilio companies skip the cap entirely (unlimited as sold).
        // Mirrors the check in the inbound /twiml/voice handler — keep in LOCKSTEP.
        try {
          const voiceAccess = await localCheckVoiceAccess(companyId);
          if (voiceAccess?.allowed === false) {
            console.warn(`[Sarah] Outbound voice blocked for ${companyId}: ${voiceAccess.reason}`);
            res.setHeader('Content-Type', 'text/xml');
            res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We're sorry, this call cannot be completed. ${voiceAccess.reason || 'Voice service is unavailable.'}</Say><Hangup/></Response>`);
            return;
          }
        } catch (e) {
          console.warn('[Sarah] Outbound voice access check failed — allowing:', e.message);
        }

        const publicHost = getPublicHost(req.headers);
        const wsUrl = `wss://${publicHost}/ws/twilio`;

        // Fetch campaign details from DB if we have a campaignId
        let introScript = '';
        let talkingPoints = '';
        let callGoals = '';

        let urlIntroScript = '';
        let urlTalkingPoints = '';
        let urlCallGoals = '';
        let urlCampaignJson = '';
        try {
          const url2 = new URL(req.url, `https://${getPublicHost(req.headers)}`);
          urlIntroScript = url2.searchParams.get('introScript') || '';
          urlTalkingPoints = url2.searchParams.get('talkingPoints') || '';
          urlCallGoals = url2.searchParams.get('callGoals') || '';
          urlCampaignJson = url2.searchParams.get('campaign') || '';
        } catch (e) {}

        // Full campaign object assembled from DB (all fields) or URL fallback params
        let campaignObj = null;

        // Priority 1: pre-built campaign JSON passed directly in URL (from Deno function or dev handler)
        if (urlCampaignJson) {
          try { campaignObj = JSON.parse(urlCampaignJson); } catch(e) { campaignObj = null; }
          if (campaignObj) {
            introScript = campaignObj.intro || '';
            talkingPoints = campaignObj.points || '';
            callGoals = campaignObj.goals || '';
            console.log(`[Sarah] TwiML/outbound: using pre-built campaign JSON from URL (${urlCampaignJson.length} chars), intro=${introScript ? 'yes' : 'empty'}`);
          }
        }
        // Priority 2: DB lookup (for campaigns stored locally — fallback if no URL JSON provided)
        if (campaignId && !campaignObj) {
          try {
            const pool = getSharedPool();
            try {
              const { rows } = await pool.query(
                `SELECT data FROM generic_entities WHERE entity_type = 'OutboundCampaign' AND id = $1 LIMIT 1`,
                [campaignId]
              );
              if (rows.length > 0) {
                const c = rows[0].data;
                introScript = c.intro_script || '';
                talkingPoints = c.talking_points || '';
                callGoals = c.goals || '';
                campaignObj = {
                  id: campaignId,
                  name: c.name || '',
                  intro: c.intro_script || '',
                  points: c.talking_points || '',
                  goals: c.goals || '',
                  knowledge_base: c.knowledge_base || '',
                  objection_handling: c.objection_handling || [],
                  example_conversations: c.example_conversations || [],
                  dos: c.dos || [],
                  donts: c.donts || [],
                  campaign_system_prompt: c.campaign_system_prompt || '',
                  custom_greeting: c.custom_greeting || '',
                  bailout_message: c.bailout_message || '',
                  tone_style: c.tone_style || '',
                  humor_level: c.humor_level ?? 20,
                  ai_identification: c.ai_identification ?? true,
                  ai_identification_text: c.ai_identification_text || '',
                };
                console.log(`[Sarah] TwiML/outbound: loaded campaign from local DB — ${c.name || campaignId}`);
              }
            } finally {}
          } catch (e) { console.error('[Sarah] Campaign fetch error:', e.message); }
        }

        // Priority 3: individual URL params fallback (legacy or direct dev test calls)
        if (!introScript && urlIntroScript) introScript = urlIntroScript;
        if (!talkingPoints && urlTalkingPoints) talkingPoints = urlTalkingPoints;
        if (!callGoals && urlCallGoals) callGoals = urlCallGoals;

        // If still no campaign object but we have script text, build a minimal one
        if (!campaignObj && (introScript || talkingPoints || callGoals)) {
          campaignObj = {
            id: campaignId || '',
            intro: introScript,
            points: talkingPoints,
            goals: callGoals,
          };
        }

        const campaignJson = campaignObj
          ? JSON.stringify(campaignObj).substring(0, 3000)
          : '';

        console.log(`[Sarah] TwiML/outbound: campaign=${campaignId}, intro=${introScript ? 'yes' : 'empty'}, campaignJson=${campaignJson ? campaignJson.length + 'chars' : 'none'}`);

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
            <Parameter name="campaign" value="${campaignJson.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}" />
            <Parameter name="introScript" value="${(introScript || '').substring(0, 800).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}" />
            <Parameter name="talkingPoints" value="${(talkingPoints || '').substring(0, 800).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}" />
            <Parameter name="callGoals" value="${(callGoals || '').substring(0, 400).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}" />
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

            const pool = getSharedPool();
            const authorization = await authorizeOutboundCall({ req, pool, companyId });
            if (!authorization.allowed) {
              res.statusCode = authorization.statusCode;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: authorization.error }));
              return;
            }
            const destination = normalizeOutboundDestination(leadPhone);
            if (!destination) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'A valid E.164 destination phone number is required' }));
              return;
            }
            const rate = consumeOutboundCallRateLimit(companyId);
            if (!rate.allowed) {
              res.statusCode = 429;
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Retry-After', String(rate.retryAfter));
              res.end(JSON.stringify({ error: 'Too many outbound calls', retryAfter: rate.retryAfter }));
              return;
            }
            const voiceAccess = await localCheckVoiceAccess(companyId);
            if (voiceAccess?.allowed === false) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: voiceAccess.reason || 'Voice service is unavailable' }));
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

            const cleanTo = destination;
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

            try {
              const { getPool } = await import('./db/schema.js');
              const { verifyTwilioWebhook, shouldRejectTwilio } = __require('./lib/twilioSignature.cjs');
              const twResult = await verifyTwilioWebhook(req, body, getPool());
              if (shouldRejectTwilio(twResult, 'whatsapp-webhook')) {
                res.statusCode = 403;
                res.setHeader('Content-Type', 'text/xml');
                res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
                return;
              }
            } catch (e) { console.warn('[Sarah] Twilio signature check error (whatsapp):', e.message); }

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
                // Look up contact name for rep-routed SMS
                let repRouteContactName = cleanFrom;
                try {
                  const custR = await pool.query(`SELECT name FROM customers WHERE company_id = $1 AND (phone = $2 OR phone_2 = $2) AND name IS NOT NULL AND name != '' LIMIT 1`, [resolvedCompanyId, cleanFrom]);
                  if (custR.rows.length > 0) repRouteContactName = custR.rows[0].name;
                  else {
                    const leadR = await pool.query(`SELECT name FROM leads WHERE company_id = $1 AND phone = $2 AND name IS NOT NULL AND name != '' LIMIT 1`, [resolvedCompanyId, cleanFrom]);
                    if (leadR.rows.length > 0) repRouteContactName = leadR.rows[0].name;
                  }
                } catch (e) {}
                await pool.query(
                  `INSERT INTO communications
                     (id, company_id, communication_type, direction, contact_phone, contact_name,
                      body, message, status, is_read, data, created_at, updated_at)
                   VALUES ($1,$2,'sms','inbound',$3,$4,$5,$5,'received',false,$6,NOW(),NOW())`,
                  [
                    commId,
                    resolvedCompanyId,
                    cleanFrom,
                    repRouteContactName,
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

            try {
              const { getPool } = await import('./db/schema.js');
              const { verifyTwilioWebhook, shouldRejectTwilio } = __require('./lib/twilioSignature.cjs');
              const twResult = await verifyTwilioWebhook(req, body, getPool());
              if (shouldRejectTwilio(twResult, 'sarah-missed-call')) {
                res.statusCode = 403;
                res.end('Forbidden');
                return;
              }
            } catch (e) { console.warn('[Sarah] Twilio signature check error (missed-call):', e.message); }

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
