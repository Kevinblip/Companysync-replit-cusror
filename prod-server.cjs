const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const prodDb = require('./db/prod-db.cjs');
const prodAuth = require('./db/prod-auth.cjs');
const prodIntegrations = require('./db/prod-integrations.cjs');
const localAuth = require('./db/local-auth.cjs');
const nodemailer = require('nodemailer');

async function sendEmail({ to, subject, html, message, from, cc }) {
  const fromAddr = from || process.env.EMAIL_FROM || 'CompanySync <noreply@resend.dev>';
  const toArr = Array.isArray(to) ? to : [to];
  const ccArr = cc ? (Array.isArray(cc) ? cc : cc.split(',').map(e => e.trim()).filter(Boolean)) : [];
  const htmlBody = html || (message ? `<div style="font-family:sans-serif;white-space:pre-wrap">${message}</div>` : '');

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpPort = parseInt(process.env.SMTP_PORT || '587');

  if (smtpHost && smtpUser && smtpPass) {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });
    const mailOpts = {
      from: fromAddr,
      to: toArr.join(', '),
      subject: subject || 'No Subject',
      html: htmlBody
    };
    if (ccArr.length > 0) mailOpts.cc = ccArr.join(', ');
    const info = await transporter.sendMail(mailOpts);
    console.log('[Email] Sent via SMTP:', info.messageId, '→', toArr.join(', '), ccArr.length ? `(CC: ${ccArr.join(', ')})` : '');
    return { success: true, id: info.messageId };
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error('No email provider configured — set SMTP_HOST/SMTP_USER/SMTP_PASS or RESEND_API_KEY');

  const payload = { from: fromAddr, to: toArr, subject: subject || 'No Subject', html: htmlBody };
  if (ccArr.length > 0) payload.cc = ccArr;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await resp.json();
  if (data.id) return { success: true, id: data.id };
  throw new Error(data.message || 'Email send failed');
}

let stripeClient = null;
async function getStripeClientProd() {
  if (stripeClient) return stripeClient;
  try {
    const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
    const xReplitToken = process.env.WEB_REPL_RENEWAL ? 'depl ' + process.env.WEB_REPL_RENEWAL : (process.env.REPL_IDENTITY ? 'repl ' + process.env.REPL_IDENTITY : null);
    if (!xReplitToken || !hostname) return null;
    const url = new URL(`https://${hostname}/api/v2/connection`);
    url.searchParams.set('include_secrets', 'true');
    url.searchParams.set('connector_names', 'stripe');
    url.searchParams.set('environment', process.env.REPLIT_DEPLOYMENT === '1' ? 'production' : 'development');
    const resp = await fetch(url.toString(), { headers: { 'Accept': 'application/json', 'X-Replit-Token': xReplitToken } });
    const data = await resp.json();
    const cs = data.items?.[0];
    if (!cs?.settings?.secret) return null;
    const Stripe = require('stripe');
    stripeClient = new Stripe(cs.settings.secret);
    return stripeClient;
  } catch (e) { console.error('[Stripe] Init error:', e.message); return null; }
}

async function billAIUsage(companyId, units = 1) {
  if (!companyId || companyId === 'companysync_master_001') return;
  try {
    const stripe = await getStripeClientProd();
    if (!stripe) return;
    const pool = prodDb.getPool();
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'CompanySubscription' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const sub = rows[0]?.data;
    if (!sub?.stripe_subscription_id || !sub?.ai_usage_item_id) return;
    if (sub.plan === 'trial') return;
    await stripe.subscriptionItems.createUsageRecord(sub.ai_usage_item_id, { quantity: units, timestamp: Math.floor(Date.now() / 1000), action: 'increment' });
  } catch (e) { console.error('[Billing] AI usage billing failed (non-blocking):', e.message); }
}

const USAGE_UNIT_COSTS_PROD = { lexi: 0.05, sarah: 0.10, sms_ai: 0.02, ai_estimator: 0.08, marcus: 0.06, crew_cam: 0.12 };
async function logUsageEvent(companyId, feature, units = 1) {
  if (!companyId || companyId === 'companysync_master_001') return;
  try {
    const pool = prodDb.getPool();
    const unitCost = USAGE_UNIT_COSTS_PROD[feature] || 0.05;
    const totalCost = unitCost * units;
    const usageMonth = new Date().toISOString().slice(0, 7);
    const id = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const data = { company_id: companyId, feature, units, unit_cost: unitCost, total_cost: totalCost, usage_month: usageMonth, logged_at: new Date().toISOString() };
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
      [id, companyId, JSON.stringify(data)]
    );
  } catch (e) { console.error('[Usage] Failed to log usage event:', e.message); }
}

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception (kept alive):', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection (kept alive):', reason?.message || reason);
});

const PORT = parseInt(process.env.PORT || '5000', 10);
const DIST_DIR = path.resolve(__dirname);
const SETTINGS_FILE = path.resolve('.sarah-voice-settings.json');

// Cache index.html in memory at startup for instant health-check responses
let INDEX_HTML_CACHE = null;
try {
  INDEX_HTML_CACHE = fs.readFileSync(path.join(DIST_DIR, 'index.html'), 'utf8');
  console.log('[Server] index.html cached in memory (' + INDEX_HTML_CACHE.length + ' bytes)');
} catch (e) {
  console.warn('[Server] Could not cache index.html:', e.message);
}

const BASE44_API_URL = process.env.BASE44_SARAH_API_URL || '';
const BRIDGE_SECRET = process.env.SARAH_BRIDGE_SECRET || '';
const DEFAULT_COMPANY_ID = '695944e3c1fb00b7ab716c6f';

const LEXI_BRIDGE_API_URL = process.env.BASE44_LEXI_BRIDGE_API_URL || '';
const LEXI_BRIDGE_SECRET = process.env.LEXI_NATIVE_BRIDGE_SECRET || '';

// ============================================================
// IN-MEMORY SUBSCRIBER CACHE
// Maps Twilio phone numbers -> subscriber routing config
// Refreshed when subscribers save settings, or periodically
// ============================================================
const subscriberCache = new Map(); // key: normalized phone number, value: { companyId, companyName, assistantName, routingMode, cellPhone, repName, repEmail, twilioSid, twilioToken, twilioPhone }
let cacheLastRefreshed = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

function removeCachedSubscriber(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);
  subscriberCache.delete(normalized);
}

// Nickname → common full-name aliases (bidirectional)
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

function generateTwilioToken(accountSid, apiKeySid, apiKeySecret, identity, twimlAppSid, ttl = 3600) {
  const twilio = require('twilio');
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

async function refreshCacheFromAPI() {
  if (!BASE44_API_URL || !BRIDGE_SECRET) return;
  try {
    const result = await callBase44API('getAllSubscriberRouting', null);
    if (result?.subscribers && Array.isArray(result.subscribers)) {
      for (const sub of result.subscribers) {
        if (sub.phone_number) {
          setCachedSubscriber(sub.phone_number, {
            companyId: sub.company_id,
            companyName: sub.company_name || '',
            assistantName: sub.assistant_name || 'Sarah',
            routingMode: sub.routing_mode || 'sarah_answers',
            cellPhone: sub.cell_phone || '',
            repName: sub.rep_name || '',
            repEmail: sub.rep_email || '',
            twilioSid: sub.twilio_sid || '',
            twilioToken: sub.twilio_token || '',
            twilioPhone: sub.twilio_phone || '',
            availabilityStatus: sub.availability_status || 'available',
          });
        }
      }
      cacheLastRefreshed = Date.now();
      console.log(`[Cache] Refreshed: ${result.subscribers.length} subscriber numbers cached`);
    }
  } catch (err) {
    console.warn('[Cache] Full refresh failed:', err.message);
  }
}

// Refresh cache periodically
setInterval(async () => {
  if (Date.now() - cacheLastRefreshed > CACHE_TTL_MS) {
    await refreshCacheFromAPI();
  }
}, 60000);

// Process workflow queue every 60 seconds
setInterval(async () => {
  try {
    const prodDb = require('./db/prod-db.cjs');
    const pool = prodDb.getPool();
    const prodIntegrations = require('./db/prod-integrations.cjs');
    const now = new Date();

    const activeResult = await pool.query(
      `SELECT * FROM generic_entities WHERE entity_type = 'WorkflowExecution'
       AND (data->>'status' = 'active' OR data->>'status' = 'waiting_for_trigger')
       LIMIT 100`
    );

    const executions = activeResult.rows;
    if (executions.length === 0) return;
    console.log(`[Cron:processWorkflowQueue] Found ${executions.length} active executions`);
    let processed = 0;

    for (const execRow of executions) {
      try {
        const exec = typeof execRow.data === 'string' ? JSON.parse(execRow.data) : (execRow.data || {});
        if (exec.status === 'active' && exec.next_run_at && new Date(exec.next_run_at) > now) continue;

        const workflowResult = await pool.query(
          `SELECT * FROM generic_entities WHERE entity_type = 'Workflow' AND id = $1`,
          [exec.workflow_id]
        );
        if (workflowResult.rows.length === 0) {
          await pool.query(`UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{status}', '"error"'), updated_date = NOW() WHERE id = $1`, [execRow.id]);
          continue;
        }

        const workflow = typeof workflowResult.rows[0].data === 'string' ? JSON.parse(workflowResult.rows[0].data) : (workflowResult.rows[0].data || {});
        const steps = workflow.actions || workflow.steps || [];
        const currentStep = exec.current_step || 0;

        if (currentStep >= steps.length) {
          await pool.query(`UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{status}', '"completed"'), updated_date = NOW() WHERE id = $1`, [execRow.id]);
          processed++;
          continue;
        }

        const step = steps[currentStep];
        const actionType = step.action_type || step.action || step.type;

        if (actionType === 'delay' || actionType === 'wait') {
          const delayMs = (step.config?.minutes || step.minutes || step.delay_minutes || 5) * 60000;
          const nextRunAt = new Date(now.getTime() + delayMs);
          await pool.query(`UPDATE generic_entities SET data = jsonb_set(jsonb_set(data::jsonb, '{current_step}', $2::jsonb), '{next_run_at}', $3::jsonb), updated_date = NOW() WHERE id = $1`,
            [execRow.id, JSON.stringify(currentStep + 1), JSON.stringify(nextRunAt.toISOString())]);
          processed++;
          continue;
        }

        const entityData = exec.entity_data || {};
        await prodIntegrations.executeProdWorkflowAction(pool, step, entityData, exec.company_id || execRow.company_id, exec.entity_type, exec.entity_id);

        const nextStep = currentStep + 1;
        const newStatus = nextStep >= steps.length ? 'completed' : 'active';
        await pool.query(`UPDATE generic_entities SET data = jsonb_set(jsonb_set(data::jsonb, '{current_step}', $2::jsonb), '{status}', $3::jsonb), updated_date = NOW() WHERE id = $1`,
          [execRow.id, JSON.stringify(nextStep >= steps.length ? 0 : nextStep), JSON.stringify(newStatus)]);
        processed++;
      } catch (execErr) {
        console.error(`[Cron:processWorkflowQueue] Execution ${execRow.id} error:`, execErr.message);
      }
    }
    console.log(`[Cron:processWorkflowQueue] Complete: ${processed}/${executions.length} processed`);
  } catch (err) {
    if (err.message && !err.message.includes('Cannot find module')) {
      console.error('[Cron:processWorkflowQueue] Error:', err.message);
    }
  }
}, 60000);

// Send timezone-aware morning (5am) and EOD (8pm) reports every 15 minutes
setInterval(async () => {
  try {
    const resp = await fetch('http://localhost:5000/api/functions/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: 'sendScheduledDailyReports', params: {} }),
    });
    const result = await resp.json();
    if (result.success) {
      const r = result.results || {};
      const triggered = [...(r.morning_triggered || []), ...(r.eod_triggered || [])];
      if (triggered.length > 0) {
        console.log(`[Cron:sendScheduledDailyReports] Triggered reports for: ${triggered.join(', ')}`);
      } else {
        console.log('[Cron:sendScheduledDailyReports] No reports due at this time');
      }
    } else if (result.error) {
      console.error('[Cron:sendScheduledDailyReports] Error:', result.error);
    }
  } catch (err) {
    console.error('[Cron:sendScheduledDailyReports] Failed:', err.message);
  }
}, 15 * 60 * 1000);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.map': 'application/json',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

const BASE44_MARKETING_DOMAIN = process.env.BASE44_MARKETING_DOMAIN || '';

function getAllowedOrigins() {
  const origins = [
    'https://getcompanysync.com',
    'https://company-sync-crm-bf62df1e.base44.app',
    'https://companysync.io',
    'https://www.companysync.io',
  ];
  if (BASE44_MARKETING_DOMAIN) {
    const domain = BASE44_MARKETING_DOMAIN.replace(/\/+$/, '');
    if (!domain.startsWith('http')) {
      origins.push(`https://${domain}`);
      origins.push(`http://${domain}`);
    } else {
      origins.push(domain);
    }
  }
  const appUrl = process.env.VITE_REPLIT_APP_URL || '';
  if (appUrl) origins.push(appUrl.replace(/\/+$/, ''));
  return origins;
}

function setCorsHeaders(res, req) {
  const origin = req?.headers?.origin || '';
  const allowed = getAllowedOrigins();
  const isAllowed = origin && (
    allowed.some(a => origin === a || origin.startsWith(a)) ||
    origin.endsWith('.replit.app') ||
    origin.endsWith('.replit.dev')
  );
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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

function getPublicHost(reqHeaders) {
  const envUrl = process.env.VITE_REPLIT_APP_URL || '';
  if (envUrl) {
    try { return new URL(envUrl).host; } catch (e) {}
  }
  return reqHeaders?.host || 'localhost:5000';
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function localGetSettings(companyId) {
  const pool = prodDb.getPool();
  try {
    const { rows: settingsRows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
      [companyId]
    );
    const settings = settingsRows[0]?.data || {};

    const { rows: companyRows } = await pool.query(`SELECT name, data, preferred_language FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
    const company = companyRows[0] || {};
    const companyName = settings.brand_short_name || company.name || company.data?.company_name || 'our company';
    const companyTimezone = company.data?.timezone || 'America/New_York';
    const preferredLanguage = company.preferred_language || 'en';

    const rawName = (settings.assistant_name || 'Sarah').trim();
    const assistantDisplayName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    let knowledgeParts = [];

    try {
      const { rows: memories } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'AIMemory' AND company_id = $1 AND (data->>'is_active')::boolean = true ORDER BY (data->>'importance')::int DESC NULLS LAST LIMIT 50`,
        [companyId]
      );
      if (memories.length > 0) {
        knowledgeParts.push(memories.map(m => `- ${m.data?.title || ''}: ${m.data?.content || ''}`).join('\n'));
      }
    } catch (e) { console.log(`[localGetSettings] AIMemory error: ${e.message}`); }

    try {
      const { rows: articles } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'KnowledgeBaseArticle' AND company_id = $1 AND data->>'status' = 'published' LIMIT 30`,
        [companyId]
      );
      if (articles.length > 0) {
        knowledgeParts.push(articles.map(a => `- ${a.data?.title || ''}: ${(a.data?.content || a.data?.summary || '').substring(0, 500)}`).join('\n'));
      }
    } catch (e) { console.log(`[localGetSettings] KnowledgeArticle error: ${e.message}`); }

    try {
      const { rows: training } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'AITrainingData' AND company_id = $1 AND data->>'status' = 'active' LIMIT 50`,
        [companyId]
      );
      if (training.length > 0) {
        knowledgeParts.push(training.map(t => `- ${t.data?.category || 'General'}: ${t.data?.content || ''}`).join('\n'));
      }
    } catch (e) { console.log(`[localGetSettings] AITrainingData error: ${e.message}`); }

    if (settings.knowledge_base) {
      knowledgeParts.push(settings.knowledge_base);
    }

    if (settings.website_urls && Array.isArray(settings.website_urls) && settings.website_urls.length > 0) {
      knowledgeParts.push('Company websites: ' + settings.website_urls.join(', '));
    }

    const fullKnowledge = knowledgeParts.filter(Boolean).join('\n');

    console.log(`[localGetSettings] company=${companyName}, assistant=${assistantDisplayName}, timezone=${companyTimezone}, settings_keys=${Object.keys(settings).length}, knowledge_parts=${knowledgeParts.length}, knowledge_length=${fullKnowledge.length}`);

    return {
      settings,
      companyName,
      assistantName: assistantDisplayName,
      timezone: companyTimezone,
      customSystemPrompt: settings.system_prompt || '',
      knowledgeBase: fullKnowledge,
      companyDescription: company.data?.description || '',
      companyServices: company.data?.services || '',
      preferredLanguage,
    };
  } catch (err) {
    console.error('[localGetSettings] Error:', err.message);
    return { error: err.message };
  }
}

async function localGetMessagingSettings(companyId) {
  const pool = prodDb.getPool();
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
  } catch (e) {
    console.error('[localGetMessagingSettings] Error:', e.message);
    return null;
  }
}

const smsConversationHistory = new Map();

async function localHandleIncomingMessage(companyId, msgData) {
  const pool = prodDb.getPool();
  const { from, to, body, channel, message_sid } = msgData;
  console.log(`[LocalSMS] Handling ${channel} from ${from} for company ${companyId}`);
  try {
    const settingsResult = await localGetSettings(companyId);
    if (settingsResult.error) {
      console.error('[LocalSMS] Failed to get settings:', settingsResult.error);
      return { reply: null };
    }
    const { settings, companyName, assistantName, knowledgeBase, customSystemPrompt } = settingsResult;

    const convKey = `${companyId}:${from}`;
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
    systemPrompt = systemPrompt.replace(/\{brand\}/gi, companyName).replace(/\{agent\}/gi, assistantName);
    if (knowledgeBase) systemPrompt += `\n\nKNOWLEDGE BASE:\n${knowledgeBase}`;
    systemPrompt += `\n\nIMPORTANT: You are responding via ${channel === 'whatsapp' ? 'WhatsApp' : 'SMS text message'}. Keep your responses short, conversational, and text-appropriate (1-3 sentences). Do not use long paragraphs.`;

    let apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    try {
      const companyKey = await prodDb.getCompanyGeminiKey(companyId);
      if (companyKey) apiKey = companyKey;
    } catch (e) { console.error('[LocalSMS] BYOK key lookup failed:', e.message); }
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
          contents: history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: h.parts })),
          generationConfig: { maxOutputTokens: 200, temperature: 0.7 },
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
      billAIUsage(companyId, 1);
      logUsageEvent(companyId, 'sms_ai', 1).catch(() => {});
    }

    try {
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'Communication', $2, $3, NOW(), NOW())`,
        [
          `local_comm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          companyId,
          JSON.stringify({
            type: channel === 'whatsapp' ? 'whatsapp' : 'sms',
            direction: 'inbound',
            contact_phone: from,
            company_phone: to,
            message_body: body,
            ai_reply: reply,
            message_sid: message_sid,
            status: 'completed',
            created_at: new Date().toISOString(),
          }),
        ]
      );
    } catch (logErr) { console.warn('[LocalSMS] Failed to log communication:', logErr.message); }

    // Notify rep + admins about the inbound message (bell + email + SMS to cell)
    try {
      const { rows: smsAdminRows } = await pool.query(
        `SELECT user_email, full_name, cell_phone FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
        [companyId]
      );
      const { rows: smsRepRows } = await pool.query(
        `SELECT user_email, full_name, cell_phone FROM staff_profiles WHERE company_id = $1 AND (twilio_number = $2 OR twilio_number = $3) LIMIT 1`,
        [companyId, to, to.replace(/^\+1/, '')]
      );
      const { rows: twNotifRows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
        [companyId]
      );
      const twNotif = twNotifRows[0]?.data || {};
      const twNotifSid = twNotif.account_sid || process.env.TWILIO_ACCOUNT_SID;
      const twNotifToken = twNotif.auth_token || process.env.TWILIO_AUTH_TOKEN;
      const twNotifFrom = twNotif.main_phone_number || process.env.TWILIO_PHONE_NUMBER;

      // Merge rep + admins, dedupe by email
      const seenEmails = new Set();
      const notifTargets = [];
      for (const r of [...smsRepRows, ...smsAdminRows]) {
        if (r.user_email && !seenEmails.has(r.user_email)) {
          seenEmails.add(r.user_email);
          notifTargets.push(r);
        }
      }

      const preview = body.length > 140 ? body.substring(0, 137) + '...' : body;
      const channelIcon = channel === 'whatsapp' ? '💬' : '📱';
      const channelLabel = channel === 'whatsapp' ? 'WhatsApp' : 'text';
      const notifTitle = `${channelIcon} New ${channelLabel} from ${from}`;

      for (const target of notifTargets) {
        // 1. Bell notification
        const nId = `notif_sms_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [nId, companyId, JSON.stringify({
            id: nId,
            type: 'incoming_sms',
            title: notifTitle,
            message: preview,
            user_email: target.user_email,
            is_read: false,
            caller_phone: from,
            channel: channel,
            created_at: new Date().toISOString(),
          })]
        );

        // 2. Email
        try {
          const emailSubject = notifTitle;
          const emailBody = `<h2 style="color:#1e40af">${notifTitle}</h2>
<p style="font-family:sans-serif;font-size:14px"><strong>From:</strong> ${from}</p>
<p style="font-family:sans-serif;font-size:14px"><strong>Message:</strong> ${body}</p>
${reply ? `<p style="font-family:sans-serif;font-size:14px;color:#6b7280"><strong>Sarah replied:</strong> ${reply}</p>` : ''}
<p style="font-family:sans-serif;font-size:12px;color:#9ca3af;margin-top:24px">CompanySync — YICN Roofing</p>`;
          await sendEmail({ to: target.user_email, subject: emailSubject, html: emailBody });
        } catch (emailErr) { console.warn('[LocalSMS] Email error:', emailErr.message); }

        // 3. SMS to rep's personal cell phone
        if (target.cell_phone && twNotifSid && twNotifToken && twNotifFrom) {
          try {
            const cellSmsBody = `${channelIcon} New ${channelLabel} to your YICN line from ${from}:\n"${body.substring(0, 120)}"`;
            const authStr = Buffer.from(`${twNotifSid}:${twNotifToken}`).toString('base64');
            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twNotifSid}/Messages.json`, {
              method: 'POST',
              headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ To: target.cell_phone, From: twNotifFrom, Body: cellSmsBody }).toString()
            });
          } catch (cellSmsErr) { console.warn('[LocalSMS] Cell SMS error:', cellSmsErr.message); }
        }
      }
      console.log(`[LocalSMS] Notified ${notifTargets.length} staff (bell+email+SMS) for inbound ${channel} from ${from}`);
    } catch (notifErr) { console.warn('[LocalSMS] Notification error:', notifErr.message); }

    return { reply, success: true };
  } catch (err) {
    console.error('[LocalSMS] Error:', err.message);
    return { reply: null };
  }
}

async function localCheckVoiceAccess(companyId) {
  const pool = prodDb.getPool();
  try {
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

    let callMinutesUsed = 0;
    let callMinutesLimit = -1;
    try {
      const { rows: usageRows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'SubscriptionUsage' AND company_id = $1 ORDER BY updated_date DESC LIMIT 1`,
        [companyId]
      );
      if (usageRows.length > 0) {
        const usage = usageRows[0].data || {};
        callMinutesUsed = Number(usage.call_minutes_used || 0);
        callMinutesLimit = usage.call_minutes_limit !== undefined ? Number(usage.call_minutes_limit) : -1;
        if (callMinutesLimit !== -1) {
          const purchased = Number(usage.call_credits_purchased || 0);
          const total = callMinutesLimit + purchased;
          if (callMinutesUsed >= total) {
            return { allowed: false, reason: `Call minutes limit reached (${callMinutesUsed}/${total}). Please upgrade or purchase more minutes.`, call_minutes_used: callMinutesUsed, call_minutes_limit: total };
          }
        }
      }
    } catch (e) {
      console.warn(`[localCheckVoiceAccess] Could not check usage limits: ${e.message}`);
    }

    console.log(`[localCheckVoiceAccess] Company ${companyId} (${company.name}) allowed — plan=${plan}, status=${status}`);
    return { allowed: true, plan, call_minutes_used: callMinutesUsed, call_minutes_limit: callMinutesLimit };
  } catch (err) {
    console.error('[localCheckVoiceAccess] Error:', err.message);
    return { allowed: true };
  }
}

async function localSendMissedCallFollowup(companyId, callData) {
  const pool = prodDb.getPool();
  const { caller_phone, called_number, channel } = callData;
  console.log(`[LocalMissedCall] Sending follow-up to ${caller_phone} for company ${companyId}`);
  try {
    const settingsResult = await localGetSettings(companyId);
    const { companyName, assistantName } = settingsResult;

    let twilioSid, twilioToken, twilioPhone;
    const { rows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    const tw = rows[0]?.data || {};
    twilioSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
    twilioToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
    twilioPhone = tw.main_phone_number || called_number;

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
    const smsParams = new URLSearchParams({ To: caller_phone, From: twilioPhone, Body: template });
    const twilioRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
      {
        method: 'POST',
        headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' },
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

async function sendPostCallNotifications(companyId, { callerPhone, callerName, transcript, durationSeconds, commId, repName, repEmail, repCell, companyName, assistantName, callDirection, toolCallsMade, callSid }) {
  const pool = prodDb.getPool();
  try {
    // 1. Get admin emails and Twilio creds
    const { rows: adminRows } = await pool.query(
      `SELECT user_email, full_name FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
      [companyId]
    );
    const { rows: twilioRows } = await pool.query(
      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
      [companyId]
    );
    const tw = twilioRows[0]?.data || {};
    const twilioSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = tw.main_phone_number || process.env.TWILIO_PHONE_NUMBER;

    const callerLabel = callerName && callerName !== 'Voice Caller' ? `${callerName} (${callerPhone})` : callerPhone;
    const durationMin = Math.floor(durationSeconds / 60);
    const durationSec = durationSeconds % 60;
    const durationLabel = durationMin > 0 ? `${durationMin}m ${durationSec}s` : `${durationSec}s`;
    const shortTranscript = transcript ? transcript.substring(0, 800) : '';
    const dirLabel = callDirection === 'outbound' ? 'Outbound call' : callDirection === 'forwarded' ? 'Staff line call' : 'Inbound call';

    // 2. In-app notifications — notify rep (if available) and all admins
    const notifyEmails = new Set();
    if (repEmail) notifyEmails.add(repEmail);
    adminRows.forEach(r => notifyEmails.add(r.user_email));

    for (const email of notifyEmails) {
      const notifId = `notif_call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const notifData = {
        id: notifId,
        type: 'call_completed',
        title: `📞 ${dirLabel} — ${callerLabel}`,
        message: `${assistantName} handled a ${durationLabel} call. ${toolCallsMade > 0 ? toolCallsMade + ' actions taken.' : ''} ${shortTranscript ? 'Transcript captured.' : 'No transcript.'}`,
        user_email: email,
        is_read: false,
        caller_phone: callerPhone,
        caller_name: callerName,
        duration_seconds: durationSeconds,
        communication_id: commId,
        call_direction: callDirection,
        created_at: new Date().toISOString(),
      };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [notifId, companyId, JSON.stringify(notifData)]
      );
    }
    console.log(`[PostCall] Created ${notifyEmails.size} in-app notification(s) for ${callerLabel}`);

    // 3. Email to rep / admins with transcript
    const emailTargets = [];
    if (repEmail) emailTargets.push({ email: repEmail, name: repName || 'Rep' });
    adminRows.forEach(r => { if (r.user_email !== repEmail) emailTargets.push({ email: r.user_email, name: r.full_name || 'Admin' }); });

    for (const target of emailTargets.slice(0, 3)) {
      try {
        const subject = `[${companyName}] ${dirLabel} — ${callerLabel} (${durationLabel})`;
        const bodyHtml = `
<h2 style="color:#1e40af">📞 ${dirLabel}</h2>
<table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#6b7280">Caller</td><td>${callerLabel}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#6b7280">Duration</td><td>${durationLabel}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#6b7280">Handled by</td><td>${assistantName}</td></tr>
  ${repName ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#6b7280">Rep</td><td>${repName}</td></tr>` : ''}
  <tr><td style="padding:4px 12px 4px 0;font-weight:bold;color:#6b7280">Actions taken</td><td>${toolCallsMade}</td></tr>
</table>
${transcript ? `<h3 style="color:#374151;margin-top:20px">Transcript</h3><pre style="background:#f3f4f6;padding:16px;border-radius:8px;font-size:13px;white-space:pre-wrap;max-width:700px">${transcript.substring(0, 3000)}</pre>` : '<p style="color:#6b7280"><em>No transcript available for this call.</em></p>'}
<p style="color:#9ca3af;font-size:12px;margin-top:24px">CompanySync — ${companyName}</p>`;
        await sendEmail({ to: target.email, subject, html: bodyHtml });
        console.log(`[PostCall] Email sent to ${target.email}`);
      } catch (emailErr) { console.warn('[PostCall] Email error:', emailErr.message); }
    }

    // 4. SMS to rep's cell (if available and Twilio configured)
    if (repCell && twilioSid && twilioToken && twilioFrom) {
      try {
        const smsBody = `📞 ${companyName}: ${assistantName} handled a call from ${callerLabel} (${durationLabel}).${transcript && transcript.length > 20 ? ' Transcript saved in CompanySync.' : ''}`;
        const authStr = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
        const smsResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: 'POST',
          headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: repCell, From: twilioFrom, Body: smsBody }).toString()
        });
        if (smsResp.ok) console.log(`[PostCall] SMS sent to rep ${repCell}`);
        else console.warn('[PostCall] SMS failed:', smsResp.status);
      } catch (smsErr) { console.warn('[PostCall] SMS error:', smsErr.message); }
    }
  } catch (err) {
    console.error('[PostCall] Notification error:', err.message);
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
  const pool = prodDb.getPool();
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

async function localBookAppointment(companyId, { slot_time, name, email, description, phone }) {
  const pool = prodDb.getPool();
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
  const { rows: coRows } = await pool.query(`SELECT data FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
  const tz = coRows[0]?.data?.timezone || 'America/New_York';

  const startTime = new Date(slot_time);
  if (isNaN(startTime.getTime())) {
    return { success: false, message: 'Could not parse the appointment time. Please confirm a specific date and time.' };
  }
  const endTime = new Date(startTime.getTime() + durationMin * 60000);

  // Business-hours enforcement at booking time
  const localHour = parseFloat(startTime.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
  const localMinute = parseInt(startTime.toLocaleString('en-US', { timeZone: tz, minute: 'numeric' })) || 0;
  const totalMinutes = localHour * 60 + localMinute;
  if (localHour < hoursStart || totalMinutes + durationMin > hoursEnd * 60) {
    const { rows: altRows } = await pool.query(`
      SELECT to_char(s AT TIME ZONE $2, 'FMDay, FMMonth FMDD "at" FMHH12:MI AM') AS display_label
      FROM generate_series(NOW()::date::timestamptz AT TIME ZONE $2, NOW() + '7 days'::interval, '30 minutes'::interval) s
      WHERE s > NOW()
        AND EXTRACT(HOUR FROM s AT TIME ZONE $2) >= $3
        AND EXTRACT(HOUR FROM s AT TIME ZONE $2) < $4
        AND (EXTRACT(HOUR FROM s AT TIME ZONE $2) * 60 + EXTRACT(MINUTE FROM s AT TIME ZONE $2) + $5::int) <= ($4 * 60)
        AND NOT EXISTS (
          SELECT 1 FROM calendar_events ce
          WHERE ce.company_id = $1
            AND ce.start_time < s + (($5::int + $6::int) || ' minutes')::interval
            AND COALESCE(ce.end_time, ce.start_time + (($5::int + $6::int)::text || ' minutes')::interval) + ($6 || ' minutes')::interval > s
        )
      ORDER BY s LIMIT 1
    `, [companyId, tz, hoursStart, hoursEnd, durationMin, bufferMin]);
    const altMsg = altRows.length > 0 ? ` The next available time within business hours is ${altRows[0].display_label}.` : '';
    return { success: false, message: `That time is outside business hours (${formatHour12(hoursStart)}–${formatHour12(hoursEnd)}).${altMsg}` };
  }

  // Atomic conflict check + insert using advisory lock on (companyId hash)
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Acquire advisory lock scoped to company to prevent concurrent double-bookings
    // Stable lock key using sum of char codes (avoids digits-only collision, stays within bigint range)
    const lockKey = companyId.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 2147483647, 0) || 1;
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

    // Symmetric buffer: new slot conflicts if existing.start < new_end+buffer AND existing.end+buffer > new_start
    const bufferedEnd = new Date(endTime.getTime() + bufferMin * 60000);
    const bufferedStart = new Date(startTime.getTime() - bufferMin * 60000);
    const { rows: conflicts } = await client.query(
      `SELECT id FROM calendar_events WHERE company_id = $1 AND start_time < $2 AND COALESCE(end_time, start_time + ($4 || ' minutes')::interval) > $3`,
      [companyId, bufferedEnd.toISOString(), bufferedStart.toISOString(), durationMin + bufferMin]
    );
    if (conflicts.length > 0) {
      await client.query('ROLLBACK');
      client.release();
      const { rows: altRows } = await pool.query(`
        SELECT to_char(s AT TIME ZONE $2, 'FMDay, FMMonth FMDD "at" FMHH12:MI AM') AS display_label
        FROM generate_series($3::timestamptz, $3::timestamptz + '3 days'::interval, '30 minutes'::interval) s
        WHERE s > NOW()
          AND EXTRACT(HOUR FROM s AT TIME ZONE $2) >= $4
          AND EXTRACT(HOUR FROM s AT TIME ZONE $2) < $5
          AND (EXTRACT(HOUR FROM s AT TIME ZONE $2) * 60 + EXTRACT(MINUTE FROM s AT TIME ZONE $2) + $6::int) <= ($5 * 60)
          AND NOT EXISTS (
            SELECT 1 FROM calendar_events ce
            WHERE ce.company_id = $1
              AND ce.start_time < s + (($6::int + $7::int) || ' minutes')::interval
              AND COALESCE(ce.end_time, ce.start_time + (($6::int + $7::int)::text || ' minutes')::interval) + ($7 || ' minutes')::interval > s
          )
        ORDER BY s LIMIT 1
      `, [companyId, tz, startTime.toISOString(), hoursStart, hoursEnd, durationMin, bufferMin]);
      const altMsg = altRows.length > 0 ? ` The next available time is ${altRows[0].display_label}.` : '';
      return { success: false, message: `That time is already booked.${altMsg}` };
    }

    const calId = `ce_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const title = description || `Appointment${name ? ' – ' + name : ''}`;
    await client.query(
      `INSERT INTO calendar_events (id, title, start_time, end_time, description, event_type, company_id, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, 'appointment', $6, 'ai_voice', NOW())`,
      [calId, title, startTime.toISOString(), endTime.toISOString(), description || '', companyId]
    );

    const apptId = `appt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await client.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Appointment', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [apptId, companyId, JSON.stringify({
        id: apptId, company_id: companyId, type: 'appointment', title,
        customer_name: name || '', customer_phone: phone || '', customer_email: email || '',
        date_time: startTime.toISOString(), calendar_event_id: calId,
        status: 'scheduled', source: 'ai_voice', created_at: new Date().toISOString()
      })]
    );

    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const displayTime = startTime.toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    await client.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [notifId, companyId, JSON.stringify({
        id: notifId, company_id: companyId, type: 'new_appointment',
        title: 'New Appointment Booked by AI',
        message: `${name || 'A caller'} booked an appointment for ${displayTime}.${description ? ' Notes: ' + description : ''}`,
        is_read: false, priority: 'high', appointment_id: apptId,
        created_at: new Date().toISOString()
      })]
    );

    await client.query('COMMIT');
    client.release();

    console.log(`[Sarah CRM] bookAppointment: created cal event ${calId} for "${name}" at ${startTime.toISOString()}`);
    const localTime = startTime.toLocaleString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return { success: true, appointment_id: apptId, calendar_event_id: calId, message: `Appointment confirmed for ${localTime}. ${name ? name + ' is' : "You're"} all set!` };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    throw e;
  }
}

async function callBase44API(action, companyId, data = null) {
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

  if (action === 'checkAvailability' && companyId) {
    try {
      return await localCheckAvailability(companyId);
    } catch (e) {
      console.warn('[Sarah CRM] Local checkAvailability failed:', e.message);
      return { success: false, message: 'Unable to check availability right now. Someone will follow up to schedule.' };
    }
  }

  if (action === 'bookAppointment' && companyId && data) {
    try {
      return await localBookAppointment(companyId, data);
    } catch (e) {
      console.warn('[Sarah CRM] Local bookAppointment failed:', e.message);
      return { success: false, message: 'Unable to book the appointment right now. Someone will follow up to confirm.' };
    }
  }

  if (action === 'scheduleInspection' && companyId && data) {
    try {
      const pool = prodDb.getPool();

      // 1. Parse and validate the requested time
      const startTime = new Date(data.date_time);
      if (isNaN(startTime.getTime())) {
        return { success: false, message: 'I could not understand that date and time. Could you repeat when you would like the inspection?' };
      }

      // 2. Load scheduling settings + timezone
      const { rows: schedSettRows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND company_id = $1 ORDER BY updated_date DESC NULLS LAST LIMIT 1`,
        [companyId]
      );
      const { rows: tzRows } = await pool.query(`SELECT data FROM companies WHERE id = $1 LIMIT 1`, [companyId]);
      const tz = tzRows[0]?.data?.timezone || 'America/New_York';
      const sched = schedSettRows[0]?.data?.scheduling_defaults || {};
      const insDuration = parseInt(sched.duration_min) || 45;
      const insBuffer = parseInt(sched.buffer_min) || 15;
      const hoursStart = parseInt(sched.business_hours_start ?? 9);
      const hoursEnd = parseInt(sched.business_hours_end ?? 17);
      const endTime = new Date(startTime.getTime() + insDuration * 60000);

      // 3. Business-hours check
      const insLocalHour = parseFloat(startTime.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
      const insLocalMinute = parseInt(startTime.toLocaleString('en-US', { timeZone: tz, minute: 'numeric' })) || 0;
      const insTotalMinutes = insLocalHour * 60 + insLocalMinute;
      if (insLocalHour < hoursStart || insTotalMinutes + insDuration > hoursEnd * 60) {
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
        `, [companyId, tz, startTime.toISOString(), hoursStart, hoursEnd, insDuration, insBuffer]);
        const altMsg = altRows.length > 0 ? ` The next available time within business hours is ${altRows[0].display_label}.` : '';
        return { success: false, message: `That time is outside business hours (${formatHour12(hoursStart)}–${formatHour12(hoursEnd)}).${altMsg}` };
      }

      // 4. Atomic conflict check + insert using advisory lock
      const insLockKey = companyId.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 2147483647, 0) || 1;
      const insClient = await pool.connect();
      try {
        await insClient.query('BEGIN');
        await insClient.query(`SELECT pg_advisory_xact_lock($1)`, [insLockKey]);

        const insBufferedEnd = new Date(endTime.getTime() + insBuffer * 60000);
        const insBufferedStart = new Date(startTime.getTime() - insBuffer * 60000);
        const { rows: conflicts } = await insClient.query(
          `SELECT id FROM calendar_events WHERE company_id = $1 AND start_time < $2 AND COALESCE(end_time, start_time + ($4 || ' minutes')::interval) > $3`,
          [companyId, insBufferedEnd.toISOString(), insBufferedStart.toISOString(), insDuration + insBuffer]
        );
        if (conflicts.length > 0) {
          await insClient.query('ROLLBACK');
          insClient.release();
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
          `, [companyId, tz, startTime.toISOString(), hoursStart, hoursEnd, insDuration, insBuffer]);
          const altMsg = altRows.length > 0 ? ` The next available time is ${altRows[0].display_label}.` : '';
          return { success: false, message: `That time slot is already booked.${altMsg} Would you prefer that time instead?` };
        }

        const title = `Roof Inspection - ${data.customer_name || 'Customer'}`;
        const calId = `ce_insp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await insClient.query(
          `INSERT INTO calendar_events (id, title, start_time, end_time, description, location, event_type, company_id, assigned_to, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'inspection', $7, $8, 'ai_voice', NOW())`,
          [calId, title, startTime.toISOString(), endTime.toISOString(),
           data.notes || `Roof inspection for ${data.customer_name || 'Customer'}`,
           data.address || '', companyId, data.assigned_to || null]
        );

        const apptId = `appt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const localTime = startTime.toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        await insClient.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Appointment', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [apptId, companyId, JSON.stringify({
            id: apptId, company_id: companyId, type: 'inspection', title,
            customer_name: data.customer_name || '', customer_phone: data.customer_phone || '',
            address: data.address || '', date_time: startTime.toISOString(),
            notes: data.notes || '', assigned_to: data.assigned_to || '',
            status: 'scheduled', source: 'ai_voice', calendar_event_id: calId,
            created_at: new Date().toISOString()
          })]
        );

        const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        await insClient.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [notifId, companyId, JSON.stringify({
            id: notifId, company_id: companyId, type: 'new_appointment',
            title: 'New Inspection Scheduled by AI',
            message: `${data.customer_name || 'A customer'} scheduled a roof inspection at ${data.address || 'their address'} for ${localTime}. Assigned to: ${data.assigned_to || 'unassigned'}.`,
            is_read: false, priority: 'high', appointment_id: apptId,
            created_at: new Date().toISOString()
          })]
        );

        await insClient.query('COMMIT');
        insClient.release();
        console.log(`[Sarah CRM] scheduleInspection saved LOCALLY: cal ${calId}, appt ${apptId} for ${data.customer_name}`);
        return { success: true, appointment_id: apptId, calendar_event_id: calId, message: `Inspection confirmed for ${localTime} at ${data.address || 'the property'}.` };
      } catch (txErr) {
        await insClient.query('ROLLBACK').catch(() => {});
        insClient.release();
        throw txErr;
      }
    } catch (e) {
      console.warn('[Sarah CRM] Local scheduleInspection failed, falling back to Base44:', e.message);
    }
  }

  if (action === 'sendAlert' && companyId && data) {
    try {
      const pool = prodDb.getPool();
      const notifId = `notif_alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const urgency = data.urgency || 'medium';
      const notifData = {
        id: notifId,
        company_id: companyId,
        type: 'ai_alert',
        title: `${data.category ? '[' + data.category + '] ' : ''}Alert from AI${data.caller_name ? ': ' + data.caller_name : ''}`,
        message: data.message || '',
        caller_name: data.caller_name || '',
        caller_phone: data.caller_phone || '',
        urgency,
        is_read: false,
        priority: urgency === 'urgent' || urgency === 'high' ? 'high' : 'medium',
        created_at: new Date().toISOString()
      };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [notifId, companyId, JSON.stringify(notifData)]
      );
      console.log(`[Sarah CRM] sendAlert saved LOCALLY as Notification: ${notifId}`);
    } catch (e) {
      console.warn('[Sarah CRM] Local sendAlert notification failed:', e.message);
    }
  }

  if (action === 'saveCallLog' && companyId && data) {
    try {
      const pool = prodDb.getPool();
      const commId = `comm_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const durMins = data.duration_seconds ? Math.max(1, Math.ceil(data.duration_seconds / 60)) : null;
      const extraData = {
        call_sid: data.call_sid || '',
        transcription: data.transcript || '',
        assistant_name: data.assistant_name || 'AI Assistant',
        tool_calls_made: data.tool_calls_made || 0,
        source: 'ai_voice',
      };
      const insertSql = `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, status, duration_minutes, data, created_at, updated_at)
         VALUES ($1,$2,'call','call',$3,$4,$5,'completed',$6,$7,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`;
      const insertVals = [commId, companyId, data.direction || 'inbound', data.caller_phone || 'Unknown', data.caller_name || 'Voice Caller', durMins, JSON.stringify(extraData)];
      console.log(`[Sarah CRM] saveCallLog INSERT: commId=${commId}, company=${companyId}, caller=${data.caller_phone}, dur=${durMins}min`);
      const result = await pool.query(insertSql, insertVals);
      console.log(`[Sarah CRM] saveCallLog INSERT SUCCESS: ${commId} (${data.duration_seconds}s, rowCount=${result.rowCount})`);
    } catch (e) {
      console.error('[Sarah CRM] saveCallLog INSERT FAILED:', {error: e.message, code: e.code, detail: e.detail, company: companyId, caller: data.caller_phone, stack: e.stack});
    }
  }

  // Local: lookupByPhone — find company by Twilio number
  if (action === 'lookupByPhone') {
    try {
      const phone = data?.phone_number || '';
      const pool = prodDb.getPool();
      const norm = phone.replace(/[^\d+]/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^1(\d{10})$/, '+1$1');
      const bare = norm.replace(/^\+1/, '');
      const { rows } = await pool.query(
        `SELECT c.id as company_id FROM generic_entities g
         JOIN companies c ON c.id = g.company_id OR c.base44_id = g.company_id
         WHERE g.entity_type = 'TwilioSettings'
           AND (g.data->>'main_phone_number' = $1 OR g.data->>'main_phone_number' = $2
             OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.data->'available_numbers') elem WHERE elem->>'phone_number' = $1 OR elem->>'phone_number' = $2))
         LIMIT 1`,
        [norm, bare]
      );
      if (rows[0]) {
        console.log(`[Sarah CRM] lookupByPhone LOCAL: ${phone} -> ${rows[0].company_id}`);
        return { success: true, company_id: rows[0].company_id, sarah_enabled: true };
      }
      const { rows: staffRows } = await pool.query(
        `SELECT company_id FROM staff_profiles WHERE twilio_number = $1 OR twilio_number = $2 LIMIT 1`,
        [norm, bare]
      );
      if (staffRows[0]) {
        console.log(`[Sarah CRM] lookupByPhone LOCAL (staff): ${phone} -> ${staffRows[0].company_id}`);
        return { success: true, company_id: staffRows[0].company_id, sarah_enabled: true };
      }
    } catch (e) { console.warn('[Sarah CRM] Local lookupByPhone error:', e.message); }
    return { success: false };
  }

  // Local: lookupStaffByTwilioNumber
  if (action === 'lookupStaffByTwilioNumber' && companyId) {
    try {
      const pool = prodDb.getPool();
      const tw = data?.twilio_number || '';
      const { rows } = await pool.query(
        `SELECT full_name, user_email, cell_phone, call_routing_mode, availability_status FROM staff_profiles WHERE twilio_number = $1 OR twilio_number = $2 LIMIT 1`,
        [tw, tw.replace(/^\+/, '')]
      );
      if (rows[0]) {
        console.log(`[Sarah CRM] lookupStaffByTwilioNumber LOCAL: ${tw} -> ${rows[0].full_name}`);
        return { success: true, staff: { full_name: rows[0].full_name, email: rows[0].user_email, cell_phone: rows[0].cell_phone, call_routing_mode: rows[0].call_routing_mode, availability_status: rows[0].availability_status } };
      }
    } catch (e) { console.warn('[Sarah CRM] Local lookupStaffByTwilioNumber error:', e.message); }
    return { success: false };
  }

  // Local: getTwilioSettings
  if (action === 'getTwilioSettings' && companyId) {
    try {
      const pool = prodDb.getPool();
      const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = compRows[0]?.id || companyId;
      const { rows } = await pool.query(`SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`, [localId]);
      if (rows[0]?.data) {
        console.log(`[Sarah CRM] getTwilioSettings LOCAL for ${companyId}`);
        return { success: true, ...rows[0].data };
      }
    } catch (e) { console.warn('[Sarah CRM] Local getTwilioSettings error:', e.message); }
  }

  // Local: getAllSubscriberRouting
  if (action === 'getAllSubscriberRouting') {
    try {
      const pool = prodDb.getPool();
      const { rows: staffRows } = await pool.query(
        `SELECT sp.company_id, sp.full_name, sp.user_email, sp.cell_phone, sp.twilio_number,
                sp.call_routing_mode, sp.availability_status,
                COALESCE(a.data->>'brand_short_name', c.name) as company_name,
                ts.data as twilio_settings
         FROM staff_profiles sp
         JOIN companies c ON c.id = sp.company_id AND (c.is_deleted IS NULL OR c.is_deleted = false)
         LEFT JOIN generic_entities a ON a.company_id = sp.company_id AND a.entity_type = 'AssistantSettings'
         LEFT JOIN generic_entities ts ON ts.company_id = sp.company_id AND ts.entity_type = 'TwilioSettings'
         WHERE sp.is_active = true AND (sp.twilio_number IS NOT NULL OR sp.cell_phone IS NOT NULL)`
      );
      const routing = {};
      const subscribers = [];
      for (const row of staffRows) {
        const entry = {
          companyId: row.company_id, companyName: row.company_name || '',
          repName: row.full_name || '', repEmail: row.user_email || '',
          cellPhone: row.cell_phone || '', routingMode: row.call_routing_mode || 'sarah_answers',
          availabilityStatus: row.availability_status || 'available',
          twilioSid: row.twilio_settings?.account_sid || '',
          twilioToken: row.twilio_settings?.auth_token || '',
        };
        // Routing table keyed by twilio_number (for inbound call routing)
        if (row.twilio_number) {
          routing[row.twilio_number] = entry;
        }
        // Subscribers list includes ALL staff (used for name-based transfer lookups)
        subscribers.push({
          phone_number: row.twilio_number || '',
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
      // Also add main TwilioSettings phone numbers so they are always cache-warm
      try {
        const { rows: tsRows } = await pool.query(
          `SELECT company_id, data->>'main_phone_number' as main_phone, data as twilio_data
           FROM generic_entities WHERE entity_type = 'TwilioSettings' AND data->>'main_phone_number' IS NOT NULL`
        );
        for (const ts of tsRows) {
          const ph = (ts.main_phone || '').replace(/[^\d+]/g, '');
          const e164 = ph.startsWith('+') ? ph : `+1${ph}`;
          if (e164 && !routing[e164]) {
            routing[e164] = { companyId: ts.company_id, companyName: '', repName: '', repEmail: '', cellPhone: '', routingMode: 'sarah_answers', availabilityStatus: 'available', twilioSid: ts.twilio_data?.account_sid || '', twilioToken: ts.twilio_data?.auth_token || '' };
            subscribers.push({ phone_number: e164, company_id: ts.company_id, company_name: '', rep_name: '', rep_email: '', cell_phone: '', routing_mode: 'sarah_answers', availability_status: 'available', twilio_sid: ts.twilio_data?.account_sid || '', twilio_token: ts.twilio_data?.auth_token || '' });
          }
        }
      } catch (e) { /* best effort */ }
      console.log(`[Sarah CRM] getAllSubscriberRouting LOCAL: ${subscribers.length} staff (${Object.keys(routing).length} with Twilio numbers)`);
      return { success: true, routing, subscribers };
    } catch (e) {
      console.warn('[Sarah CRM] Local getAllSubscriberRouting error:', e.message);
      // Return explicit failure to prevent fallback to stale external API data
      return { success: false, error: e.message };
    }
  }

  // Local: saveLead
  if (action === 'saveLead' && companyId) {
    try {
      const pool = prodDb.getPool();
      const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = compRows[0]?.id || companyId;
      const phone = (data?.phone || data?.caller_phone || '').replace(/[^\d+]/g, '');
      const existing = phone ? await pool.query(`SELECT id FROM leads WHERE company_id = $1 AND phone = $2 LIMIT 1`, [localId, phone]) : { rows: [] };
      if (existing.rows.length === 0) {
        const leadId = `lead_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await pool.query(
          `INSERT INTO leads (id, company_id, name, phone, email, source, status, assigned_to, service_needed, notes, data, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'sarah_ai', 'new', $6, $7, $8, $9, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [leadId, localId, data?.name || data?.customer_name || 'Unknown Caller', phone,
           data?.email || '', data?.assigned_to || '', data?.service_needed || '',
           data?.notes || '', JSON.stringify({ source: 'sarah_ai', ...data })]
        );
        console.log(`[Sarah CRM] saveLead LOCAL: ${data?.name || 'Unknown'} for ${localId}`);
      }
      return { success: true };
    } catch (e) { console.warn('[Sarah CRM] Local saveLead error:', e.message); }
  }

  // Local: trackCallMinutes
  if (action === 'trackCallMinutes' && companyId) {
    try {
      const pool = prodDb.getPool();
      const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = compRows[0]?.id || companyId;
      const minutes = Math.ceil((data?.duration_seconds || 0) / 60);
      const usageId = `usage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'SubscriptionUsage', $2, $3, NOW(), NOW())`,
        [usageId, localId, JSON.stringify({ feature: 'voice_minutes', units: minutes, unit_cost: 0.02, total_cost: +(minutes * 0.02).toFixed(2), usage_month: new Date().toISOString().slice(0, 7) })]
      );
      console.log(`[Sarah CRM] trackCallMinutes LOCAL: ${minutes}min for ${localId}`);
      return { success: true };
    } catch (e) { console.warn('[Sarah CRM] Local trackCallMinutes error:', e.message); }
  }

  // Local: notifyRep
  if (action === 'notifyRep' && companyId) {
    try {
      const pool = prodDb.getPool();
      const { rows: compRows } = await pool.query(`SELECT id FROM companies WHERE id = $1 OR base44_id = $1 LIMIT 1`, [companyId]);
      const localId = compRows[0]?.id || companyId;
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [notifId, localId, JSON.stringify({ type: 'new_lead', title: data?.title || 'New lead from Sarah', message: data?.message || '', is_read: false, created_at: new Date().toISOString() })]
      );
      console.log(`[Sarah CRM] notifyRep LOCAL for ${localId}`);
      return { success: true };
    } catch (e) { console.warn('[Sarah CRM] Local notifyRep error:', e.message); }
  }

  if (!BASE44_API_URL || !BRIDGE_SECRET) {
    console.warn('[Sarah CRM] API not configured');
    return { error: 'CRM not configured' };
  }
  try {
    const body = { action, companyId };
    if (data) body.data = data;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const resp = await fetch(BASE44_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${BRIDGE_SECRET}` },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const text = await resp.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Non-JSON response (${resp.status})` }; }
  } catch (err) {
    console.error(`[Sarah CRM] ${action} failed:`, err.message);
    return { error: err.message };
  }
}

async function callLexiBridgeAPI(action, companyId, userEmail, data = null) {
  if (!LEXI_BRIDGE_API_URL || !LEXI_BRIDGE_SECRET) return { error: 'Not configured' };
  try {
    const body = { action, companyId, userEmail };
    if (data) body.data = data;
    const resp = await fetch(LEXI_BRIDGE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LEXI_BRIDGE_SECRET}` },
      body: JSON.stringify(body)
    });
    const text = await resp.text();
    try { return JSON.parse(text); } catch (e) { return { error: `Non-JSON (${resp.status})` }; }
  } catch (err) { return { error: err.message }; }
}

function getBase44FunctionUrl(functionName) {
  if (!BASE44_API_URL) return null;
  return BASE44_API_URL.replace(/\/functions\/[^/]+$/, '/functions/') + functionName;
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('[Static] Stream error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      } else {
        res.end();
      }
    });
    stream.pipe(res);
    return true;
  } catch (e) {
    console.error('[Static] File serve error:', e.message, filePath);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
    return false;
  }
}

const CRM_TOOLS = [
  { name: "save_lead_details", description: "Save caller's contact information as a lead.", parameters: { type: "object", properties: { name: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, service_needed: { type: "string" }, address: { type: "string" }, assigned_to: { type: "string", description: "Email of rep to assign the lead to" } }, required: ["name"] } },
  { name: "check_availability", description: "Check available appointment slots.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "book_appointment", description: "Book an appointment for the caller.", parameters: { type: "object", properties: { slot_time: { type: "string" }, name: { type: "string" }, email: { type: "string" }, description: { type: "string" } }, required: ["slot_time", "name"] } },
  { name: "send_alert", description: "Send an urgent alert to the business team.", parameters: { type: "object", properties: { message: { type: "string" }, caller_name: { type: "string" }, caller_phone: { type: "string" }, urgency: { type: "string" }, category: { type: "string" } }, required: ["message"] } },
  { name: "schedule_inspection", description: "Schedule a roof inspection appointment. Creates a calendar event and assigns it to the appropriate rep.", parameters: { type: "object", properties: { date_time: { type: "string", description: "Date and time for the inspection in ISO format or natural language" }, customer_name: { type: "string", description: "Name of the customer" }, customer_phone: { type: "string", description: "Phone number of the customer" }, address: { type: "string", description: "Property address for the inspection" }, notes: { type: "string", description: "Special notes about the inspection" }, assigned_to: { type: "string", description: "Staff member name or email to assign this inspection to" } }, required: ["date_time", "customer_name", "address"] } },
  { name: "notify_rep", description: "Send an SMS or WhatsApp notification to a specific sales rep about a new lead, appointment, or update.", parameters: { type: "object", properties: { rep_name: { type: "string", description: "Name of the rep to notify" }, rep_phone: { type: "string", description: "Phone number of the rep" }, message: { type: "string", description: "The notification message to send" }, notification_type: { type: "string", description: "Type: new_lead, inspection_scheduled, callback_request, general" } }, required: ["message"] } },
  { name: "transfer_call", description: "Transfer the current call to a staff member's cell phone. Use when the caller asks to speak to someone by name, or when routing mode is sarah_then_transfer and you have gathered the caller's info. IMPORTANT: Only call this ONCE per conversation. If it fails, do NOT retry — help the caller directly instead.", parameters: { type: "object", properties: { reason: { type: "string", description: "Why the call is being transferred" }, target_person: { type: "string", description: "Name of the specific staff member the caller wants to speak to (e.g. 'Vicky', 'Kevin'). Leave empty to transfer to the default rep." } }, required: [] } }
];

const VALID_GEMINI_VOICES = ['Aoede', 'Charon', 'Fenrir', 'Kore', 'Leda', 'Orus', 'Puck', 'Zephyr'];

const BIAS = 0x84;
const CLIP = 32635;
const EXP_LUT = new Uint8Array([0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7]);

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
(function() {
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

const LP_COEFFS = new Float64Array([0.0595, 0.0990, 0.1571, 0.2030, 0.2218, 0.2030, 0.1571, 0.0990, 0.0595]);
const LP_LEN = LP_COEFFS.length;
const LP_HALF = (LP_LEN - 1) >> 1;

function geminiToTwilio(pcmB64) {
  const buf = Buffer.from(pcmB64, 'base64');
  const nSrc = buf.length >> 1;
  const pcm = new Float64Array(nSrc);
  for (let i = 0; i < nSrc; i++) pcm[i] = buf.readInt16LE(i * 2);
  let prev = pcm[0];
  for (let i = 1; i < nSrc; i++) { const orig = pcm[i]; pcm[i] = orig - 0.4 * prev; prev = orig; }
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
    out[i] = mulawEncode(Math.max(-32768, Math.min(32767, Math.round(acc))));
  }
  return out.toString('base64');
}

async function handleToolCall(functionCall, companyId, context = {}) {
  const { name, args } = functionCall;
  let parsedArgs = {};
  try { parsedArgs = typeof args === 'string' ? JSON.parse(args) : (args || {}); } catch (e) { parsedArgs = {}; }
  console.log(`[Sarah CRM] Tool: ${name}`, JSON.stringify(parsedArgs));
  switch (name) {
    case 'save_lead_details': return callBase44API('saveLead', companyId, parsedArgs);
    case 'check_availability': return callBase44API('checkAvailability', companyId);
    case 'book_appointment': return callBase44API('bookAppointment', companyId, parsedArgs);
    case 'send_alert': return callBase44API('sendAlert', companyId, parsedArgs);
    case 'schedule_inspection': return callBase44API('scheduleInspection', companyId, parsedArgs);
    case 'notify_rep': return callBase44API('notifyRep', companyId, parsedArgs);
    case 'transfer_call': {
      const targetPerson = (parsedArgs.target_person || '').trim();
      const fallbackCell = context.staffCellPhone || '';
      const fallbackName = context.forwardedRepName || '';
      console.log(`[TRANSFER-DEBUG] transfer_call fired. companyId=${companyId}, targetPerson="${targetPerson}", fallbackCell="${fallbackCell}", fallbackName="${fallbackName}"`);
      let resolvedCell = '';
      let resolvedName = '';
      const normalizeToE164 = (num) => {
        if (!num) return '';
        const digits = num.replace(/[^\d]/g, '');
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
        return num.startsWith('+') ? num : `+${digits}`;
      };
      try {
        const allRouting = await callBase44API('getAllSubscriberRouting', null);
        const subs = allRouting?.subscribers || [];
        console.log(`[TRANSFER-DEBUG] getAllSubscriberRouting returned ${subs.length} subscribers`);
        if (subs.length > 0) {
          if (targetPerson) {
            const matched = companyId
              ? subs.find(s => s.company_id === companyId && s.rep_name && nameMatchesSearch(s.rep_name, targetPerson))
              : subs.find(s => s.rep_name && nameMatchesSearch(s.rep_name, targetPerson));
            console.log(`[TRANSFER-DEBUG] Company-scoped match for "${targetPerson}": ${matched ? matched.rep_name : 'NONE'}`);
            if (matched) { resolvedCell = normalizeToE164(matched.cell_phone || ''); resolvedName = matched.rep_name; }
          } else if (companyId) {
            const defaultRep = subs.find(s => s.company_id === companyId && s.cell_phone);
            if (defaultRep) { resolvedCell = normalizeToE164(defaultRep.cell_phone); resolvedName = defaultRep.rep_name; }
          }
        }
      } catch (e) { console.warn('[TRANSFER-DEBUG] getAllSubscriberRouting failed:', e.message); }
      if (!resolvedCell && fallbackCell) {
        resolvedCell = normalizeToE164(fallbackCell);
        resolvedName = resolvedName || fallbackName;
        console.log(`[TRANSFER-DEBUG] Using fallback cell: ${resolvedCell} (${resolvedName})`);
      }
      console.log(`[TRANSFER-DEBUG] Final: resolvedCell="${resolvedCell}", resolvedName="${resolvedName}"`);
      if (!resolvedCell) {
        console.warn(`[TRANSFER-DEBUG] FAIL: no cell resolved for "${targetPerson || '(default)'}" in company "${companyId}"`);
        return { success: false, message: `I wasn't able to connect you right now. Let me take a message and have someone call you right back.` };
      }
      console.log(`[TRANSFER-DEBUG] SUCCESS: ${resolvedName} -> ${resolvedCell}`);
      return { success: true, action: 'transfer_initiated', resolved_cell: resolvedCell, resolved_name: resolvedName };
    }
    default: return { error: `Unknown tool: ${name}` };
  }
}

const COMPANYSYNC_DEFAULT_KNOWLEDGE = `

KNOWLEDGE BASE — You MUST use this information when answering questions about CompanySync. Do NOT guess or invent details:

WHAT IS COMPANYSYNC:
CompanySync is an all-in-one roofing business management platform. It replaces spreadsheets, disconnected tools, and manual processes with a single system designed specifically for roofing contractors.

CORE FEATURES:
- CRM & Lead Management: Track every lead from first contact to signed contract. Storm-based lead generation, automated follow-ups, lead scoring, pipeline management.
- Estimates & Invoicing: Create professional estimates with material calculators, convert to invoices with one click, accept online payments via Stripe.
- Crew Management: Assign crews to jobs, track schedules, manage staff profiles and roles.
- CrewCam AI Inspection: Take photos of roof damage and get instant AI-powered analysis. Identifies materials, detects hail/wind damage with bounding boxes, measures damage severity. Uses Google Gemini Vision.
- Calendar & Scheduling: Built-in calendar with Google Calendar sync. Schedule inspections, appointments, and jobs. Automated reminders.
- Storm Tracking: Real-time NOAA severe weather monitoring. Track hail, wind, tornado events. Generate leads from storm-affected areas. Nationwide coverage.
- Contract Signing: Digital contract creation and e-signature. Send contracts for signing, track status, store signed documents.
- Communications: Track all calls, texts, and emails in one place. Integrated with Twilio for voice and SMS.

AI ASSISTANTS:
- Sarah (AI Voice): Answers phone calls, qualifies leads, books inspections, handles customer inquiries 24/7. Uses Google Gemini speech-to-speech. Can make outbound follow-up calls. Customizable personality and knowledge base per company.
- Lexi (AI Chat): In-app AI chat assistant for CRM operations. Can look up customers, create tasks, check calendar, send emails — all through natural conversation.
- Marcus (AI Marketing): AI-powered marketing assistant. Generates social media content, email campaigns, and marketing strategies tailored to the roofing industry.

SUBSCRIPTION PLANS:
- Basic Plan: $49/month — CRM, estimates, invoicing, calendar, 1 user.
- Business Plan: $99/month — Everything in Basic plus AI assistants (Sarah, Lexi, Marcus), crew management, storm tracking, unlimited users.
- Enterprise Plan: $199/month — Everything in Business plus priority support, custom integrations, advanced reporting, white-label options.
- All plans include a free trial period. No long-term contracts required.

INTEGRATIONS:
- Stripe for payment processing
- Twilio for voice calls and SMS
- Google Calendar for scheduling
- Google Maps for address geocoding
- NOAA for storm data
- Resend for transactional emails

WEBSITE: https://getcompanysync.com
SUPPORT: Available through the platform or by calling our main line.`;

function buildSystemPrompt(cName, aName, isOutbound, outboundLeadName, outboundLeadService, subscriberPrompt, companyDescription, companyKnowledge, forwardedInfo) {
  let prompt = '';

  if (forwardedInfo && forwardedInfo.isForwarded && !subscriberPrompt) {
    const rName = forwardedInfo.repName || 'the team';
    const rEmail = forwardedInfo.repEmail || '';
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
4. Try to connect them: call transfer_call to connect to ${rName}.
5. If transfer succeeds: say "Alright, connecting you now!" and stop talking.
6. If transfer fails: do NOT try again. Say "${rName} is tied up right now" and offer to help directly: schedule an inspection, take a message, or have ${rName} call them back.
7. If they want scheduling: use schedule_inspection (assigned_to="${rEmail || rName}").
8. After booking or capturing info: use notify_rep to text ${rName} about the new lead/appointment.
9. Let them know: "${rName} will follow up with you shortly."

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
- When using notify_rep, include a clear message like: "New lead from [caller name] at [phone] — needs [service]. Appointment booked for [date/time]." so ${rName} has full context.

YOUR FIRST RESPONSE must be one of the greetings above — short, warm, under 20 words.`;

  } else if (isOutbound && !subscriberPrompt) {
    prompt = `You are ${aName}, the lead qualifier for ${cName}. You're making an OUTBOUND follow-up call.

Personality: Friendly, confident, not pushy. You're calling because they reached out — you're helping, not selling. Use contractions. Sound like a real person. Never mention being AI.

OPENING (vary — pick ONE):
- "Hi, this is ${aName} from ${cName}. Am I speaking with ${outboundLeadName || 'the homeowner'}?"
- "Hey ${outboundLeadName || 'there'}, it's ${aName} with ${cName} — just following up on your request."

CALL FLOW:
1. Confirm you're speaking to the right person.
2. Reference their inquiry: "I see you reached out about ${outboundLeadService || 'your roof'}. What's going on with it?"
3. Qualify: ask about the issue — storm damage, leak, age of roof, insurance claim. ONE question at a time.
4. Offer the inspection: "We do a free inspection — about 15 minutes, you get a full report. Want to set one up?"
5. If yes: use check_availability, then book_appointment. Confirm the address, date, and time.
6. If bad time: "No problem! I can call back or text you a link to book whenever works. What's easier?"

RULES:
- Never be pushy. If they're not interested, thank them and wrap up.
- Save or update their info with save_lead_details as you learn details.
- ONE question at a time. Acknowledge their answers before moving on.

YOUR FIRST RESPONSE must be one of the openings above — short, confident, under 20 words.`;

  } else if (subscriberPrompt) {
    prompt = subscriberPrompt;
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

SCHEDULING NOTE: For roof inspections, use schedule_inspection. For general meetings or demos, use check_availability then book_appointment.

YOUR FIRST RESPONSE must be one of the greetings above — short, warm, under 20 words.`;
  }

  prompt = prompt.replace(/\{agent\}/gi, aName).replace(/\{brand\}/gi, cName);
  if (aName.toLowerCase() !== 'sarah') prompt = prompt.replace(/\bSarah\b/gi, aName);
  if (cName.toLowerCase() !== 'companysync') prompt = prompt.replace(/\bCompanySync\b/gi, cName);

  prompt += `

VOICE RULES (non-negotiable):
- No internal thinking, reasoning, or markdown. Only say words you'd say out loud on a phone call.
- Keep responses under 25 words. Short and natural.
- Never say "I am an AI" or "I'm an artificial intelligence" or reference being a bot.
- Never say "How can I assist you further today?" or similar robotic closers.
- Vary your responses. Don't repeat greetings, phrases, or patterns.

CRM TOOLS — use these automatically as info comes in:
- save_lead_details: Save as soon as caller shares name, phone, or what they need. Don't wait. Include service_needed describing their issue. Every caller should be tracked.
- check_availability → book_appointment: For scheduling. Always confirm with caller before booking.
- schedule_inspection: For roof inspection bookings. Include address and assigned_to if this is a forwarded call.
- notify_rep: Text a rep about new leads or appointments. Use after saving a lead or booking.
- send_alert: For complaints, emergencies, or messages for someone specific. Set urgency appropriately (urgent/high/medium). After sending, confirm to the caller.
- transfer_call: When a caller asks to speak with a specific person by name (e.g. "Can I speak to Kevin?", "Transfer me to your manager", "Is Kevin available?"), call this function IMMEDIATELY with only their first name. Do NOT say you cannot transfer. Do NOT apologize or stall. Just call transfer_call right away. IMPORTANT: You may only call transfer_call ONCE per conversation. If it fails, do NOT retry — tell the caller that person is busy and offer to help directly (schedule, take a message, or have them call back).
- After ANY tool call, respond to the caller immediately. Never go silent.
- NEVER make up pricing, service details, warranties, timelines, or company facts. Use your knowledge base below. If you don't know something, say "Let me have someone get back to you on that" or "I'll make sure the right person follows up with those details."
- When a caller asks about services, pricing, or how things work, reference your knowledge base — don't guess.`;

  if (companyDescription) prompt += `\n\nAbout ${cName}:\n${companyDescription}`;
  if (companyKnowledge) {
    prompt += `\n\nKNOWLEDGE BASE — You MUST use this information when answering questions about ${cName}. Do NOT guess or invent details. If a caller asks about services, pricing, warranties, process, or anything covered below, use these facts exactly. If the answer isn't here, say you'll have someone follow up:\n${companyKnowledge}`;
  } else if (cName.toLowerCase().includes('companysync') || cName.toLowerCase().includes('company sync')) {
    prompt += COMPANYSYNC_DEFAULT_KNOWLEDGE;
  }
  return prompt;
}

const LEXI_CRM_TOOLS = [
  { name: "get_crm_data", description: "Get CRM data counts/details.", parameters: { type: "object", properties: { data_type: { type: "string", enum: ["customers","leads","estimates","invoices","tasks","projects","payments","staff","calendar_events"] } }, required: ["data_type"] } },
  { name: "get_calendar_events", description: "Get calendar events for date range.", parameters: { type: "object", properties: { start_date: { type: "string" }, end_date: { type: "string" } }, required: ["start_date"] } },
  { name: "create_calendar_event", description: "Create a calendar event.", parameters: { type: "object", properties: { title: { type: "string" }, start_time: { type: "string" }, end_time: { type: "string" }, location: { type: "string" }, description: { type: "string" }, event_type: { type: "string" }, attendees: { type: "string" } }, required: ["title","start_time"] } },
  { name: "create_task", description: "Create a CRM task.", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, assigned_to: { type: "string" }, due_date: { type: "string" }, priority: { type: "string" } }, required: ["name"] } },
  { name: "create_lead", description: "Create a CRM lead.", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, street: { type: "string" }, city: { type: "string" }, state: { type: "string" }, zip: { type: "string" }, notes: { type: "string" }, source: { type: "string" } }, required: ["name"] } },
  { name: "create_customer", description: "Create a CRM customer.", parameters: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, street: { type: "string" }, city: { type: "string" }, state: { type: "string" }, zip: { type: "string" }, notes: { type: "string" } }, required: ["name"] } },
  { name: "send_email", description: "Compose email to customer/lead.", parameters: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, message: { type: "string" }, contact_name: { type: "string" } }, required: ["to","subject","message"] } },
  { name: "send_sms", description: "Compose text message.", parameters: { type: "object", properties: { to: { type: "string" }, message: { type: "string" }, contact_name: { type: "string" } }, required: ["to","message"] } },
  { name: "manage_entity", description: "CRUD any CRM entity.", parameters: { type: "object", properties: { entity_action: { type: "string", enum: ["create","update","delete","list"] }, entity_name: { type: "string" }, entity_data: { type: "object" }, entity_id: { type: "string" } }, required: ["entity_action","entity_name"] } },
  { name: "assign_inspection", description: "Create/assign a CrewCam inspection.", parameters: { type: "object", properties: { client_name: { type: "string" }, client_phone: { type: "string" }, client_email: { type: "string" }, property_address: { type: "string" }, assigned_to_email: { type: "string" }, inspection_date: { type: "string" }, inspection_time: { type: "string" }, damage_type: { type: "string" }, special_instructions: { type: "string" }, create_calendar_event: { type: "boolean" }, create_lead: { type: "boolean" } }, required: ["client_name","property_address","assigned_to_email"] } }
];

async function handleLexiToolCall(functionCall, companyId, userEmail) {
  const { name, args } = functionCall;
  let a = {};
  try { a = typeof args === 'string' ? JSON.parse(args) : (args || {}); } catch (e) { a = {}; }
  const pool = prodDb.getPool();
  const genId = () => 'loc_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
  console.log(`[Lexi Tool] ${name} called by ${userEmail} for ${companyId}`, JSON.stringify(a).substring(0, 200));

  try {
    switch (name) {

      case 'create_calendar_event': {
        const id = genId();
        const endTime = a.end_time || (a.start_time ? new Date(new Date(a.start_time).getTime() + 3600000).toISOString() : null);
        await pool.query(
          `INSERT INTO calendar_events (id, company_id, title, event_type, start_time, end_time, location, description, attendees, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, companyId, a.title, a.event_type || 'meeting', a.start_time, endTime, a.location || null, a.description || null, a.attendees || null, userEmail]
        );
        console.log(`[Lexi Tool] Calendar event created: ${id} - ${a.title}`);
        return { success: true, id, message: `Calendar event "${a.title}" created for ${a.start_time}` };
      }

      case 'get_calendar_events': {
        const start = a.start_date || new Date().toISOString().split('T')[0];
        const end = a.end_date || new Date(new Date(start).getTime() + 7 * 86400000).toISOString().split('T')[0];
        const { rows } = await pool.query(
          `SELECT id, title, event_type, start_time, end_time, location, description, attendees
           FROM calendar_events WHERE company_id = $1 AND start_time >= $2 AND start_time <= $3
           ORDER BY start_time ASC LIMIT 20`,
          [companyId, start, end + 'T23:59:59']
        );
        if (rows.length === 0) return { success: true, events: [], message: `No events found between ${start} and ${end}` };
        return { success: true, count: rows.length, events: rows.map(r => ({
          title: r.title, type: r.event_type, start: r.start_time, end: r.end_time, location: r.location, description: r.description
        })) };
      }

      case 'get_crm_data': {
        const tableMap = {
          customers: 'customers', leads: 'leads', estimates: 'estimates', invoices: 'invoices',
          tasks: 'tasks', projects: 'projects', payments: 'payments', staff: 'staff_profiles', calendar_events: 'calendar_events'
        };
        const tbl = tableMap[a.data_type];
        if (!tbl) return { error: `Unknown data type: ${a.data_type}` };
        const { rows: countRows } = await pool.query(`SELECT COUNT(*) as total FROM ${tbl} WHERE company_id = $1`, [companyId]);
        const total = parseInt(countRows[0].total);
        const nameCol = tbl === 'staff_profiles' ? 'name' : tbl === 'calendar_events' ? 'title' : tbl === 'tasks' ? 'COALESCE(title,name)' : 'name';
        const statusCol = (tbl === 'staff_profiles') ? "availability_status" : (tbl === 'calendar_events') ? "event_type" : "status";
        const orderCol = tbl === 'calendar_events' ? 'start_time DESC' : 'created_at DESC';
        const { rows: recent } = await pool.query(
          `SELECT id, ${nameCol} as label, ${statusCol} as status, created_at FROM ${tbl} WHERE company_id = $1 ORDER BY ${orderCol} LIMIT 5`,
          [companyId]
        );
        return { success: true, data_type: a.data_type, total, recent: recent.map(r => ({ id: r.id, name: r.label, status: r.status })) };
      }

      case 'create_task': {
        const id = genId();
        let assignedTo = a.assigned_to || null;
        let assignedName = null;
        if (assignedTo) {
          const { rows: staffRows } = await pool.query(
            `SELECT email, COALESCE(full_name, name) as dname FROM staff_profiles WHERE company_id = $1 AND (LOWER(COALESCE(full_name,name,'')) LIKE $2 OR LOWER(email) = $3) LIMIT 1`,
            [companyId, '%' + assignedTo.toLowerCase() + '%', assignedTo.toLowerCase()]
          );
          if (staffRows.length) { assignedTo = staffRows[0].email; assignedName = staffRows[0].dname; }
        }
        await pool.query(
          `INSERT INTO tasks (id, company_id, title, name, description, assigned_to, assigned_to_name, due_date, priority, status, created_by)
           VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,'pending',$9)`,
          [id, companyId, a.name, a.description || null, assignedTo, assignedName, a.due_date || null, a.priority || 'medium', userEmail]
        );
        console.log(`[Lexi Tool] Task created: ${id} - ${a.name}`);
        return { success: true, id, message: `Task "${a.name}" created${assignedName ? ` and assigned to ${assignedName}` : ''}` };
      }

      case 'create_lead': {
        const id = genId();
        const addr = [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') || null;
        await pool.query(
          `INSERT INTO leads (id, company_id, name, email, phone, street, city, state, zip, address, notes, source, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new',$13)`,
          [id, companyId, a.name, a.email || null, a.phone || null, a.street || null, a.city || null, a.state || null, a.zip || null, addr, a.notes || null, a.source || 'lexi_ai', userEmail]
        );
        console.log(`[Lexi Tool] Lead created: ${id} - ${a.name}`);
        return { success: true, id, message: `Lead "${a.name}" created` };
      }

      case 'create_customer': {
        const id = genId();
        const addr = [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') || null;
        await pool.query(
          `INSERT INTO customers (id, company_id, name, email, phone, street, city, state, zip, address, notes, status, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12)`,
          [id, companyId, a.name, a.email || null, a.phone || null, a.street || null, a.city || null, a.state || null, a.zip || null, addr, a.notes || null, userEmail]
        );
        console.log(`[Lexi Tool] Customer created: ${id} - ${a.name}`);
        return { success: true, id, message: `Customer "${a.name}" created` };
      }

      case 'send_email': {
        const result = await sendEmail({ to: a.to, subject: a.subject, html: a.message });
        const commId = genId();
        await pool.query(
          `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_email, contact_name, subject, body, status, created_by)
           VALUES ($1,$2,'email','email','outbound',$3,$4,$5,$6,'sent',$7)`,
          [commId, companyId, a.to, a.contact_name || null, a.subject, a.message, userEmail]
        );
        console.log(`[Lexi Tool] Email sent to ${a.to}`);
        return { success: true, message: `Email sent to ${a.contact_name || a.to}` };
      }

      case 'send_sms': {
        const { rows: twRows } = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`, [companyId]
        );
        const tw = twRows[0]?.data || {};
        const sid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
        const token = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
        const fromPhone = tw.main_phone_number || process.env.TWILIO_PHONE_FROM || '+12167777154';
        if (!sid || !token) return { error: 'Twilio not configured for this company', success: false };
        const authHeader = Buffer.from(`${sid}:${token}`).toString('base64');
        const smsParams = new URLSearchParams({ To: a.to, From: fromPhone, Body: a.message });
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
          { method: 'POST', headers: { 'Authorization': `Basic ${authHeader}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: smsParams.toString() }
        );
        if (!twilioRes.ok) {
          const errText = await twilioRes.text();
          console.error(`[Lexi Tool] SMS failed:`, twilioRes.status, errText.substring(0, 200));
          return { error: `SMS failed: ${twilioRes.status}`, success: false };
        }
        const commId = genId();
        await pool.query(
          `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, contact_name, message, body, status, created_by)
           VALUES ($1,$2,'sms','sms','outbound',$3,$4,$5,$5,'sent',$6)`,
          [commId, companyId, a.to, a.contact_name || null, a.message, userEmail]
        );
        console.log(`[Lexi Tool] SMS sent to ${a.to}`);
        return { success: true, message: `Text message sent to ${a.contact_name || a.to}` };
      }

      case 'assign_inspection': {
        const id = genId();
        let assigneeId = null;
        let assigneeName = a.assigned_to_email;
        const { rows: staffRows } = await pool.query(
          `SELECT id, email, COALESCE(full_name, name) as dname FROM staff_profiles WHERE company_id = $1 AND LOWER(email) = $2 LIMIT 1`,
          [companyId, (a.assigned_to_email || '').toLowerCase()]
        );
        if (staffRows.length) { assigneeId = staffRows[0].id; assigneeName = staffRows[0].dname; }
        const inspDate = a.inspection_date || new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const inspTime = a.inspection_time || '10:00';
        const startTime = `${inspDate}T${inspTime}:00`;
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data)
           VALUES ($1, 'FieldActivity', $2, $3)`,
          [id, companyId, JSON.stringify({
            name: `Inspection: ${a.client_name} - ${a.property_address}`,
            activity_type: 'inspection', client_name: a.client_name, client_phone: a.client_phone || null,
            client_email: a.client_email || null, property_address: a.property_address,
            assigned_to: a.assigned_to_email, assigned_to_name: assigneeName,
            scheduled_date: inspDate, scheduled_time: inspTime,
            damage_type: a.damage_type || 'general', special_instructions: a.special_instructions || '',
            status: 'scheduled', created_by: userEmail
          })]
        );
        if (a.create_calendar_event !== false) {
          const calId = genId();
          await pool.query(
            `INSERT INTO calendar_events (id, company_id, title, event_type, start_time, end_time, location, description, assigned_to, created_by)
             VALUES ($1,$2,$3,'inspection',$4,$5,$6,$7,$8,$9)`,
            [calId, companyId, `Inspection: ${a.client_name}`, startTime,
             new Date(new Date(startTime).getTime() + 3600000).toISOString(),
             a.property_address, `${a.damage_type || 'General'} inspection. ${a.special_instructions || ''}`.trim(),
             a.assigned_to_email, userEmail]
          );
        }
        if (a.create_lead) {
          const leadId = genId();
          await pool.query(
            `INSERT INTO leads (id, company_id, name, email, phone, address, source, status, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,'inspection','new',$7,$8)`,
            [leadId, companyId, a.client_name, a.client_email || null, a.client_phone || null, a.property_address, `Inspection scheduled for ${inspDate}`, userEmail]
          );
        }
        console.log(`[Lexi Tool] Inspection assigned: ${id} → ${assigneeName}`);
        return { success: true, id, message: `Inspection for ${a.client_name} at ${a.property_address} assigned to ${assigneeName} on ${inspDate} at ${inspTime}` };
      }

      case 'manage_entity': {
        const entityTableMap = {
          lead: 'leads', leads: 'leads', customer: 'customers', customers: 'customers',
          task: 'tasks', tasks: 'tasks', estimate: 'estimates', estimates: 'estimates',
          invoice: 'invoices', invoices: 'invoices', project: 'projects', projects: 'projects',
          payment: 'payments', payments: 'payments', calendar_event: 'calendar_events', calendar_events: 'calendar_events',
          staff: 'staff_profiles', staff_profiles: 'staff_profiles'
        };
        const tbl = entityTableMap[(a.entity_name || '').toLowerCase()];

        if (!tbl) {
          const entityType = (a.entity_name || '').charAt(0).toUpperCase() + (a.entity_name || '').slice(1);
          if (a.entity_action === 'list') {
            const { rows } = await pool.query(
              `SELECT * FROM generic_entities WHERE company_id = $1 AND entity_type = $2 ORDER BY created_date DESC LIMIT 20`,
              [companyId, entityType]
            );
            return { success: true, count: rows.length, items: rows.map(r => ({ id: r.id, ...(r.data || {}) })) };
          }
          if (a.entity_action === 'create' && a.entity_data) {
            const geId = `ge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            await pool.query(
              `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4, NOW(), NOW())`,
              [geId, entityType, companyId, JSON.stringify({ ...a.entity_data, created_by: userEmail })]
            );
            return { success: true, id: geId, message: `${a.entity_name} created successfully` };
          }
          if (a.entity_action === 'update' && a.entity_id && a.entity_data) {
            await pool.query(
              `UPDATE generic_entities SET data = data || $1::jsonb, updated_date = NOW() WHERE id = $2 AND company_id = $3`,
              [JSON.stringify(a.entity_data), a.entity_id, companyId]
            );
            return { success: true, message: `${a.entity_name} updated successfully` };
          }
          if (a.entity_action === 'delete' && a.entity_id) {
            await pool.query(`DELETE FROM generic_entities WHERE id = $1 AND company_id = $2`, [a.entity_id, companyId]);
            return { success: true, message: `${a.entity_name} deleted` };
          }
          return { error: `Invalid action or missing data for ${a.entity_action}`, success: false };
        }

        if (a.entity_action === 'list') {
          const { rows: schCols } = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`, [tbl]
          );
          const colSet = new Set(schCols.map(r => r.column_name));
          const orderCol = colSet.has('created_at') ? 'created_at' : colSet.has('created_date') ? 'created_date' : 'id';
          const { rows } = await pool.query(`SELECT * FROM ${tbl} WHERE company_id = $1 ORDER BY ${orderCol} DESC LIMIT 10`, [companyId]);
          return { success: true, count: rows.length, items: rows.map(r => ({ id: r.id, name: r.full_name || r.name || r.title, status: r.status || r.availability_status, email: r.email })) };
        }
        const { rows: schemaRows } = await pool.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'`,
          [tbl]
        );
        const validCols = new Set(schemaRows.map(r => r.column_name));
        if (a.entity_action === 'create' && a.entity_data) {
          const id = genId();
          const d = a.entity_data;
          const cols = ['id', 'company_id'];
          const vals = [id, companyId];
          const placeholders = ['$1', '$2'];
          let idx = 3;
          if (validCols.has('created_by')) { cols.push('created_by'); vals.push(userEmail); placeholders.push(`$${idx++}`); }
          for (const [k, v] of Object.entries(d)) {
            if (['id', 'company_id', 'created_by'].includes(k)) continue;
            if (!validCols.has(k)) continue;
            if (v === undefined || v === null || v === '') continue;
            cols.push(k);
            vals.push(v);
            placeholders.push(`$${idx++}`);
          }
          await pool.query(`INSERT INTO ${tbl} (${cols.join(',')}) VALUES (${placeholders.join(',')})`, vals);
          return { success: true, id, message: `${a.entity_name} created` };
        }
        if (a.entity_action === 'update' && a.entity_id && a.entity_data) {
          const d = a.entity_data;
          const sets = [];
          const vals = [];
          let idx = 1;
          for (const [k, v] of Object.entries(d)) {
            if (['id', 'company_id'].includes(k)) continue;
            if (!validCols.has(k)) continue;
            sets.push(`${k} = $${idx}`);
            vals.push(v);
            idx++;
          }
          if (validCols.has('updated_at')) { sets.push(`updated_at = NOW()`); }
          if (sets.length === 0) return { error: 'No fields to update', success: false };
          vals.push(a.entity_id, companyId);
          await pool.query(`UPDATE ${tbl} SET ${sets.join(',')} WHERE id = $${idx} AND company_id = $${idx + 1}`, vals);
          return { success: true, message: `${a.entity_name} ${a.entity_id} updated` };
        }
        if (a.entity_action === 'delete' && a.entity_id) {
          await pool.query(`DELETE FROM ${tbl} WHERE id = $1 AND company_id = $2`, [a.entity_id, companyId]);
          return { success: true, message: `${a.entity_name} ${a.entity_id} deleted` };
        }
        return { error: `Invalid action or missing data for ${a.entity_action}`, success: false };
      }

      default:
        console.warn(`[Lexi Tool] Unknown tool: ${name}`);
        return { error: `Unknown tool: ${name}`, success: false };
    }
  } catch (err) {
    console.error(`[Lexi Tool] ${name} error:`, err.message);
    return { error: `Tool ${name} failed: ${err.message}`, success: false };
  }
}

function buildLexiSystemPrompt(companyName, userName, timezone, knowledgeBase, customerList, staffList, preferredLanguage) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone });
  const timeStr = now.toLocaleString('en-US', { timeZone: timezone });
  const todayISO = now.toISOString().split('T')[0];
  let staffCtx = '';
  if (staffList?.length) staffCtx = `\nStaff: ${staffList.map(s => `${s.name} (${s.email}${s.role?', '+s.role:''})`).join(', ')}`;
  const isSpanish = preferredLanguage === 'es';
  const languageInstruction = isSpanish
    ? `\nLANGUAGE: You MUST respond exclusively in Spanish (Español) at all times. Greet in Spanish. All responses must be in Spanish unless the user explicitly switches to English.`
    : '';
  return `You are Lexi, a powerful AI assistant for ${companyName}. You can do almost ANYTHING within the CRM. Speaking with ${userName}.${languageInstruction}

CRITICAL: No internal thinking text. No markdown. Speak naturally. Keep under 30 words.

Context: Company=${companyName}, User=${userName}${staffCtx}
${customerList ? `Customers: ${customerList}` : ''}
${knowledgeBase ? `Knowledge Base:\n${knowledgeBase}` : ''}

YOUR CAPABILITIES (use tools for ALL of these):
- Calendar: Create events, look up upcoming events, set reminders, schedule inspections/appointments/meetings/calls
- Tasks: Create tasks with due dates and priorities
- Leads & Customers: Create, update, look up contacts
- Inspections: Schedule roof inspections with crew assignments
- Email & SMS: Compose and send messages
- CRM Data: Look up customers, leads, estimates, invoices, tasks, projects, payments, staff, calendar events
- Generic CRUD: Create, update, delete, or list ANY entity type

Date: ${dateStr}, Time: ${timeStr}, TZ: ${timezone}, Today: ${todayISO}

TOOL RULES:
- When asked to schedule/create/remind, just do it immediately using tools. Don't ask permission.
- When asked about calendar/data, use your tools to look it up. Never guess.
- NEVER say "I can't do that" — you have full CRM access.
- CRITICAL: If a tool returns { "error": "..." } or { "success": false }, tell the user honestly: "Sorry, I wasn't able to do that" and explain the reason. NEVER claim an action succeeded if the tool result shows an error or failure.
- If a tool returns { "success": true }, confirm the action to the user naturally.

Greet ${userName} warmly.`;
}

const server = http.createServer(async (req, res) => {
  try {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/health' || pathname === '/_health' || pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  if (pathname === '/api/image-proxy' && req.method === 'GET') {
    try {
      const imageUrl = url.searchParams.get('url');
      if (!imageUrl) { res.writeHead(400); res.end('Missing url'); return; }
      const resp = await fetch(imageUrl);
      if (!resp.ok) { res.writeHead(502); res.end('Upstream error'); return; }
      const buf = await resp.arrayBuffer();
      const base64 = Buffer.from(buf).toString('base64');
      const mime = resp.headers.get('content-type') || 'image/jpeg';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ data: base64, mime }));
    } catch (e) {
      res.writeHead(500); res.end('Proxy failed');
    }
    return;
  }

  if (pathname === '/api/proxy-pdf' && req.method === 'GET') {
    const targetUrl = url.searchParams.get('url');
    console.log(`[proxy-pdf] request for: ${targetUrl}`);
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing url');
      return;
    }
    try {
      const parsedTarget = new URL(targetUrl);
      const uploadsMatch = parsedTarget.pathname.match(/^\/uploads\/(.+)$/);
      if (uploadsMatch) {
        const fileName = uploadsMatch[1];
        const ext = path.extname(fileName).toLowerCase();
        const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';
        const fileHeaders = { 'Content-Type': mimeType, 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=3600' };

        // 1. Try DB first (canonical source of truth)
        let servedFromDb = false;
        try {
          const pool = prodDb.getPool();
          const result = await pool.query('SELECT file_data, mime_type FROM file_uploads WHERE id = $1', [fileName]);
          console.log(`[proxy-pdf] DB lookup for ${fileName}: ${result.rows.length} rows`);
          if (result.rows.length > 0) {
            const { file_data, mime_type } = result.rows[0];
            res.writeHead(200, { ...fileHeaders, 'Content-Type': mime_type || mimeType });
            res.end(file_data);
            servedFromDb = true;
          }
        } catch (e) {
          console.error(`[proxy-pdf] DB error: ${e.message}`);
        }

        if (!servedFromDb) {
          // 2. Not in DB — check disk: dist/uploads/, public/uploads/, public/ root, dist/ root
          const diskCandidates = [
            path.join(__dirname, 'uploads', fileName),
            path.join(process.cwd(), 'public', 'uploads', fileName),
            path.join(process.cwd(), 'public', fileName),
            path.join(__dirname, fileName),
            path.join(process.cwd(), fileName),
          ];
          let diskFound = false;
          for (const diskPath of diskCandidates) {
            if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
              console.log(`[proxy-pdf] found on disk: ${diskPath} — syncing to DB`);
              const fileData = fs.readFileSync(diskPath);
              res.writeHead(200, fileHeaders);
              res.end(fileData);
              diskFound = true;
              // Auto-insert into DB so future requests hit DB directly
              try {
                const pool = prodDb.getPool();
                await pool.query(
                  `INSERT INTO file_uploads (id, original_filename, mime_type, file_size, file_data)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (id) DO NOTHING`,
                  [fileName, fileName, mimeType, fileData.length, fileData]
                );
                console.log(`[proxy-pdf] synced ${fileName} to DB (${fileData.length} bytes)`);
              } catch (e) {
                console.error(`[proxy-pdf] DB insert error: ${e.message}`);
              }
              break;
            }
          }
          if (!diskFound) {
            console.warn(`[proxy-pdf] not found in DB or on disk: ${fileName}`);
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File not found' }));
          }
        }
      } else {
        // Non-uploads URL — extract filename and check local disk first
        const rawPathname = parsedTarget.pathname;
        const localFileName = path.basename(rawPathname);
        const ext = path.extname(localFileName).toLowerCase();
        const mimeType = ext === '.pdf' ? 'application/pdf' : 'application/octet-stream';

        // Check local disk candidates before attempting external proxy
        const localCandidates = [
          path.join(process.cwd(), 'public', localFileName),
          path.join(process.cwd(), 'public', rawPathname.replace(/^\//, '')),
          path.join(__dirname, localFileName),
          path.join(__dirname, rawPathname.replace(/^\//, '')),
          path.join(process.cwd(), localFileName),
          // Also check uploads subdirs in case the filename is there too
          path.join(process.cwd(), 'public', 'uploads', localFileName),
          path.join(__dirname, 'uploads', localFileName),
        ];

        let servedLocally = false;
        for (const diskPath of localCandidates) {
          if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
            console.log(`[proxy-pdf] found locally for non-uploads URL: ${diskPath}`);
            const fileData = fs.readFileSync(diskPath);
            res.writeHead(200, { 'Content-Type': mimeType, 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=3600' });
            res.end(fileData);
            servedLocally = true;
            // Also try to sync to DB for future requests
            try {
              const pool = prodDb.getPool();
              await pool.query(
                `INSERT INTO file_uploads (id, original_filename, mime_type, file_size, file_data)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (id) DO NOTHING`,
                [localFileName, localFileName, mimeType, fileData.length, fileData]
              );
            } catch (_e) {}
            break;
          }
        }

        if (!servedLocally) {
          // Fall back to external proxy
          const client = parsedTarget.protocol === 'https:' ? require('https') : require('http');
          const proxyReq = client.get(targetUrl, (proxyRes) => {
            res.writeHead(proxyRes.statusCode || 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline', 'Cache-Control': 'public, max-age=3600' });
            proxyRes.pipe(res);
          });
          proxyReq.on('error', (e) => {
            if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json' }); }
            res.end(JSON.stringify({ error: 'Upstream error: ' + e.message }));
          });
        }
      }
    } catch (e) {
      console.error(`[proxy-pdf] error:`, e.message);
      if (!res.headersSent) { res.writeHead(500, { 'Content-Type': 'application/json' }); }
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Serve root path instantly from memory cache — must pass Replit health check fast
  if (pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (INDEX_HTML_CACHE) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? '' : INDEX_HTML_CACHE);
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    }
    return;
  }

  if (pathname.startsWith('/api/local/')) {
    return prodDb.handleLocalDbRoute(req, res, pathname, url);
  }

  if (pathname === '/twiml/forward-fallback') {
    setCorsHeaders(res);
    const host = getPublicHost(req.headers);
    const companyId = url.searchParams.get('companyId') || '';
    const callerPhone = url.searchParams.get('callerPhone') || '';
    const repName = url.searchParams.get('repName') || '';
    const repEmail = url.searchParams.get('repEmail') || '';
    const maxDuration = url.searchParams.get('maxDuration') || '1800';

    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const dialStatus = params.get('DialCallStatus') || '';
    const dialDuration = parseInt(params.get('DialCallDuration') || '0', 10);

    console.log(`[Sarah] Forward fallback (/twiml): dialStatus=${dialStatus}, dialDuration=${dialDuration}s, company=${companyId}, rep=${repName}`);

    // Only treat as truly completed if rep talked for >15 seconds (real conversation).
    // Short "completed" (voicemail auto-answer) falls through to Sarah.
    if (dialStatus === 'completed' && dialDuration > 15) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }

    // Rep did not answer — notify them and admins (non-blocking)
    if (companyId && (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed' || dialStatus === 'completed')) {
      (async () => {
        try {
          const pool = prodDb.getPool();
          const { rows: fbAdminRows } = await pool.query(
            `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
            [companyId]
          );
          const fbNotifyEmails = new Set();
          if (repEmail) fbNotifyEmails.add(repEmail);
          fbAdminRows.forEach(r => fbNotifyEmails.add(r.user_email));
          const statusNote = dialStatus === 'no-answer' ? 'did not answer' : dialStatus === 'busy' ? 'was busy' : dialStatus === 'completed' ? 'went to voicemail' : 'call failed';
          for (const email of fbNotifyEmails) {
            const nId = `notif_fwd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            await pool.query(
              `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
              [nId, companyId, JSON.stringify({
                id: nId,
                type: 'missed_forwarded_call',
                title: `📞 Forwarded call missed — ${callerPhone}`,
                message: `${repName || 'Rep'} ${statusNote}. Sarah took over the call with ${callerPhone}.`,
                user_email: email,
                is_read: false,
                caller_phone: callerPhone,
                rep_name: repName,
                dial_status: dialStatus,
                created_at: new Date().toISOString(),
              })]
            );
          }
        } catch (e) { console.warn('[Sarah] Forward fallback notification error:', e.message); }
      })();
    }

    const wsUrl = `wss://${host}/ws/twilio`;
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${repName ? repName + ' is not available at the moment.' : 'The person you are trying to reach is not available right now.'} Let me connect you with our AI assistant who can help.</Say>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${callerPhone}" />
            <Parameter name="maxCallDuration" value="${maxDuration}" />
            <Parameter name="isForwardedCall" value="true" />
            <Parameter name="forwardedRepName" value="${repName}" />
            <Parameter name="forwardedRepEmail" value="${repEmail}" />
            <Parameter name="callRoutingMode" value="sarah_answers" />
        </Stream>
    </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(fallbackTwiml);
    return;
  }

  if (pathname === '/twiml/transfer') {
    setCorsHeaders(res);
    const cellPhone = url.searchParams.get('cellPhone') || '';
    const callerIdNumber = url.searchParams.get('callerId') || '';
    const repName = url.searchParams.get('repName') || '';
    const callerPhone = url.searchParams.get('callerPhone') || '';

    if (!cellPhone) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">I'm sorry, I don't have a phone number to transfer to.</Say></Response>`);
      return;
    }

    const normalizePhone = p => (p || '').replace(/\D/g, '').slice(-10);
    const isSelfCall = callerPhone && normalizePhone(callerPhone) === normalizePhone(cellPhone);
    if (isSelfCall) {
      console.log(`[Sarah] TRANSFER SELF-CALL: ${callerPhone} is the rep's own cell — skipping transfer dial`);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">I detected you are calling from the rep's own phone. Transfer skipped. How else can I help you?</Say></Response>`);
      return;
    }

    const transferTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Let me transfer you to ${repName || 'your representative'} now. One moment please.</Say>
    <Dial callerId="${callerIdNumber || ''}" timeout="30">
        <Number>${cellPhone}</Number>
    </Dial>
    <Say voice="alice">I'm sorry, ${repName || 'the representative'} is not available right now.</Say>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(transferTwiml);
    console.log(`[Sarah] TRANSFER: connecting ${callerPhone} to ${cellPhone} for rep ${repName}`);
    return;
  }

  if (pathname === '/api/sarah-voice') {
    setCorsHeaders(res);
    if (req.method === 'GET') {
      const settings = loadSettings();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(settings));
    } else if (req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const settings = loadSettings();
      if (body.voice) settings.voice = body.voice;
      saveSettings(settings);
      if (body.voice && body.company_id && VALID_GEMINI_VOICES.includes(body.voice)) {
        try {
          const pool = prodDb.getPool();
          await pool.query(
            `UPDATE generic_entities SET data = data || jsonb_build_object('voice_id', $2::text), updated_date = NOW() WHERE entity_type = 'AssistantSettings' AND company_id = $1`,
            [body.company_id, body.voice]
          );
          console.log(`[Sarah] Voice updated in DB for company ${body.company_id}: ${body.voice}`);
        } catch (e) {
          console.error('[Sarah] Failed to update voice_id in DB:', e.message);
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...settings }));
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  // ============================================================
  // CACHE UPDATE ENDPOINT - called by frontend when subscriber saves settings
  // Requires BRIDGE_SECRET or valid Referer from same origin
  // ============================================================
  if (pathname === '/api/twilio/update-cache') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST') {
      const referer = req.headers.referer || req.headers.origin || '';
      const host = req.headers.host || '';
      const authHeader = req.headers['x-bridge-secret'] || '';
      const isSameOrigin = referer && (referer.includes(host) || referer.includes('replit'));
      if (!isSameOrigin && authHeader !== BRIDGE_SECRET) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        const body = JSON.parse(await readBody(req));
        const { phone_number, company_id, company_name, rep_name, rep_email, cell_phone, routing_mode, twilio_sid, twilio_token, availability_status } = body;
        if (phone_number && company_id) {
          setCachedSubscriber(phone_number, {
            companyId: company_id,
            companyName: company_name || '',
            repName: rep_name || '',
            repEmail: rep_email || '',
            cellPhone: cell_phone || '',
            routingMode: routing_mode || 'sarah_answers',
            twilioSid: twilio_sid || '',
            twilioToken: twilio_token || '',
            twilioPhone: phone_number,
            availabilityStatus: availability_status || 'available',
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, cached: normalizePhone(phone_number) }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'phone_number and company_id required' }));
        }
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  // ============================================================
  // AUTO-PROVISIONING - configures Twilio webhooks automatically
  // Requires same-origin or BRIDGE_SECRET
  // ============================================================
  if (pathname === '/api/twilio/auto-provision') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method === 'POST') {
      const referer = req.headers.referer || req.headers.origin || '';
      const host = req.headers.host || '';
      const authHeader = req.headers['x-bridge-secret'] || '';
      const isSameOrigin = referer && (referer.includes(host) || referer.includes('replit'));
      if (!isSameOrigin && authHeader !== BRIDGE_SECRET) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        const pool = prodDb.getPool();
        const body = JSON.parse(await readBody(req));
        const { account_sid, auth_token, phone_number, company_id, company_name, rep_name, rep_email, cell_phone, routing_mode } = body;
        if (!account_sid || !auth_token || !phone_number) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'account_sid, auth_token, and phone_number required' }));
          return;
        }
        const host = getPublicHost(req.headers);
        const voiceWebhookUrl = `https://${host}/api/twilio/voice`;
        const smsWebhookUrl = `https://${host}/api/whatsapp-webhook`;
        const statusCallbackUrl = `https://${host}/api/sarah-missed-call`;
        const normalizedPhone = normalizePhone(phone_number);

        const authStr = Buffer.from(`${account_sid}:${auth_token}`).toString('base64');

        // Step 1: Find the phone number SID in the subscriber's Twilio account
        const listResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(normalizedPhone)}`,
          { headers: { 'Authorization': `Basic ${authStr}` } }
        );
        const listData = await listResp.json();

        if (!listData.incoming_phone_numbers?.length) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Phone number ${normalizedPhone} not found in your Twilio account. Make sure you own this number.` }));
          return;
        }

        const phoneSid = listData.incoming_phone_numbers[0].sid;

        // Step 2: Set the webhooks on the phone number
        const updateBody = new URLSearchParams({
          VoiceUrl: voiceWebhookUrl,
          VoiceMethod: 'POST',
          SmsUrl: smsWebhookUrl,
          SmsMethod: 'POST',
          StatusCallback: statusCallbackUrl,
          StatusCallbackMethod: 'POST',
        });

        const updateResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers/${phoneSid}.json`,
          {
            method: 'POST',
            headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: updateBody.toString()
          }
        );
        const updateData = await updateResp.json();

        if (!updateResp.ok) {
          res.writeHead(updateResp.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: updateData.message || 'Failed to update Twilio webhooks', details: updateData }));
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
            console.log(`[AutoProvision] TwiML App created: ${twimlAppSid}`);
          } else {
            console.warn('[AutoProvision] TwiML App creation failed:', JSON.stringify(appData));
          }
        } catch (appErr) {
          console.warn('[AutoProvision] TwiML App error:', appErr.message);
        }

        // Step 5: Cache this subscriber's routing
        setCachedSubscriber(normalizedPhone, {
          companyId: company_id || '',
          companyName: company_name || '',
          repName: rep_name || '',
          repEmail: rep_email || '',
          cellPhone: cell_phone || '',
          routingMode: routing_mode || 'sarah_answers',
          twilioSid: account_sid,
          twilioToken: auth_token,
          twilioPhone: normalizedPhone,
          availabilityStatus: 'available',
        });

        // Step 6: Register number in local TwilioSettings available_numbers for reconciliation
        if (company_id) {
          try {
            const digits = normalizedPhone.replace(/^\+/, '');
            await pool.query(
              `UPDATE generic_entities SET data = jsonb_set(
                data,
                '{available_numbers}',
                (COALESCE(data->'available_numbers', '[]'::jsonb) || $1::jsonb || $2::jsonb)
              ) WHERE entity_type = 'TwilioSettings' AND company_id = $3
                AND NOT (data->'available_numbers' @> $1::jsonb)`,
              [JSON.stringify([normalizedPhone]), JSON.stringify([digits]), company_id]
            );
            console.log(`[AutoProvision] Registered ${normalizedPhone} in TwilioSettings available_numbers for ${company_id}`);
          } catch (regErr) {
            console.warn('[AutoProvision] Could not register number in available_numbers:', regErr.message);
          }
        }

        console.log(`[AutoProvision] Successfully provisioned ${normalizedPhone}: voice=${voiceWebhookUrl}, sms=${smsWebhookUrl}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          phone_sid: phoneSid,
          voice_webhook: voiceWebhookUrl,
          sms_webhook: smsWebhookUrl,
          status_callback: statusCallbackUrl,
          browser_call_twiml_url: browserCallTwimlUrl,
          api_key_sid: apiKeySid, api_key_secret: apiKeySecret, twiml_app_sid: twimlAppSid,
          webrtc_ready: !!(apiKeySid && twimlAppSid),
          message: 'Webhooks configured. Sarah is ready to answer calls. Browser dialer is' + (apiKeySid && twimlAppSid ? ' active.' : ' not configured (API key creation failed).')
        }));
      } catch (err) {
        console.error('[AutoProvision] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  // ==========================================
  // CONFIGURE SINGLE NUMBER WEBHOOKS
  // Used for additional (non-main) Twilio numbers assigned to staff
  // ==========================================
  if (pathname === '/api/twilio/configure-number') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const pool = prodDb.getPool();
      const body = JSON.parse(await readBody(req));
      const { account_sid, auth_token, phone_number, company_id, assigned_to_email } = body;
      if (!account_sid || !auth_token || !phone_number) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'account_sid, auth_token, and phone_number required' }));
        return;
      }
      const host = getPublicHost(req.headers);
      const voiceWebhookUrl = `https://${host}/api/twilio/voice`;
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
        res.writeHead(404, { 'Content-Type': 'application/json' });
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
        res.writeHead(updateResp.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: errData.message || 'Failed to update webhooks' }));
        return;
      }

      if (assigned_to_email && company_id) {
        const assigned_to_name = body.assigned_to_name || assigned_to_email;
        const cellPhone = body.cell_phone ? normalizePhone(body.cell_phone) : null;
        const updateResult = await pool.query(
          `UPDATE staff_profiles SET twilio_number = $1, ${cellPhone ? 'cell_phone = $4,' : ''} updated_at = NOW()
           WHERE (LOWER(user_email) = LOWER($2) OR LOWER(email) = LOWER($2)) AND company_id = $3`,
          cellPhone ? [normalizedPhone, assigned_to_email, company_id, cellPhone] : [normalizedPhone, assigned_to_email, company_id]
        );
        if (updateResult.rowCount === 0) {
          // No existing staff_profiles row — create one so routing works
          const newId = 'sp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 7);
          try {
            await pool.query(
              `INSERT INTO staff_profiles (id, company_id, full_name, name, user_email, email, twilio_number, cell_phone, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $3, $4, $4, $5, $6, true, NOW(), NOW())
               ON CONFLICT (id) DO UPDATE SET twilio_number = EXCLUDED.twilio_number, cell_phone = COALESCE(EXCLUDED.cell_phone, staff_profiles.cell_phone), updated_at = NOW()`,
              [newId, company_id, assigned_to_name, assigned_to_email, normalizedPhone, cellPhone || null]
            );
            console.log(`[ConfigureNumber] Created staff_profiles row for ${assigned_to_email} twilio=${normalizedPhone} cell=${cellPhone || 'none'}`);
          } catch (insertErr) {
            console.error('[ConfigureNumber] Insert staff_profiles failed:', insertErr.message);
          }
        } else {
          console.log(`[ConfigureNumber] Updated staff_profiles for ${assigned_to_email} twilio=${normalizedPhone} cell=${cellPhone || 'unchanged'} (${updateResult.rowCount} rows)`);
        }

        // Warm the subscriber cache immediately — no need to wait for 5-min refresh
        try {
          const { rows: spRows } = await pool.query(
            `SELECT sp.full_name, sp.user_email, sp.cell_phone, sp.call_routing_mode, sp.availability_status,
                    c.id AS cid, c.name AS cname, ts_ent.data AS twilio_data
             FROM staff_profiles sp
             LEFT JOIN companies c ON c.id = sp.company_id
             LEFT JOIN generic_entities ts_ent ON ts_ent.entity_type = 'TwilioSettings' AND ts_ent.company_id = sp.company_id
             WHERE sp.company_id = $1 AND (LOWER(sp.user_email) = LOWER($2) OR LOWER(sp.email) = LOWER($2))
             LIMIT 1`,
            [company_id, assigned_to_email]
          );
          if (spRows[0]) {
            const sp = spRows[0];
            setCachedSubscriber(normalizedPhone, {
              companyId: sp.cid || company_id,
              companyName: sp.cname || '',
              repName: sp.full_name || assigned_to_name || '',
              repEmail: sp.user_email || assigned_to_email || '',
              cellPhone: sp.cell_phone || cellPhone || '',
              routingMode: sp.call_routing_mode || 'sarah_answers',
              twilioSid: sp.twilio_data?.account_sid || body.account_sid || '',
              twilioToken: sp.twilio_data?.auth_token || body.auth_token || '',
              twilioPhone: normalizedPhone,
              availabilityStatus: sp.availability_status || 'available',
            });
            console.log(`[ConfigureNumber] Cache warmed instantly for ${normalizedPhone} -> ${sp.full_name || assigned_to_email} routing=${sp.call_routing_mode || 'sarah_answers'}`);
          }
        } catch (cacheErr) {
          console.warn('[ConfigureNumber] Cache warm failed (non-fatal):', cacheErr.message);
        }
      }

      console.log(`[ConfigureNumber] Webhooks configured for ${normalizedPhone}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: `Webhooks configured for ${normalizedPhone}` }));
    } catch (err) {
      console.error('[ConfigureNumber] Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ==========================================
  // WEBRTC TOKEN ENDPOINT
  // ==========================================
  if (pathname === '/api/twilio/webrtc-token' && req.method === 'GET') {
    setCorsHeaders(res);
    try {
      const companyId = url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
      const identity = url.searchParams.get('identity') || 'agent';
      const pool = prodDb.getPool();
      const settings = await pool.query(
        "SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1",
        [companyId]
      ).then(r => r.rows[0]?.data || {}).catch(() => ({}));
      const accountSid = settings.account_sid || process.env.TWILIO_ACCOUNT_SID;
      const apiKeySid = settings.api_key_sid;
      const apiKeySecret = settings.api_key_secret;
      const twimlAppSid = settings.twiml_app_sid;
      if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'WebRTC not configured. Please re-run "Connect Sarah to This Number" in Twilio Setup.' }));
        return;
      }
      const token = generateTwilioToken(accountSid, apiKeySid, apiKeySecret, identity, twimlAppSid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token, identity }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ==========================================
  // BROWSER CALL TWIML
  // ==========================================
  if (pathname === '/api/twilio/browser-call-twiml') {
    setCorsHeaders(res);
    try {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const to = params.get('To') || url.searchParams.get('To') || '';
      const companyId = params.get('CompanyId') || url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
      const contactName = params.get('ContactName') || url.searchParams.get('contactName') || '';
      const host = getPublicHost(req.headers);
      const transcriptionCallbackUrl = `https://${host}/api/twilio/transcription-done?companyId=${encodeURIComponent(companyId)}&contactName=${encodeURIComponent(contactName)}`;
      const pool = prodDb.getPool();
      const settings = await pool.query(
        "SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1",
        [companyId]
      ).then(r => r.rows[0]?.data || {}).catch(() => ({}));
      // Prefer rep's own Twilio number (passed as RepPhone), fall back to main company number
      const repPhoneRaw = params.get('RepPhone') || url.searchParams.get('RepPhone') || '';
      const repPhone = repPhoneRaw ? (repPhoneRaw.startsWith('+') ? repPhoneRaw : `+1${repPhoneRaw.replace(/\D/g, '')}`) : '';
      const callerId = repPhone || settings.main_phone_number || process.env.TWILIO_PHONE_NUMBER || '';
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This call may be monitored or recorded for quality assurance.</Say>
  <Dial callerId="${callerId}" record="record-from-ringing" timeout="30">
    <Number>${to}</Number>
  </Dial>
</Response>`;
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(twiml);
      console.log(`[Dialer] Browser call TwiML: to=${to}, from=${callerId}, company=${companyId}${repPhone ? ' (rep line)' : ' (main line)'}`);
    } catch (err) {
      const errTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>We're sorry, the call could not be connected. Please try again.</Say></Response>`;
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(errTwiml);
    }
    return;
  }

  // ==========================================
  // TRANSCRIPTION WEBHOOK
  // ==========================================
  if (pathname === '/api/twilio/transcription-done') {
    setCorsHeaders(res);
    try {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const transcriptionText = params.get('TranscriptionText') || '';
      const callSid = params.get('CallSid') || '';
      const companyId = url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
      const contactName = url.searchParams.get('contactName') || '';
      if (transcriptionText && companyId) {
        const pool = prodDb.getPool();
        const existing = await pool.query(
          "SELECT id FROM communications WHERE company_id=$1 AND data->>'call_sid'=$2 LIMIT 1",
          [companyId, callSid]
        ).catch(() => ({ rows: [] }));
        if (existing.rows[0]) {
          await pool.query(
            "UPDATE communications SET data = data || $1::jsonb, updated_at=NOW() WHERE id=$2",
            [JSON.stringify({ transcription: transcriptionText, transcription_status: 'completed' }), existing.rows[0].id]
          );
        } else {
          const newId = `comm_trans_${Date.now()}`;
          await pool.query(
            `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_name, status, data, created_at, updated_at)
             VALUES ($1,$2,'call','call','outbound',$3,'completed',$4,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
            [newId, companyId, contactName, JSON.stringify({ call_sid: callSid, transcription: transcriptionText, transcription_status: 'completed' })]
          );
        }
        console.log(`[Dialer] Transcription saved for call ${callSid} (${transcriptionText.length} chars)`);
      }
      res.writeHead(204);
      res.end();
    } catch (err) {
      console.error('[Dialer] Transcription webhook error:', err.message);
      res.writeHead(200);
      res.end('ok');
    }
    return;
  }

  if (pathname === '/api/twilio/voice') {
    setCorsHeaders(res);
    const host = getPublicHost(req.headers);
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const from = params.get('From') || params.get('Caller') || '';
    const callSid = params.get('CallSid') || '';
    const calledNumber = params.get('To') || '';
    console.log(`[INBOUND-CALL] ${new Date().toISOString()} | From=${from} | To=${calledNumber} | CallSid=${callSid} | Host=${host}`);
    const pool = prodDb.getPool();

    // === FAST PATH: Check in-memory cache first (no DB calls) ===
    let cached = getCachedSubscriber(calledNumber);
    let resolvedCompanyId = url.searchParams.get('companyId') || cached?.companyId || null;

    // Check for custom inbound phone in Sarah settings (only on cache miss)
    if (!cached && calledNumber) {
      try {
        const { rows } = await pool.query(
          "SELECT data, company_id FROM generic_entities WHERE entity_type = 'AssistantSettings' AND (data->>'sarah_inbound_phone' = $1) LIMIT 1",
          [calledNumber]
        );
        if (rows[0]) {
          resolvedCompanyId = rows[0].company_id;
          console.log(`[Sarah] Custom inbound phone match: ${calledNumber} -> company ${resolvedCompanyId}`);
        }
      } catch (e) {}
    }
    let forwardedRepName = url.searchParams.get('repName') || cached?.repName || '';
    let forwardedRepEmail = url.searchParams.get('repEmail') || cached?.repEmail || '';
    let forwardedRepPhone = cached?.cellPhone || '';
    let isForwarded = !!(forwardedRepName || url.searchParams.get('forwarded') === 'true');
    let effectiveRoutingMode = cached?.routingMode || 'sarah_answers';
    let cellPhone = cached?.cellPhone || '';

    // If cached subscriber is unavailable, override to sarah_answers
    if (cached && cached.availabilityStatus === 'unavailable') {
      effectiveRoutingMode = 'sarah_answers';
    }

    // If no cache hit, try local PostgreSQL first, then Base44 API
    if (!cached && calledNumber) {
      console.log(`[Sarah] Cache miss for ${calledNumber}, trying local DB...`);
      try {
        const normalizedNum = calledNumber.replace(/[^\d+]/g, '');
        const e164 = normalizedNum.startsWith('+') ? normalizedNum : `+1${normalizedNum}`;
        const digits = normalizedNum.replace(/^\+/, '');
        const localLookup = await pool.query(
          `SELECT company_id FROM call_routing_cache WHERE phone_number = $1 OR phone_number = $2 OR phone_number = $3 LIMIT 1`,
          [calledNumber, e164, digits]
        );
        if (localLookup.rows[0]) {
          resolvedCompanyId = localLookup.rows[0].company_id;
          console.log(`[Sarah] Local routing cache hit: ${calledNumber} -> company ${resolvedCompanyId}`);
        }
        if (!resolvedCompanyId) {
          const twilioLookup = await pool.query(
            `SELECT company_id FROM generic_entities WHERE entity_type = 'TwilioSettings' AND (
              data->>'main_phone_number' = $1 OR data->>'main_phone_number' = $2 OR data->>'main_phone_number' = $3
              OR EXISTS (SELECT 1 FROM jsonb_array_elements(data->'available_numbers') elem WHERE elem->>'phone_number' = $1 OR elem->>'phone_number' = $2 OR elem->>'phone_number' = $3)
            ) LIMIT 1`,
            [calledNumber, e164, digits]
          );
          if (twilioLookup.rows[0]) {
            resolvedCompanyId = twilioLookup.rows[0].company_id;
            console.log(`[Sarah] Local TwilioSettings hit: ${calledNumber} -> company ${resolvedCompanyId}`);
          }
        }
      } catch (e) { console.warn(`[Sarah] Local DB lookup failed:`, e.message); }

      if (!resolvedCompanyId && BASE44_API_URL) {
        console.log(`[Sarah] Local DB miss, falling back to Base44 API for ${calledNumber}...`);
        try {
          const lookup = await callBase44API('lookupByPhone', null, { phone_number: calledNumber });
          if (lookup?.success && lookup.company_id) {
            resolvedCompanyId = lookup.company_id;
            console.log(`[Sarah] Base44 lookup: ${calledNumber} -> company ${resolvedCompanyId}`);
          }
        } catch (e) { console.warn(`[Sarah] Base44 company lookup failed:`, e.message); }
      }

      // Also restore staff routing from DB on cache miss
      if (resolvedCompanyId) {
        try {
          const staffLookup = await callBase44API('lookupStaffByTwilioNumber', resolvedCompanyId, { twilio_number: calledNumber });
          if (staffLookup?.success && staffLookup.staff) {
            const staff = staffLookup.staff;
            isForwarded = true;
            forwardedRepName = staff.full_name || '';
            forwardedRepEmail = staff.email || '';
            forwardedRepPhone = staff.cell_phone || staff.phone || '';
            cellPhone = staff.cell_phone || staff.phone || '';
            effectiveRoutingMode = staff.availability_status === 'unavailable' ? 'sarah_answers' : (staff.call_routing_mode || 'sarah_answers');

            // After-hours check
            const staffData = staff.data || {};
            if (effectiveRoutingMode !== 'sarah_answers' && staffData.after_hours_enabled && staffData.after_hours_start && staffData.after_hours_end) {
              const now = new Date();
              const currentMins = now.getHours() * 60 + now.getMinutes();
              const [sH, sM] = staffData.after_hours_start.split(':').map(Number);
              const [eH, eM] = staffData.after_hours_end.split(':').map(Number);
              const startMins = sH * 60 + (sM || 0);
              const endMins = eH * 60 + (eM || 0);
              if (currentMins < startMins || currentMins >= endMins) {
                effectiveRoutingMode = 'sarah_answers';
                console.log(`[Sarah] After-hours override for ${forwardedRepName}: routing to sarah_answers (outside ${staffData.after_hours_start}-${staffData.after_hours_end})`);
              }
            }

            console.log(`[Sarah] DB staff routing: rep=${forwardedRepName}, mode=${effectiveRoutingMode}, cell=${cellPhone}`);

            // Populate cache for next time
            try {
              const twilioSettings = await callBase44API('getTwilioSettings', resolvedCompanyId);
              setCachedSubscriber(calledNumber, {
                companyId: resolvedCompanyId,
                companyName: '',
                repName: forwardedRepName,
                repEmail: forwardedRepEmail,
                cellPhone: cellPhone,
                routingMode: staff.call_routing_mode || 'sarah_answers',
                twilioSid: twilioSettings?.account_sid || '',
                twilioToken: twilioSettings?.auth_token || '',
                twilioPhone: calledNumber,
                availabilityStatus: staff.availability_status || 'available',
                data: staffData,
              });
            } catch (e) { /* cache population is best effort */ }
          }
        } catch (e) { console.log(`[Sarah] DB staff lookup: not a staff number`); }
      }
    }
    if (!resolvedCompanyId) resolvedCompanyId = DEFAULT_COMPANY_ID;

    // Reconcile external/cached company ID with local DB — cache may contain Base44 IDs
    try {
      const { rows: localCoRows } = await pool.query(
        `SELECT id FROM companies WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
        [resolvedCompanyId]
      );
      if (localCoRows.length === 0 && calledNumber) {
        // ID from cache not found locally — find the local company by phone number
        const normalizedNum = calledNumber.replace(/[^\d+]/g, '');
        const e164 = normalizedNum.startsWith('+') ? normalizedNum : `+1${normalizedNum}`;
        const digits = normalizedNum.replace(/^\+/, '');
        const { rows: twRows } = await pool.query(
          `SELECT company_id FROM generic_entities WHERE entity_type = 'TwilioSettings' AND (
            data->>'main_phone_number' = $1 OR data->>'main_phone_number' = $2 OR data->>'main_phone_number' = $3
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(data->'available_numbers') elem WHERE elem->>'phone_number' = $1 OR elem->>'phone_number' = $2 OR elem->>'phone_number' = $3)
          ) LIMIT 1`,
          [calledNumber, e164, digits]
        );
        if (twRows[0]) {
          console.log(`[Sarah] Reconciled company ID: ${resolvedCompanyId} -> ${twRows[0].company_id} via TwilioSettings for ${calledNumber}`);
          resolvedCompanyId = twRows[0].company_id;
        } else {
          console.warn(`[Sarah] No local company found for ${calledNumber}, using ID as-is: ${resolvedCompanyId}`);
        }
      }
    } catch (e) { console.warn('[Sarah] Company ID reconciliation failed:', e.message); }

    if (cached) {
      isForwarded = true;
      console.log(`[Sarah] CACHE HIT: ${calledNumber} -> company=${resolvedCompanyId}, rep=${forwardedRepName}, routing=${effectiveRoutingMode}, cell=${cellPhone}`);
    }

    let maxCallDuration = 1800;
    if (BASE44_API_URL) {
      try {
        const accessCheck = await callBase44API('checkVoiceAccess', resolvedCompanyId);
        if (accessCheck && accessCheck.allowed === false) {
          console.warn(`[Sarah] BLOCKED: Company ${resolvedCompanyId} denied: ${accessCheck.reason}`);
          const blockedTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">We're sorry, voice service is currently unavailable. ${accessCheck.reason || 'Please contact your administrator.'}</Say><Hangup/></Response>`;
          res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(blockedTwiml); return;
        }
        if (accessCheck?.max_call_duration_seconds) maxCallDuration = accessCheck.max_call_duration_seconds;
      } catch (e) { console.warn(`[Sarah] Access check failed, allowing:`, e.message); }
    }

    if (effectiveRoutingMode === 'forward_to_cell' && cellPhone) {
      const normalizePhone = p => (p || '').replace(/\D/g, '').slice(-10);
      const isSelfCall = normalizePhone(from) === normalizePhone(cellPhone);
      if (isSelfCall) {
        console.log(`[Sarah] SELF-CALL DETECTED: ${from} is the rep's own cell — routing to Sarah instead of forwarding`);
        // Fall through to Sarah WebSocket below
      } else {
        const forwardTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial callerId="${calledNumber}" timeout="20" record="record-from-answer" recordingStatusCallback="https://${host}/api/twilio/recording-callback" recordingStatusCallbackMethod="POST" action="https://${host}/api/twilio/forward-fallback?companyId=${resolvedCompanyId}&callerPhone=${encodeURIComponent(from)}&repName=${encodeURIComponent(forwardedRepName)}&repEmail=${encodeURIComponent(forwardedRepEmail)}&maxDuration=${maxCallDuration}">
        <Number>${cellPhone}</Number>
    </Dial>
</Response>`;
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(forwardTwiml);
        console.log(`[Sarah] FORWARD TO CELL: caller=${from}, forwarding to ${cellPhone} for rep ${forwardedRepName}`);
        return;
      }
    }

    console.log(`[Sarah] Inbound call from ${from}, SID: ${callSid}, company=${resolvedCompanyId}, forwarded=${isForwarded}${isForwarded ? ` rep=${forwardedRepName}` : ''}, routing=${effectiveRoutingMode}, maxDuration=${maxCallDuration}s`);
    const wsUrl = `wss://${host}/ws/twilio`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">This call may be monitored or recorded for quality assurance.</Say>
    <Connect record="record-from-answer" recordingStatusCallback="https://${host}/api/twilio/recording-callback" recordingStatusCallbackMethod="POST">
        <Stream url="${wsUrl}">
            <Parameter name="companyId" value="${resolvedCompanyId}" />
            <Parameter name="from" value="${from}" />
            <Parameter name="callSid" value="${callSid}" />
            <Parameter name="maxCallDuration" value="${maxCallDuration}" />
            <Parameter name="isForwardedCall" value="${isForwarded ? 'true' : 'false'}" />
            <Parameter name="forwardedRepName" value="${forwardedRepName}" />
            <Parameter name="forwardedRepEmail" value="${forwardedRepEmail}" />
            <Parameter name="forwardedRepPhone" value="${forwardedRepPhone}" />
            <Parameter name="callRoutingMode" value="${effectiveRoutingMode}" />
            <Parameter name="staffCellPhone" value="${cellPhone}" />
            <Parameter name="calledNumber" value="${calledNumber}" />
        </Stream>
    </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    return;
  }

  if (pathname === '/api/twilio/forward-fallback') {
    setCorsHeaders(res);
    const host = getPublicHost(req.headers);
    const companyId = url.searchParams.get('companyId') || '';
    const callerPhone = url.searchParams.get('callerPhone') || '';
    const repName = url.searchParams.get('repName') || '';
    const repEmail = url.searchParams.get('repEmail') || '';
    const maxDuration = url.searchParams.get('maxDuration') || '1800';

    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const dialStatus = params.get('DialCallStatus') || '';
    const dialDuration = parseInt(params.get('DialCallDuration') || '0', 10);

    console.log(`[Sarah] Forward fallback: dialStatus=${dialStatus}, dialDuration=${dialDuration}s, company=${companyId}, rep=${repName}`);

    // Only treat as truly completed (real conversation) if rep talked for >15 seconds.
    // Short "completed" calls (<= 15s) are voicemail auto-answers — fall through to Sarah.
    if (dialStatus === 'completed' && dialDuration > 15) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }

    // Rep did not answer — notify them and admins (non-blocking)
    if (companyId && (dialStatus === 'no-answer' || dialStatus === 'busy' || dialStatus === 'failed' || dialStatus === 'completed')) {
      (async () => {
        try {
          const pool = prodDb.getPool();
          const { rows: fbAdminRows2 } = await pool.query(
            `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
            [companyId]
          );
          const fbNotifyEmails2 = new Set();
          if (repEmail) fbNotifyEmails2.add(repEmail);
          fbAdminRows2.forEach(r => fbNotifyEmails2.add(r.user_email));
          const statusNote2 = dialStatus === 'no-answer' ? 'did not answer' : dialStatus === 'busy' ? 'was busy' : dialStatus === 'completed' ? 'went to voicemail' : 'call failed';
          for (const email of fbNotifyEmails2) {
            const nId = `notif_fwd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            await pool.query(
              `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
              [nId, companyId, JSON.stringify({
                id: nId,
                type: 'missed_forwarded_call',
                title: `📞 Forwarded call missed — ${callerPhone}`,
                message: `${repName || 'Rep'} ${statusNote2}. Sarah took over the call with ${callerPhone}.`,
                user_email: email,
                is_read: false,
                caller_phone: callerPhone,
                rep_name: repName,
                dial_status: dialStatus,
                created_at: new Date().toISOString(),
              })]
            );
          }
        } catch (e) { console.warn('[Sarah] Forward fallback notification error:', e.message); }
      })();
    }

    const wsUrl = `wss://${host}/ws/twilio`;
    const fallbackTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">${repName ? repName + ' is not available at the moment.' : 'The person you are trying to reach is not available right now.'} Let me connect you with our AI assistant who can help.</Say>
    <Connect record="record-from-answer" recordingStatusCallback="https://${host}/api/twilio/recording-callback" recordingStatusCallbackMethod="POST">
        <Stream url="${wsUrl}">
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
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(fallbackTwiml);
    return;
  }

  if (pathname === '/api/twilio/recording-callback') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const callSid = params.get('CallSid') || '';
    const recordingUrl = params.get('RecordingUrl') || '';
    const recordingStatus = params.get('RecordingStatus') || '';
    const recordingSid = params.get('RecordingSid') || '';

    console.log(`[Sarah] Recording callback: callSid=${callSid}, status=${recordingStatus}, sid=${recordingSid}`);

    if (recordingStatus === 'completed' && recordingUrl && callSid) {
      const mp3Url = recordingUrl + '.mp3';
      try {
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
                    await pool.query(
                      `UPDATE communications SET ai_summary = $1, updated_at = NOW() WHERE data->>'call_sid' = $2`,
                      [summary, callSid]
                    );
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
    return;
  }

  if (pathname === '/api/twilio/transfer') {
    setCorsHeaders(res);
    const cellPhone = url.searchParams.get('cellPhone') || '';
    const callerIdNumber = url.searchParams.get('callerId') || '';
    const repName = url.searchParams.get('repName') || '';
    const callerPhone = url.searchParams.get('callerPhone') || '';

    if (!cellPhone) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">I'm sorry, I don't have a phone number to transfer to.</Say></Response>`);
      return;
    }

    const normalizePhoneT = p => (p || '').replace(/\D/g, '').slice(-10);
    const isSelfCallT = callerPhone && normalizePhoneT(callerPhone) === normalizePhoneT(cellPhone);
    if (isSelfCallT) {
      console.log(`[Sarah] TRANSFER SELF-CALL: ${callerPhone} is the rep's own cell — skipping transfer dial`);
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">I detected you are calling from the rep's own phone. Transfer skipped. How else can I help you?</Say></Response>`);
      return;
    }

    const transferTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">Let me transfer you to ${repName || 'your representative'} now. One moment please.</Say>
    <Dial callerId="${callerIdNumber || ''}" timeout="30">
        <Number>${cellPhone}</Number>
    </Dial>
    <Say voice="alice">I'm sorry, ${repName || 'the representative'} is not available right now. Please try again later.</Say>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(transferTwiml);
    console.log(`[Sarah] TRANSFER: connecting ${callerPhone} to ${cellPhone} for rep ${repName}`);
    return;
  }

  if (pathname === '/api/twilio/outbound-voice') {
    setCorsHeaders(res);
    const host = getPublicHost(req.headers);
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const from = params.get('From') || params.get('Caller') || '';
    const callSid = params.get('CallSid') || '';
    const companyId = url.searchParams.get('companyId') || DEFAULT_COMPANY_ID;
    const leadPhone = url.searchParams.get('leadPhone') || '';
    const leadName = url.searchParams.get('leadName') || '';
    const leadService = url.searchParams.get('leadService') || '';
    const leadAddress = url.searchParams.get('leadAddress') || '';
    const maxDuration = url.searchParams.get('maxDuration') || '600';
    const campaignRaw = url.searchParams.get('campaign') || '';
    const escapedCampaign = campaignRaw.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const wsUrl = `wss://${host}/ws/twilio`;
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">This call may be monitored or recorded for quality assurance.</Say>
    <Connect>
        <Stream url="${wsUrl}">
            <Parameter name="companyId" value="${companyId}" />
            <Parameter name="callerPhone" value="${leadPhone}" />
            <Parameter name="callSid" value="${callSid}" />
            <Parameter name="outbound" value="true" />
            <Parameter name="leadName" value="${leadName}" />
            <Parameter name="leadService" value="${leadService}" />
            <Parameter name="leadAddress" value="${leadAddress}" />
            <Parameter name="maxCallDuration" value="${maxDuration}" />
            <Parameter name="campaign" value="${escapedCampaign}" />
        </Stream>
    </Connect>
</Response>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(twiml);
    console.log(`[Sarah] Served outbound TwiML: lead=${leadName}, phone=${leadPhone}, company=${companyId}, campaign=${campaignRaw ? 'yes' : 'none'}`);
    return;
  }

  if (pathname === '/api/twilio/outbound-call') {
    setCorsHeaders(res);
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const { to, companyId: cId, leadName: ln, leadService: ls } = body;
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
        if (!accountSid || !authToken || !twilioPhone) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Twilio not configured' }));
          return;
        }
        const host = getPublicHost(req.headers);
        const twimlUrl = `https://${host}/api/twilio/outbound-voice?companyId=${cId || DEFAULT_COMPANY_ID}&leadName=${encodeURIComponent(ln || '')}&leadService=${encodeURIComponent(ls || '')}`;
        const params = new URLSearchParams({ To: to, From: twilioPhone, Url: twimlUrl });
        const twilioResp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64') },
          body: params.toString()
        });
        const data = await twilioResp.json();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, callSid: data.sid }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.writeHead(405); res.end();
    }
    return;
  }

  // ==========================================
  // STRIPE OVERVIEW ENDPOINT
  // ==========================================
  if (pathname === '/api/stripe/overview' && req.method === 'GET') {
    try {
      const schemaCheck = await pool.query(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='stripe' AND table_name='subscriptions'"
      );
      if (schemaCheck.rows[0].count === '0') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ subscriptions: [], invoices: [], customers: [], summary: { totalRevenue: 0, activeSubscriptions: 0, totalCustomers: 0, paidInvoices: 0 } }));
        return;
      }
      const [subsRes, invRes, custRes, piRes] = await Promise.all([
        pool.query(`SELECT id, status, customer, items, metadata, current_period_start, current_period_end, cancel_at_period_end, created, trial_end FROM stripe.subscriptions ORDER BY created DESC NULLS LAST LIMIT 100`),
        pool.query(`SELECT id, total, amount_paid, status, customer, customer_email, customer_name, number, created, hosted_invoice_url, invoice_pdf, currency, subscription FROM stripe.invoices ORDER BY created DESC NULLS LAST LIMIT 50`),
        pool.query(`SELECT id, email, name, created, balance, currency FROM stripe.customers ORDER BY created DESC NULLS LAST LIMIT 100`),
        pool.query(`SELECT SUM(amount_received) as total_received, COUNT(*) as count FROM stripe.payment_intents WHERE status='succeeded'`),
      ]);
      const totalRevenue = Number(piRes.rows[0]?.total_received || 0) / 100;
      const activeSubscriptions = subsRes.rows.filter(s => s.status === 'active' || s.status === 'trialing').length;
      const paidInvoicesTotal = invRes.rows.filter(i => i.status === 'paid').reduce((sum, i) => sum + Number(i.amount_paid || 0), 0) / 100;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        subscriptions: subsRes.rows,
        invoices: invRes.rows,
        customers: custRes.rows,
        summary: { totalRevenue, paidInvoicesTotal, activeSubscriptions, totalCustomers: custRes.rows.length, paidInvoices: invRes.rows.filter(i => i.status === 'paid').length },
      }));
    } catch (err) {
      console.error('[Stripe Overview]', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, subscriptions: [], invoices: [], customers: [], summary: { totalRevenue: 0, activeSubscriptions: 0, totalCustomers: 0, paidInvoices: 0 } }));
    }
    return;
  }

  // ==========================================
  // ADMIN HEALTH ENDPOINT
  // ==========================================
  if (pathname === '/admin/health' && req.method === 'GET') {
    try {
      const sessionUser = req.session?.passport?.user || req.session?.user;
      const userEmail = sessionUser?.claims?.email || sessionUser?.email;
      if (!userEmail) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authenticated' }));
        return;
      }
      const userCheck = await pool.query('SELECT platform_role FROM users WHERE email = $1', [userEmail]);
      const role = userCheck.rows[0]?.platform_role;
      if (role !== 'super_admin' && role !== 'admin') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not authorized' }));
        return;
      }
      const dbCheck = await pool.query('SELECT COUNT(*) as count FROM users').catch(() => ({ rows: [{ count: -1 }] }));
      const companyCount = await pool.query('SELECT COUNT(*) as count FROM generic_entities WHERE entity_type = $1', ['Company']).catch(() => ({ rows: [{ count: -1 }] }));
      const leadCount = await pool.query('SELECT COUNT(*) as count FROM generic_entities WHERE entity_type = $1', ['Lead']).catch(() => ({ rows: [{ count: -1 }] }));
      const sessionCount = await pool.query('SELECT COUNT(*) as count FROM sessions').catch(() => ({ rows: [{ count: -1 }] }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: { connected: true, users: parseInt(dbCheck.rows[0].count), companies: parseInt(companyCount.rows[0].count), leads: parseInt(leadCount.rows[0].count), active_sessions: parseInt(sessionCount.rows[0].count) },
        memory: { rss: Math.round(process.memoryUsage().rss / 1024 / 1024), heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024), heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) },
        environment: process.env.NODE_ENV || 'production',
        services: {
          twilio: !!process.env.TWILIO_ACCOUNT_SID,
          gemini: !!process.env.GOOGLE_GEMINI_API_KEY,
          resend: !!process.env.RESEND_API_KEY,
          google_maps: !!process.env.GOOGLE_MAPS_API_KEY,
        }
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
    return;
  }

  // ==========================================
  // AUTH ENDPOINTS
  // ==========================================
  if (req.method === 'OPTIONS' && (pathname === '/api/signup' || pathname === '/api/login-local' || pathname === '/api/change-password' || pathname === '/api/forgot-password' || pathname === '/api/reset-password' || pathname === '/api/auth/google' || pathname === '/api/auth/google/callback')) {
    setCorsHeaders(res, req);
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname === '/api/auth/google') {
    setCorsHeaders(res, req);
    const host = req.headers.host;
    const callbackUrl = `https://${host}/api/auth/google/callback`;
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: 'profile email',
      access_type: 'offline',
      prompt: 'consent'
    });
    res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
    res.end();
    return;
  }

  if (pathname === '/api/auth/google/callback') {
    setCorsHeaders(res, req);
    try {
      const code = url.searchParams.get('code');
      const host = req.headers.host;
      const callbackUrl = `https://${host}/api/auth/google/callback`;

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code'
        })
      });

      const tokens = await tokenResp.json();
      if (!tokens.access_token) throw new Error('Failed to get access token');

      const userinfoResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${tokens.access_token}` }
      });
      const profile = await userinfoResp.json();

      const claims = {
        sub: profile.sub,
        email: profile.email,
        first_name: profile.given_name,
        last_name: profile.family_name,
        profile_image_url: profile.picture
      };

      const pool = prodDb.getPool();
      await pool.query(
        `INSERT INTO users (id, email, first_name, last_name, profile_image_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           email = COALESCE($2, users.email),
           first_name = COALESCE($3, users.first_name),
           last_name = COALESCE($4, users.last_name),
           profile_image_url = COALESCE($5, users.profile_image_url),
           updated_at = NOW()`,
        [claims.sub, claims.email, claims.first_name, claims.last_name, claims.profile_image_url]
      );

      const sessionData = {
        cookie: { originalMaxAge: 7 * 24 * 60 * 60 * 1000, expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
        passport: { user: { claims } }
      };

      const sid = await prodAuth.createSession(pool, sessionData);
      const signedSid = require('crypto').createHmac('sha256', process.env.SESSION_SECRET).update(sid).digest('base64').replace(/=+$/, '');
      const cookieValue = `connect.sid=${encodeURIComponent('s:' + sid + '.' + signedSid)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`;

      res.writeHead(302, { Location: '/', 'Set-Cookie': cookieValue });
      res.end();
    } catch (err) {
      console.error('[GoogleAuth] Callback error:', err.message);
      res.writeHead(302, { Location: '/login?error=google_auth_failed' });
      res.end();
    }
    return;
  }

  if (pathname === '/api/login-local' && req.method === 'POST') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleLoginLocal(req, res, pool);
    return;
  }

  if (pathname === '/api/signup' && req.method === 'POST') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleSignup(req, res, pool);
    return;
  }

  if (pathname === '/api/confirm-email') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleConfirmEmail(req, res, pool);
    return;
  }

  if (pathname === '/api/change-password' && req.method === 'POST') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleChangePassword(req, res, pool);
    return;
  }

  if (pathname === '/api/forgot-password' && req.method === 'POST') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleForgotPassword(req, res, pool);
    return;
  }

  if (pathname === '/api/reset-password' && req.method === 'POST') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await localAuth.handleResetPassword(req, res, pool);
    return;
  }

  if (pathname === '/api/admin/set-staff-password' && req.method === 'POST') {
    const pool = prodDb.getPool();
    await localAuth.handleAdminSetStaffPassword(req, res, pool);
    return;
  }

  if (pathname === '/api/admin/fix-user-company' && req.method === 'POST') {
    const key = req.headers['x-admin-key'] || '';
    const ADMIN_FIX_KEY = process.env.ADMIN_FIX_KEY || process.env.SESSION_SECRET;
    if (!ADMIN_FIX_KEY || key !== ADMIN_FIX_KEY) {
      res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Forbidden' })); return;
    }
    try {
      const pool = prodDb.getPool();
      const REAL_YICN_ID = 'loc_mmdvp1h5_e8i9eb';
      const results = [];

      const yicnStaffData = {
        'brian.yicn@gmail.com': { first_name: 'Brian', last_name: 'Thornton', role: 'staff', is_administrator: false },
        'stonekevin866@gmail.com': { first_name: 'Virgil', last_name: 'Stone', role: 'admin', is_administrator: true },
      };
      const yicnStaff = Object.keys(yicnStaffData);

      // Fix company_id on users table
      for (const email of yicnStaff) {
        const r = await pool.query(
          `UPDATE users SET company_id = $1, updated_at = NOW() WHERE LOWER(email) = $2 RETURNING email`,
          [REAL_YICN_ID, email]
        );
        if (r.rows.length > 0) results.push(`Fixed company_id for: ${email}`);
      }

      // Backfill first_name / last_name on users table so "Welcome, Name!" works
      for (const [email, info] of Object.entries(yicnStaffData)) {
        const r = await pool.query(
          `UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW()
           WHERE LOWER(email) = $3 AND (first_name IS NULL OR first_name = '' OR last_name IS NULL OR last_name = '') RETURNING email`,
          [info.first_name, info.last_name, email]
        );
        if (r.rows.length > 0) results.push(`Updated name for ${email}: ${info.first_name} ${info.last_name}`);
      }

      // Deactivate wrong-company staff profiles
      await pool.query(
        `UPDATE staff_profiles SET is_active = false WHERE user_email = ANY($1) AND company_id != $2`,
        [yicnStaff, REAL_YICN_ID]
      );
      results.push('Deactivated wrong-company staff profiles');

      // Update existing YICN staff profiles with correct name/role
      for (const [email, info] of Object.entries(yicnStaffData)) {
        const fullName = `${info.first_name} ${info.last_name}`;
        await pool.query(
          `UPDATE staff_profiles SET is_active = true, role = $3, is_administrator = $4,
           name = $5, full_name = $5, updated_at = NOW()
           WHERE user_email = $1 AND company_id = $2`,
          [email, REAL_YICN_ID, info.role, info.is_administrator, fullName]
        );
        results.push(`Updated profile for ${email} at YICN`);
      }

      // Clear sessions so next login picks up fresh data
      await pool.query(`DELETE FROM sessions`);
      results.push('Cleared all sessions');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname === '/api/admin/fix-brian-leads' && req.method === 'POST') {
    const key = req.headers['x-admin-key'] || '';
    const ADMIN_FIX_KEY = process.env.ADMIN_FIX_KEY || process.env.SESSION_SECRET;
    if (!ADMIN_FIX_KEY || key !== ADMIN_FIX_KEY) {
      res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Forbidden' })); return;
    }
    try {
      const pool = prodDb.getPool();
      const YICN_ID = 'loc_mmdvp1h5_e8i9eb';
      const WRONG_COMPANY_ID = 'company_1773143175492_bwwge66gf';
      const results = [];

      // 1. Make Brian an admin on his YICN staff profile so filterLeads returns leads
      const r1 = await pool.query(
        `UPDATE staff_profiles SET is_administrator = true, role = 'admin', updated_at = NOW()
         WHERE user_email = 'brian.yicn@gmail.com' AND company_id = $1 RETURNING id`,
        [YICN_ID]
      );
      results.push(`Brian admin fix: ${r1.rowCount} profile(s) updated`);

      // Also fix brian.ycinteam@gmail.com profile at YICN if it exists
      const r1b = await pool.query(
        `UPDATE staff_profiles SET is_administrator = true, role = 'admin', updated_at = NOW()
         WHERE user_email = 'brian.ycinteam@gmail.com' AND company_id = $1 RETURNING id`,
        [YICN_ID]
      );
      if (r1b.rowCount > 0) results.push(`Brian (ycinteam) admin fix: ${r1b.rowCount} profile(s) updated`);

      // 2. Move leads stuck in wrong company to YICN
      const r2 = await pool.query(
        `UPDATE leads SET company_id = $1, updated_at = NOW()
         WHERE company_id = $2 RETURNING id, name`,
        [YICN_ID, WRONG_COMPANY_ID]
      );
      results.push(`Moved ${r2.rowCount} lead(s) to YICN: ${r2.rows.map(r => r.name).join(', ')}`);

      // 3. Move Virgil Stone (Kevin's other email) staff profile from wrong company to YICN
      const r3 = await pool.query(
        `UPDATE staff_profiles SET company_id = $1, updated_at = NOW()
         WHERE user_email = 'stonekevin866@gmail.com' AND company_id = $2 RETURNING id`,
        [YICN_ID, WRONG_COMPANY_ID]
      );
      if (r3.rowCount > 0) results.push(`Moved Virgil Stone profile to YICN: ${r3.rowCount} profile(s)`);

      // 3b. Set Virgil Stone as admin in YICN (upsert)
      const r3b = await pool.query(
        `UPDATE staff_profiles SET is_administrator = true, role = 'admin', is_active = true, updated_at = NOW()
         WHERE user_email = 'stonekevin866@gmail.com' AND company_id = $1 RETURNING id`,
        [YICN_ID]
      );
      results.push(`Virgil Stone admin fix: ${r3b.rowCount} profile(s) updated`);

      // 4. Mark Brian's wrong company as deleted
      const r4 = await pool.query(
        `UPDATE companies SET is_deleted = true, updated_at = NOW()
         WHERE id = $1 RETURNING id, name`,
        [WRONG_COMPANY_ID]
      );
      if (r4.rowCount > 0) results.push(`Marked wrong company deleted: ${r4.rows[0].name}`);

      // 5. Fix Victoria and Raffy - set is_administrator = true
      const r5 = await pool.query(
        `UPDATE staff_profiles SET is_administrator = true, role = 'admin', updated_at = NOW()
         WHERE user_email IN ('victoriafeliciapatindol@gmail.com', 'raffy.vpa28@gmail.com') 
         AND company_id = $1 RETURNING user_email`,
        [YICN_ID]
      );
      if (r5.rowCount > 0) {
        results.push(`Fixed admin access for: ${r5.rows.map(r => r.user_email).join(', ')}`);
      }

      // 6. Backfill first_name/last_name for Victoria and Raffy so they see "Welcome, Name!"
      const vrData = {
        'victoriafeliciapatindol@gmail.com': { first_name: 'Victoria', last_name: 'Patindol' },
        'raffy.vpa28@gmail.com': { first_name: 'Raffy', last_name: 'VA' },
      };
      for (const [email, info] of Object.entries(vrData)) {
        const r = await pool.query(
          `UPDATE users SET first_name = $1, last_name = $2, updated_at = NOW()
           WHERE LOWER(email) = $3 AND (first_name IS NULL OR first_name = '' OR last_name IS NULL OR last_name = '') RETURNING email`,
          [info.first_name, info.last_name, email]
        );
        if (r.rows.length > 0) results.push(`Updated name for ${email}: ${info.first_name} ${info.last_name}`);
      }

      // 7. Clear sessions so they can log back in with fresh permissions
      await pool.query(`DELETE FROM sessions`);
      results.push('Cleared all sessions');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, results }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ============================================================
  // TEMPORARY: One-time dev→prod migration endpoint
  // Remove after migration is complete
  // ============================================================
  if (pathname === '/api/admin/migrate-from-dev' && req.method === 'POST') {
    const MIGRATE_TOKEN = '4fe92ed70163264db2e7aa1b7a6d43461338a116d3713b0e128d96ed616f1406';
    const token = req.headers['x-migrate-token'] || '';
    if (token !== MIGRATE_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }
    try {
      const body = await new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => { raw += chunk; });
        req.on('end', () => resolve(raw));
        req.on('error', reject);
      });
      const payload = JSON.parse(body);
      const pool = prodDb.getPool();
      const counts = {};

      async function upsertRows(table, rows, conflictCol = 'id', skipCols = []) {
        if (!rows || !rows.length) { counts[table] = 0; return; }
        // Filter rows to remove skipCols and normalize columns from first row
        const filtered = rows.map(row =>
          Object.fromEntries(Object.entries(row).filter(([k]) => !skipCols.includes(k)))
        );
        const cols = Object.keys(filtered[0]);
        const BATCH = 200; // rows per INSERT statement (safe under PG 65535-param limit)
        let inserted = 0;
        for (let i = 0; i < filtered.length; i += BATCH) {
          const batch = filtered.slice(i, i + BATCH);
          const vals = [];
          const rowPhs = batch.map((row, ri) => {
            const ph = cols.map((_, ci) => `$${vals.length + ci + 1}`).join(', ');
            cols.forEach(c => vals.push(row[c] !== undefined ? row[c] : null));
            return `(${ph})`;
          });
          const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${rowPhs.join(', ')} ON CONFLICT (${conflictCol}) DO NOTHING`;
          try {
            const r = await pool.query(sql, vals);
            inserted += r.rowCount || 0;
          } catch (e) {
            console.warn(`[MIGRATE] batch warn ${table}:`, e.message.slice(0, 120));
          }
        }
        counts[table] = inserted;
      }

      // Insert in dependency order
      await upsertRows('companies', payload.companies);
      await upsertRows('users', payload.users);
      await upsertRows('staff_profiles', payload.staff_profiles);
      await upsertRows('inspector_profiles', payload.inspector_profiles);
      await upsertRows('customers', payload.customers);
      await upsertRows('leads', payload.leads);
      await upsertRows('projects', payload.projects);
      await upsertRows('estimates', payload.estimates);
      await upsertRows('invoices', payload.invoices);
      await upsertRows('payments', payload.payments);
      await upsertRows('communications', payload.communications);
      await upsertRows('tasks', payload.tasks);
      await upsertRows('calendar_events', payload.calendar_events);
      await upsertRows('generic_entities', payload.generic_entities, 'id, entity_type');
      await upsertRows('signing_sessions', payload.signing_sessions);
      await upsertRows('transaction_mapping_rules', payload.transaction_mapping_rules);
      await upsertRows('file_uploads', payload.file_uploads);

      console.log('[MIGRATE] Migration complete:', counts);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, counts }));
    } catch (e) {
      console.error('[MIGRATE] Error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  // ============================================================
  // END TEMPORARY MIGRATION ENDPOINT
  // ============================================================

  if (pathname === '/api/auth/user') {
    setCorsHeaders(res, req);
    const pool = prodDb.getPool();
    await prodAuth.handleGetUser(req, res, pool);
    return;
  }

  if (pathname === '/api/login') {
    setCorsHeaders(res);
    const pool = prodDb.getPool();
    await prodAuth.handleLogin(req, res, pool);
    return;
  }

  if (pathname === '/api/callback') {
    setCorsHeaders(res);
    const pool = prodDb.getPool();
    await prodAuth.handleCallback(req, res, pool);
    return;
  }

  if (pathname === '/api/logout') {
    setCorsHeaders(res);
    const pool = prodDb.getPool();
    await prodAuth.handleLogout(req, res, pool);
    return;
  }

  // ==========================================
  // SIGNING ENDPOINTS - All use local PostgreSQL
  // ==========================================
  if (pathname === '/api/public/get-signing-session') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const token = body.token || body?.body?.token || body?.data?.token;
      console.log('[Signing] getSigningSession - token:', token);
      if (!token) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Token required' }));
        return;
      }
      const pool = prodDb.getPool();
      const result = await pool.query('SELECT * FROM signing_sessions WHERE signing_token = $1', [token]);
      if (result.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid or expired signing link' }));
        return;
      }
      const s = result.rows[0];
      if (s.expires_at && new Date(s.expires_at) < new Date()) {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'This signing link has expired' }));
        return;
      }
      const responseSession = {
        id: s.id, base44_session_id: s.base44_session_id, company_id: s.company_id,
        template_id: s.template_id, template_name: s.template_name, contract_name: s.contract_name,
        customer_name: s.customer_name, customer_email: s.customer_email,
        delivery_method: s.delivery_method, rep_name: s.rep_name, rep_email: s.rep_email,
        rep_fields: s.rep_fields || {}, rep_signature_url: s.rep_signature_url,
        status: s.status, current_signer: s.current_signer, final_pdf_url: null,
      };
      const template = {
        id: s.template_id, template_name: s.template_name,
        fillable_fields: s.fillable_fields || [], original_file_url: s.original_file_url,
      };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, session: responseSession, template }));
    } catch (err) {
      console.error('[Signing] getSigningSession error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Server error: ' + err.message }));
    }
    return;
  }

  if (pathname === '/api/public/sign-contract') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const token = body.token || body?.body?.token || body?.data?.token;
      const fields = body.fields || body?.body?.fields || body?.data?.fields || {};
      const signature = body.signature || body?.body?.signature || body?.data?.signature;
      console.log('[Signing] signContract - token:', token, 'hasSignature:', !!signature);
      if (!token || !signature) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Token and signature required' }));
        return;
      }
      const pool = prodDb.getPool();
      const result = await pool.query('SELECT * FROM signing_sessions WHERE signing_token = $1', [token]);
      if (result.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid signing link' }));
        return;
      }
      const session = result.rows[0];
      if (session.status === 'completed') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Contract already signed' }));
        return;
      }
      if (session.expires_at && new Date(session.expires_at) < new Date()) {
        res.writeHead(410, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'This signing link has expired' }));
        return;
      }
      await pool.query(
        `UPDATE signing_sessions SET customer_fields=$1, customer_signature_data=$2, customer_signed_at=$3, status='completed', completed_at=$4, updated_at=$5 WHERE id=$6`,
        [JSON.stringify(fields), signature, new Date(), new Date(), new Date(), session.id]
      );
      console.log('[Signing] Session completed, id:', session.id);
      if (session.rep_email) {
        try {
          let fieldRows = '';
          if (fields && Object.keys(fields).length > 0) {
            for (const [key, value] of Object.entries(fields)) {
              fieldRows += `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${key}</td><td style="padding:8px;border-bottom:1px solid #eee;">${value}</td></tr>`;
            }
          } else {
            fieldRows = '<tr><td colspan="2" style="padding:8px;color:#999;">No additional fields filled.</td></tr>';
          }
          const notifHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="background:linear-gradient(135deg,#22c55e 0%,#16a34a 100%);padding:20px;text-align:center;border-radius:10px 10px 0 0;"><h1 style="color:white;margin:0;font-size:22px;">Contract Signed!</h1></div><div style="background:#f9fafb;padding:25px;border-radius:0 0 10px 10px;"><p><strong>Contract:</strong> ${session.contract_name || session.template_name || 'N/A'}</p><p><strong>Customer:</strong> ${session.customer_name}</p><p><strong>Signed at:</strong> ${new Date().toLocaleString()}</p><h3 style="margin-top:20px;border-bottom:2px solid #22c55e;padding-bottom:5px;">Customer Filled Information</h3><table style="width:100%;border-collapse:collapse;">${fieldRows}</table><p style="margin-top:20px;font-size:14px;color:#666;">The signed contract is available in your CRM under Contracts.</p></div></body></html>`;
          await sendEmail({
            to: session.rep_email,
            subject: `Contract Signed: ${session.contract_name || session.template_name} - ${session.customer_name}`,
            html: notifHtml
          });
          console.log('[Signing] Rep notification sent to:', session.rep_email);
        } catch (emailErr) {
          console.error('[Signing] Rep notification error:', emailErr.message);
        }
      }
      // Customer confirmation email
      if (session.customer_email && session.customer_email.includes('@')) {
        try {
          let custFieldRows = '';
          if (fields && Object.keys(fields).length > 0) {
            for (const [key, value] of Object.entries(fields)) {
              custFieldRows += `<tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:600;">${key}</td><td style="padding:8px;border-bottom:1px solid #eee;">${value}</td></tr>`;
            }
          }
          const custFieldsSection = custFieldRows ? `<h3 style="margin-top:20px;border-bottom:2px solid #667eea;padding-bottom:5px;">Your Submitted Information</h3><table style="width:100%;border-collapse:collapse;">${custFieldRows}</table>` : '';
          const custConfirmHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;"><div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:20px;text-align:center;border-radius:10px 10px 0 0;"><h1 style="color:white;margin:0;font-size:22px;">Contract Signed Successfully</h1></div><div style="background:#f9fafb;padding:25px;border-radius:0 0 10px 10px;"><p>Hi <strong>${session.customer_name}</strong>,</p><p>Thank you! We have received your signed contract.</p><div style="background:white;padding:16px;border-radius:8px;border-left:4px solid #667eea;margin:16px 0;"><p style="margin:4px 0;"><strong>Contract:</strong> ${session.contract_name || session.template_name || 'N/A'}</p><p style="margin:4px 0;"><strong>Signed at:</strong> ${new Date().toLocaleString()}</p></div>${custFieldsSection}<p style="margin-top:20px;font-size:14px;color:#666;">If you have any questions, please contact ${session.rep_name ? session.rep_name + ' at ' : ''}${session.rep_email || 'your contractor'}.</p></div></body></html>`;
          await sendEmail({
            to: session.customer_email,
            subject: `Contract Signed: ${session.contract_name || session.template_name || 'Your Contract'}`,
            html: custConfirmHtml
          });
          console.log('[Signing] Customer confirmation email sent to:', session.customer_email);
        } catch (custEmailErr) {
          console.error('[Signing] Customer email error:', custEmailErr.message);
        }
      }
      // Customer confirmation SMS (if delivery method is SMS)
      if (session.delivery_method === 'sms' && session.customer_phone) {
        const twilioSid = process.env.TWILIO_ACCOUNT_SID;
        const twilioToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
        if (twilioSid && twilioToken && twilioFrom) {
          try {
            const smsCustBody = `Hi ${session.customer_name}, thank you for signing "${session.contract_name || session.template_name || 'your contract'}". We have received your signed document.${session.rep_name ? ' — ' + session.rep_name : ''}`;
            const smsCustRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
                },
                body: new URLSearchParams({ From: twilioFrom, To: session.customer_phone, Body: smsCustBody }).toString(),
              }
            );
            console.log('[Signing] Customer SMS confirmation:', smsCustRes.ok ? 'sent' : 'failed', 'to:', session.customer_phone);
          } catch (smsCustErr) {
            console.error('[Signing] Customer SMS error:', smsCustErr.message);
          }
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ success: true, message: 'Contract signed successfully' }));
    } catch (err) {
      console.error('[Signing] signContract error:', err.message, err.stack);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Server error: ' + err.message }));
    }
    return;
  }

  // GET /api/contracts/session-fields?base44_id=<id>  — returns customer-filled data for a completed session
  if (pathname === '/api/contracts/session-fields') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    try {
      const urlObj = new URL(req.url, 'http://localhost');
      const base44Id = urlObj.searchParams.get('base44_id');
      if (!base44Id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'base44_id required' }));
        return;
      }
      const pool = prodDb.getPool();
      const result = await pool.query(
        `SELECT customer_fields, customer_signed_at, customer_signature_data, rep_fields, rep_signed_at FROM signing_sessions WHERE base44_session_id = $1 LIMIT 1`,
        [base44Id]
      );
      if (result.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Session not found' }));
        return;
      }
      const row = result.rows[0];
      let customerFields = row.customer_fields;
      if (typeof customerFields === 'string') {
        try { customerFields = JSON.parse(customerFields); } catch (_) { customerFields = {}; }
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        success: true,
        customer_fields: customerFields || {},
        customer_signed_at: row.customer_signed_at,
        customer_signature_data: row.customer_signature_data,
        rep_fields: row.rep_fields || {},
        rep_signed_at: row.rep_signed_at,
      }));
    } catch (err) {
      console.error('[Signing] session-fields error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Server error: ' + err.message }));
    }
    return;
  }

  if (pathname === '/api/contracts/send-signing-link') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
    try {
      const body = JSON.parse(await readBody(req));
      const reqHost = req.headers?.host || '';
      const reqProto = req.headers?.['x-forwarded-proto'] || 'https';
      const replitBaseUrl = (reqHost ? `${reqProto}://${reqHost}` : (process.env.VITE_REPLIT_APP_URL || `https://${getPublicHost(req.headers)}`)).replace(/\/$/, '');
      const sessionId = body.sessionId || body.session_id;
      const sessionData = body.sessionData;

      console.log('[Signing] send-signing-link, sessionId:', sessionId, 'hasSessionData:', !!sessionData);

      if (!sessionId && !sessionData) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'sessionId or sessionData required' }));
        return;
      }

      const pool = prodDb.getPool();
      const { randomUUID } = require('crypto');
      const signingToken = randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      let session;

      if (sessionData) {
        console.log('[Signing] Inserting new local signing session...');
        const insertResult = await pool.query(
          `INSERT INTO signing_sessions 
            (base44_session_id, company_id, template_id, template_name, contract_name,
             customer_name, customer_email, customer_phone, delivery_method,
             rep_name, rep_email, rep_fields, rep_signature_url, rep_signed_at,
             fillable_fields, original_file_url, signing_token, status, current_signer, expires_at, sent_to_customer_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
           RETURNING *`,
          [
            sessionData.base44_session_id || sessionId,
            sessionData.company_id,
            sessionData.template_id,
            sessionData.template_name,
            sessionData.contract_name,
            sessionData.customer_name,
            sessionData.customer_email,
            sessionData.customer_phone,
            sessionData.delivery_method || 'email',
            sessionData.rep_name,
            sessionData.rep_email,
            JSON.stringify(sessionData.rep_fields || {}),
            sessionData.rep_signature_url,
            sessionData.rep_signed_at ? new Date(sessionData.rep_signed_at) : null,
            JSON.stringify(sessionData.fillable_fields || []),
            sessionData.original_file_url,
            signingToken,
            'awaiting_customer',
            'customer',
            expiresAt,
            new Date(),
          ]
        );
        session = insertResult.rows[0];
        console.log('[Signing] Local session created, id:', session.id);
      } else {
        const existing = await pool.query('SELECT * FROM signing_sessions WHERE base44_session_id = $1', [sessionId]);
        if (existing.rows.length > 0) {
          await pool.query(
            'UPDATE signing_sessions SET signing_token=$1, status=$2, current_signer=$3, expires_at=$4, sent_to_customer_at=$5, updated_at=$6 WHERE base44_session_id=$7',
            [signingToken, 'awaiting_customer', 'customer', expiresAt, new Date(), new Date(), sessionId]
          );
          session = (await pool.query('SELECT * FROM signing_sessions WHERE base44_session_id = $1', [sessionId])).rows[0];
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Session not found. Please provide sessionData.' }));
          return;
        }
      }

      const signingLink = `${replitBaseUrl}/sign-contract-customer?token=${signingToken}`;
      console.log('[Signing] Signing link:', signingLink);

      const customerEmail = session.customer_email || '';
      const customerName = session.customer_name || 'Customer';
      const contractName = session.contract_name || '';
      const templateName = session.template_name || '';
      const repName = session.rep_name || '';
      const deliveryMethod = session.delivery_method || 'email';
      const expiresDate = expiresAt.toLocaleDateString();

      let emailSent = false;
      let emailError = null;
      let smsSent = false;
      let smsError = null;

      if (deliveryMethod === 'sms' && session.customer_phone) {
        const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
        const twilioToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioFrom  = process.env.TWILIO_PHONE_NUMBER;
        if (!twilioSid || !twilioToken || !twilioFrom) {
          smsError = 'Twilio not configured';
          console.error('[Signing]', smsError);
        } else {
          const smsBody = `Hi ${customerName},${repName ? ` ${repName} has` : ' You have been'} sent you a contract to review and sign.\n\n${signingLink}\n\nExpires: ${expiresDate}`;
          try {
            const smsRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Authorization': 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'),
                },
                body: new URLSearchParams({ From: twilioFrom, To: session.customer_phone, Body: smsBody }).toString(),
              }
            );
            const smsResult = await smsRes.json();
            console.log('[Signing] SMS result:', smsRes.ok ? 'SUCCESS' : 'FAILED', smsResult.sid || smsResult.message);
            smsSent = smsRes.ok;
            if (!smsRes.ok) smsError = smsResult.message || 'Twilio API error';
          } catch (smsErr) {
            console.error('[Signing] SMS error:', smsErr.message);
            smsError = smsErr.message;
          }
        }
      }

      if (deliveryMethod === 'email' && customerEmail && customerEmail.includes('@')) {
        console.log('[Signing] Sending signing link email to:', customerEmail);
        const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;"><div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;"><h2 style="color: white; margin: 0 0 5px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 2px;">Contract Signing</h2><h1 style="color: white; margin: 0; font-size: 24px;">Contract Ready for Your Signature</h1></div><div style="background: #f9fafb; padding: 30px; border-radius: 0 0 10px 10px;"><p style="font-size: 16px;">Hello <strong>${customerName}</strong>,</p><p style="font-size: 16px;">${repName ? repName + ' has' : 'You have been'} sent you a contract for electronic signature.</p>${templateName || contractName ? `<div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">${templateName ? `<p style="margin: 5px 0;"><strong>Contract:</strong> ${templateName}</p>` : ''}${contractName ? `<p style="margin: 5px 0;"><strong>Job:</strong> ${contractName}</p>` : ''}<p style="margin: 5px 0;"><strong>Expires:</strong> ${expiresDate}</p></div>` : ''}<p style="text-align: center; margin: 30px 0;"><a href="${signingLink}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-size: 18px; font-weight: bold;">Review & Sign Contract</a></p><p style="font-size: 14px; color: #666;">This link expires on <strong>${expiresDate}</strong>.</p></div></body></html>`;
        try {
          await sendEmail({
            to: customerEmail,
            subject: `Contract Ready: ${templateName || contractName || 'Review & Sign'}`,
            html: emailHtml
          });
          console.log('[Signing] Signing link email sent to:', customerEmail);
          emailSent = true;
        } catch (emailErr) {
          console.error('[Signing] Email error:', emailErr.message);
          emailError = emailErr.message;
        }
      }

      const result = {
        success: true,
        signing_link: signingLink,
        local_session_id: session.id,
        expires_at: expiresAt.toISOString(),
        delivery_method: deliveryMethod,
        email_sent: emailSent,
        sms_sent: smsSent,
        message: deliveryMethod === 'sms'
          ? (smsSent ? `SMS sent to ${session.customer_phone}` : `SMS failed: ${smsError || 'unknown'}`)
          : emailSent ? `Email sent to ${customerEmail}` : `Email not sent: ${emailError || 'unknown'}`,
      };
      if (emailError) result.email_warning = emailError;
      if (smsError) result.sms_warning = smsError;

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[Signing] sendSigningLink error:', err.message, err.stack);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
    return;
  }

  if (pathname === '/api/whatsapp-webhook') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const from = params.get('From') || '';
      const to = params.get('To') || '';
      const messageBody = params.get('Body') || '';
      const messageSid = params.get('MessageSid') || '';
      const numMedia = parseInt(params.get('NumMedia') || '0');
      const isWhatsApp = from.startsWith('whatsapp:') || to.startsWith('whatsapp:');
      const cleanFrom = from.replace('whatsapp:', '');
      const cleanTo = to.replace('whatsapp:', '');
      console.log(`[Sarah] ${isWhatsApp ? 'WhatsApp' : 'SMS'} webhook: from=${cleanFrom}, body="${messageBody.substring(0, 100)}"`);
      const normalizedTo = cleanTo.replace(/[^\d]/g, '').replace(/^(\d{10})$/, '+1$1').replace(/^1(\d{10})$/, '+1$1').replace(/^(\d{11})$/, '+$1');
      const e164To = normalizedTo.startsWith('+') ? normalizedTo : `+${normalizedTo}`;

      const pool = prodDb.getPool();
      let resolvedCompanyId = null;
      try {
        const localLookup = await pool.query(
          `SELECT company_id FROM call_routing_cache WHERE phone_number = $1 LIMIT 1`, [e164To]
        );
        if (localLookup.rows[0]) {
          resolvedCompanyId = localLookup.rows[0].company_id;
          console.log(`[Sarah] SMS local routing hit: ${e164To} -> ${resolvedCompanyId}`);
        }
        if (!resolvedCompanyId) {
          const twilioLookup = await pool.query(
            `SELECT g.company_id FROM generic_entities g
             JOIN companies c ON c.id = g.company_id OR c.base44_id = g.company_id
             WHERE g.entity_type = 'TwilioSettings'
               AND (g.data->>'main_phone_number' = $1 OR g.data->>'main_phone_number' = $2
                 OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.data->'available_numbers') elem WHERE elem->>'phone_number' = $1 OR elem->>'phone_number' = $2))
             LIMIT 1`,
            [e164To, e164To.replace(/^\+1/, '')]
          );
          if (twilioLookup.rows[0]) {
            resolvedCompanyId = twilioLookup.rows[0].company_id;
            console.log(`[Sarah] SMS TwilioSettings hit: ${e164To} -> ${resolvedCompanyId}`);
          }
        }
        if (!resolvedCompanyId) {
          const staffLookup = await pool.query(
            `SELECT company_id FROM staff_profiles WHERE twilio_number = $1 OR twilio_number = $2 LIMIT 1`,
            [e164To, e164To.replace(/^\+1/, '')]
          );
          if (staffLookup.rows[0]) {
            resolvedCompanyId = staffLookup.rows[0].company_id;
            console.log(`[Sarah] SMS staff_profiles hit: ${e164To} -> ${resolvedCompanyId}`);
          }
        }
      } catch (e) {}
      if (!resolvedCompanyId && BASE44_API_URL) {
        try {
          const lookup = await callBase44API('lookupByPhone', null, { phone_number: e164To });
          if (lookup?.success && lookup.company_id) resolvedCompanyId = lookup.company_id;
        } catch (e) {}
      }
      if (!resolvedCompanyId) { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); return; }
      try {
        const msgSettings = await callBase44API('getMessagingSettings', resolvedCompanyId);
        if (isWhatsApp && msgSettings?.whatsapp_enabled !== true) { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); return; }
        const commType = isWhatsApp ? 'whatsapp' : 'sms';
        const inboundId = `comm_inb_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
        pool.query(
          `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, message, body, status, data, created_at, updated_at)
           VALUES ($1,$2,$3,$3,'inbound',$4,$5,$5,'received',$6,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
          [inboundId, resolvedCompanyId, commType, cleanFrom, messageBody, JSON.stringify({ message_sid: messageSid, to: cleanTo })]
        ).catch(e => console.warn('[Sarah] Failed to save inbound SMS to local DB:', e.message));
        const aiResponse = await callBase44API('handleIncomingMessage', resolvedCompanyId, { from: cleanFrom, to: cleanTo, body: messageBody, message_sid: messageSid, channel: isWhatsApp ? 'whatsapp' : 'sms', num_media: numMedia });
        if (aiResponse?.reply) {
          const replyId = `comm_rep_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
          pool.query(
            `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_phone, message, body, status, data, created_at, updated_at)
             VALUES ($1,$2,$3,$3,'outbound',$4,$5,$5,'sent',$6,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
            [replyId, resolvedCompanyId, commType, cleanFrom, aiResponse.reply, JSON.stringify({ message_sid: messageSid, ai_reply: true })]
          ).catch(() => {});
          res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${aiResponse.reply}</Message></Response>`);
        } else { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); }
      } catch (e) { console.error('[Sarah] WhatsApp/SMS error:', e.message); res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); }
    } catch (e) { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>'); }
    return;
  }

  if (pathname === '/api/sarah-missed-call') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const body = await readBody(req);
      const params = new URLSearchParams(body);
      const callStatus = params.get('CallStatus') || '';
      const callerPhone = params.get('From') || params.get('Caller') || '';
      const calledNumber = params.get('To') || params.get('Called') || '';
      const callSid = params.get('CallSid') || '';
      if (callStatus !== 'no-answer' && callStatus !== 'busy' && callStatus !== 'failed') { res.writeHead(200); res.end('OK'); return; }
      console.log(`[Sarah] Missed call: from=${callerPhone}, status=${callStatus}`);
      const pool = prodDb.getPool();
      let resolvedCompanyId = null;
      try {
        const localLookup = await pool.query(
          `SELECT company_id FROM call_routing_cache WHERE phone_number = $1 LIMIT 1`,
          [calledNumber]
        );
        if (localLookup.rows[0]) resolvedCompanyId = localLookup.rows[0].company_id;
        if (!resolvedCompanyId) {
          const twilioLookup = await pool.query(
            `SELECT g.company_id FROM generic_entities g
             JOIN companies c ON c.id = g.company_id OR c.base44_id = g.company_id
             WHERE g.entity_type = 'TwilioSettings'
               AND (g.data->>'main_phone_number' = $1 OR g.data->>'main_phone_number' = $2
                 OR EXISTS (SELECT 1 FROM jsonb_array_elements(g.data->'available_numbers') elem WHERE elem->>'phone_number' = $1 OR elem->>'phone_number' = $2))
             LIMIT 1`,
            [calledNumber, calledNumber.replace(/^\+1/, '')]
          );
          if (twilioLookup.rows[0]) resolvedCompanyId = twilioLookup.rows[0].company_id;
        }
        if (!resolvedCompanyId) {
          const staffLookup = await pool.query(
            `SELECT company_id FROM staff_profiles WHERE twilio_number = $1 OR twilio_number = $2 LIMIT 1`,
            [calledNumber, calledNumber.replace(/^\+1/, '')]
          );
          if (staffLookup.rows[0]) resolvedCompanyId = staffLookup.rows[0].company_id;
        }
      } catch (e) {}
      if (!resolvedCompanyId && BASE44_API_URL) {
        try { const lookup = await callBase44API('lookupByPhone', null, { phone_number: calledNumber }); if (lookup?.success && lookup.company_id) resolvedCompanyId = lookup.company_id; } catch (e) {}
      }
      if (!resolvedCompanyId) { res.writeHead(200); res.end('OK'); return; }

      // Always notify rep + admins about the missed call (bell + email + SMS to cell)
      try {
        const pool2 = prodDb.getPool();
        const { rows: mcAdminRows } = await pool2.query(
          `SELECT user_email, full_name, cell_phone FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
          [resolvedCompanyId]
        );
        const { rows: mcRepRows } = await pool2.query(
          `SELECT user_email, full_name, cell_phone FROM staff_profiles WHERE company_id = $1 AND (twilio_number = $2 OR twilio_number = $3) LIMIT 1`,
          [resolvedCompanyId, calledNumber, calledNumber.replace(/^\+1/, '')]
        );
        const { rows: twMcRows } = await pool2.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
          [resolvedCompanyId]
        );
        const twMc = twMcRows[0]?.data || {};
        const twMcSid = twMc.account_sid || process.env.TWILIO_ACCOUNT_SID;
        const twMcToken = twMc.auth_token || process.env.TWILIO_AUTH_TOKEN;
        const twMcFrom = twMc.main_phone_number || process.env.TWILIO_PHONE_NUMBER;

        const mcRep = mcRepRows[0] || null;
        const mcSeenEmails = new Set();
        const mcTargets = [];
        for (const r of [...mcRepRows, ...mcAdminRows]) {
          if (r.user_email && !mcSeenEmails.has(r.user_email)) {
            mcSeenEmails.add(r.user_email);
            mcTargets.push(r);
          }
        }

        const mcTitle = `📵 Missed call from ${callerPhone}`;
        const mcMessage = `A call from ${callerPhone} went unanswered${mcRep ? ' on ' + mcRep.full_name + "'s line" : ''} (${calledNumber}). Status: ${callStatus}.`;

        for (const target of mcTargets) {
          // 1. Bell notification
          const nId = `notif_missed_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          await pool2.query(
            `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
            [nId, resolvedCompanyId, JSON.stringify({
              id: nId, type: 'missed_call', title: mcTitle, message: mcMessage,
              user_email: target.user_email, is_read: false,
              caller_phone: callerPhone, called_number: calledNumber, call_status: callStatus,
              created_at: new Date().toISOString(),
            })]
          );
          // 2. Email
          try {
            await sendEmail({ to: target.user_email, subject: mcTitle, html: `<h2 style="color:#dc2626">${mcTitle}</h2><p style="font-family:sans-serif;font-size:14px">${mcMessage}</p><p style="font-family:sans-serif;font-size:12px;color:#9ca3af;margin-top:24px">CompanySync — YICN Roofing</p>` });
          } catch (emailErr) { console.warn('[Sarah] Missed call email error:', emailErr.message); }
          // 3. SMS to personal cell
          if (target.cell_phone && twMcSid && twMcToken && twMcFrom) {
            try {
              const authStr = Buffer.from(`${twMcSid}:${twMcToken}`).toString('base64');
              await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twMcSid}/Messages.json`, {
                method: 'POST',
                headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ To: target.cell_phone, From: twMcFrom, Body: `📵 Missed call from ${callerPhone} on ${calledNumber}. Status: ${callStatus}.` }).toString()
              });
            } catch (smsErr) { console.warn('[Sarah] Missed call cell SMS error:', smsErr.message); }
          }
        }
        console.log(`[Sarah] Missed call: notified ${mcTargets.length} user(s) (bell+email+SMS)`);
      } catch (mcErr) { console.warn('[Sarah] Missed call notification error:', mcErr.message); }

      try {
        const msgSettings = await callBase44API('getMessagingSettings', resolvedCompanyId);
        if (msgSettings?.missed_call_followup_enabled !== true) { console.log(`[Sarah] Missed call follow-up disabled`); res.writeHead(200); res.end('OK'); return; }
        await callBase44API('sendMissedCallFollowup', resolvedCompanyId, { caller_phone: callerPhone, called_number: calledNumber, call_sid: callSid, call_status: callStatus, channel: msgSettings.missed_call_channel || 'sms' });
        console.log(`[Sarah] Missed call follow-up sent to ${callerPhone}`);
      } catch (e) { console.error('[Sarah] Missed call follow-up error:', e.message); }
      res.writeHead(200); res.end('OK');
    } catch (e) { res.writeHead(200); res.end('OK'); }
    return;
  }

  if (pathname === '/api/messaging-settings') {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const defaults = { whatsapp_enabled: false, missed_call_followup_enabled: false, appointment_reminders_enabled: false, missed_call_channel: 'sms', missed_call_template: '', appointment_reminder_template: '', dedup_window_hours: 24 };
    if (req.method === 'GET') {
      const companyId = url.searchParams.get('companyId') || '';
      if (!companyId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Missing companyId' })); return; }
      if (!BASE44_API_URL) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(defaults)); return; }
      try {
        const settings = await callBase44API('getMessagingSettings', companyId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(settings || defaults));
      } catch (e) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(defaults)); }
    } else if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        const { companyId, ...settings } = body;
        if (!companyId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'companyId required' })); return; }
        if (!BASE44_API_URL) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: true, ...settings })); return; }
        const result = await callBase44API('saveMessagingSettings', companyId, settings);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, ...result }));
      } catch (e) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
    } else { res.writeHead(405); res.end(); }
    return;
  }

  if (pathname === '/api/integrations/upload' && req.method === 'POST') {
    await prodIntegrations.handleUpload(req, res);
    return;
  }

  if (pathname === '/api/integrations/invoke-llm' && req.method === 'POST') {
    await prodIntegrations.handleInvokeLLM(req, res);
    return;
  }

  if (pathname === '/api/integrations/send-email' && req.method === 'POST') {
    await prodIntegrations.handleSendEmail(req, res);
    return;
  }

  // ============================================================
  // DIRECT BID MAILER AUTOMATION
  // POST /api/hooks/bid-mailer
  // Pipeline: RentCast → Estimator → Marcus AI Letter → PostGrid
  // ============================================================
  if (pathname === '/api/hooks/bid-mailer' && req.method === 'POST') {
    setCorsHeaders(res, req);
    try {
      const sessionUser = req.session?.passport?.user || req.session?.user;
      const userEmail = sessionUser?.claims?.email || sessionUser?.email;
      if (!userEmail) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }

      // Source verification: if MAILER_WEBHOOK_SECRET is configured, the request
      // must include a matching X-Mailer-Secret header (HMAC-style shared secret).
      const mailerSecret = process.env.MAILER_WEBHOOK_SECRET || '';
      if (mailerSecret) {
        const providedSecret = req.headers['x-mailer-secret'] || '';
        if (!providedSecret || providedSecret !== mailerSecret) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'forbidden', message: 'Invalid or missing X-Mailer-Secret header.' }));
          return;
        }
      }

      const pool = prodDb.getPool();

      const { rows: userCompanyRows } = await pool.query(
        `SELECT company_id FROM staff_profiles WHERE user_email = $1 AND is_active = true LIMIT 1`,
        [userEmail]
      );
      let cid = userCompanyRows[0]?.company_id || '';
      if (!cid) {
        const { rows: ownerRows } = await pool.query(`SELECT id FROM companies WHERE created_by = $1 LIMIT 1`, [userEmail]);
        cid = ownerRows[0]?.id || '';
      }
      if (!cid) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No company found for your account' }));
        return;
      }

      const body = JSON.parse(await readBody(req));
      const { lead_id, address, field_photo_url, rep_name } = body;
      if (!lead_id || !address) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'lead_id and address are required' }));
        return;
      }

      const { rows: leadOwnerCheck } = await pool.query(`SELECT id FROM leads WHERE id = $1 AND company_id = $2 LIMIT 1`, [lead_id, cid]);
      if (leadOwnerCheck.length === 0) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Lead not found or does not belong to your company' }));
        return;
      }
      // Load per-company mailer settings (dry_run default true, daily_limit default 25)
      let DRY_RUN = true;
      let DAILY_MAILER_LIMIT = 25;
      try {
        const { rows: settingsRows } = await pool.query(
          `SELECT data FROM generic_entities WHERE entity_type = 'MailerSettings' AND company_id = $1 ORDER BY created_date DESC LIMIT 1`,
          [cid]
        );
        if (settingsRows.length > 0) {
          const s = settingsRows[0].data;
          if (typeof s.dry_run === 'boolean') DRY_RUN = s.dry_run;
          if (typeof s.daily_limit === 'number' && s.daily_limit > 0) DAILY_MAILER_LIMIT = s.daily_limit;
        }
      } catch (e) {
        console.warn('[BidMailer] Could not load MailerSettings:', e.message);
      }

      // 24h idempotency check — tenant-scoped by company_id
      const { rows: dedupRows } = await pool.query(
        `SELECT id FROM generic_entities WHERE entity_type = 'BidMailer' AND data->>'lead_id' = $1 AND company_id = $2 AND created_date > NOW() - INTERVAL '24 hours' LIMIT 1`,
        [lead_id, cid]
      );
      if (dedupRows.length > 0) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'duplicate', message: 'A bid mailer was already sent for this lead in the last 24 hours.' }));
        return;
      }

      // Per-company daily cap check
      const { rows: capRows } = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM generic_entities WHERE entity_type = 'BidMailer' AND company_id = $1 AND created_date > NOW() - INTERVAL '24 hours'`,
        [cid]
      );
      if ((capRows[0]?.cnt || 0) >= DAILY_MAILER_LIMIT) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'daily_limit', message: `Daily mailer limit of ${DAILY_MAILER_LIMIT} reached for your company. Try again tomorrow.` }));
        return;
      }

      let ownerName = `Homeowner at ${address.split(',')[0] || address}`;
      const RENTCAST_API_KEY = process.env.RENTCAST_API_KEY || '';
      if (RENTCAST_API_KEY) {
        try {
          if (!global._rentcastCache) global._rentcastCache = new Map();
          const cacheKey = address.trim().toLowerCase();
          if (global._rentcastCache.has(cacheKey)) {
            ownerName = global._rentcastCache.get(cacheKey);
            console.log(`[BidMailer] RentCast cache hit: ${ownerName}`);
          } else {
            const rcResp = await fetch(`https://api.rentcast.io/v1/properties?address=${encodeURIComponent(address)}&limit=1`, {
              headers: { 'X-Api-Key': RENTCAST_API_KEY, 'Accept': 'application/json' }
            });
            if (rcResp.ok) {
              const rcData = await rcResp.json();
              const prop = Array.isArray(rcData) ? rcData[0] : rcData;
              const fetchedName = prop?.ownerName || prop?.owner?.name || prop?.owner_name || '';
              if (fetchedName) {
                ownerName = fetchedName;
                global._rentcastCache.set(cacheKey, ownerName);
                console.log(`[BidMailer] RentCast owner: ${ownerName}`);
              }
            } else {
              console.warn(`[BidMailer] RentCast API returned ${rcResp.status}`);
            }
          }
        } catch (rcErr) {
          console.warn('[BidMailer] RentCast lookup failed:', rcErr.message);
        }
      }

      // Internal estimator: if INTERNAL_ESTIMATOR_URL is configured, call it exclusively.
      // If it fails or returns $0, abort with an error note — no fallback.
      // If not configured, use the estimates table (the CRM's own estimator).
      // In both cases, $0 or failure aborts the pipeline.
      let totalBid = 0;
      let estimatorFailed = false;
      const ESTIMATOR_URL = process.env.INTERNAL_ESTIMATOR_URL || '';
      if (ESTIMATOR_URL) {
        try {
          const estResp = await fetch(ESTIMATOR_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address, field_photo_url })
          });
          if (estResp.ok) {
            const estData = await estResp.json();
            totalBid = parseFloat(estData.total_bid || estData.total || estData.amount || estData.price || 0) || 0;
          } else {
            estimatorFailed = true;
            console.warn('[BidMailer] Estimator API returned non-OK status:', estResp.status);
          }
        } catch (estErr) {
          estimatorFailed = true;
          console.warn('[BidMailer] Estimator API failed:', estErr.message);
        }
      } else {
        // Use estimates table as the internal estimator
        try {
          const { rows: estRows } = await pool.query(
            `SELECT total_amount FROM estimates WHERE lead_id = $1 AND total_amount > 0 ORDER BY created_at DESC LIMIT 1`,
            [lead_id]
          );
          if (estRows.length > 0) {
            totalBid = parseFloat(estRows[0].total_amount) || 0;
          }
        } catch (e) {
          estimatorFailed = true;
          console.warn('[BidMailer] Estimates table query failed:', e.message);
        }
      }

      if (!totalBid || estimatorFailed) {
        const errMsg = estimatorFailed
          ? 'Estimator call failed. Check estimator configuration and try again.'
          : 'No estimate found for this lead. Create a roof estimate before sending a bid mailer.';
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Note', $2, $3, NOW(), NOW())`,
          [`note_${Date.now()}_${Math.random().toString(36).substr(2,6)}`, cid, JSON.stringify({
            lead_id, title: '[AI Automation - ERROR]', content: `[AI Automation - ERROR]: Bid Mailer aborted. ${errMsg}`, type: 'system'
          })]
        );
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_estimate', message: errMsg }));
        return;
      }

      const formattedBid = totalBid.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

      let letterBody = '';
      const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
      if (geminiKey) {
        try {
          const marcusPrompt = `You are Marcus, a high-converting direct response copywriter specializing in roofing. Write a 3-paragraph personalized letter for ${ownerName}.

Problem: Their roof at ${address} is showing signs of age or storm wear (reference the field photo taken by our rep, ${rep_name || 'our team'}).
Agitation: Waiting leads to leaks, interior damage, and higher insurance premiums. Every day without action increases the cost.
Solution: We've already run their measurements through our AI estimator. Their specific price is $${formattedBid}. This is a locked-in price — no surprises, no hidden fees.
CTA: Scan the QR code included in this letter to lock in this price and schedule a free inspection.

Rules:
- Write in first person plural ("we", "our team")
- Be conversational, empathetic, and urgent without being pushy
- Reference ${rep_name || 'our team'} by name if provided
- Do NOT include a subject line or greeting — just the 3 paragraphs
- Keep total length under 250 words`;

          const geminiResp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: marcusPrompt }] }],
                generationConfig: { temperature: 0.7 }
              })
            }
          );
          const geminiData = await geminiResp.json();
          letterBody = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
          console.log(`[BidMailer] Marcus letter generated (${letterBody.length} chars)`);
        } catch (aiErr) {
          console.error('[BidMailer] Gemini letter generation failed:', aiErr.message);
        }
      }

      if (!letterBody) {
        letterBody = `Dear ${ownerName},\n\nWe recently inspected the properties in your area and noticed your roof at ${address} may need attention. Storm damage and natural wear can lead to leaks and costly interior damage if not addressed promptly.\n\nOur AI-powered measurement system has already calculated your specific roof replacement cost: $${formattedBid}. This is a locked-in price with no hidden fees or surprises.\n\nScan the QR code below to lock in this price and schedule your free inspection. Don't wait — every day increases the risk of further damage.\n\nSincerely,\n${rep_name || 'Your Local Roofing Team'}`;
      }

      const QR_CODE_URL = 'https://getcompanysync.com/attached_assets/yicnroofing.com_qr_code_1774781451832.png';

      // Build the letter HTML artifact — used in both dry-run (logged/stored) and live (sent to PostGrid)
      const letterHtml = `<html><body style="font-family:Georgia,serif;font-size:14px;line-height:1.6;padding:40px;max-width:600px;margin:0 auto;">
        <div style="text-align:center;margin-bottom:30px;"><h2 style="color:#1a365d;">YICN Roofing</h2></div>
        <p>Dear ${ownerName},</p>
        ${letterBody.split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('')}
        ${field_photo_url ? `<div style="text-align:center;margin:20px 0;"><img src="${field_photo_url}" style="max-width:400px;border-radius:8px;" alt="Property Photo" /></div>` : ''}
        <div style="text-align:center;margin:30px 0;padding:20px;background:#f7fafc;border-radius:8px;">
          <p style="font-weight:bold;color:#1a365d;">Your Locked-In Price: $${formattedBid}</p>
          <img src="${QR_CODE_URL}" style="width:120px;height:120px;margin:10px auto;display:block;" alt="Scan to schedule inspection" />
          <p style="font-size:12px;color:#666;">Scan the QR code to schedule your free inspection</p>
        </div>
        <p style="font-size:12px;color:#999;margin-top:40px;">YICN Roofing &bull; Cleveland, OH &bull; yicnroofing.com</p>
      </body></html>`;

      let postgridResult = null;
      let postgridTrackingId = null;
      let postgridFailed = false;
      const POSTGRID_API_KEY = process.env.POSTGRID_API_KEY || '';
      if (DRY_RUN) {
        // Dry-run: generate letter PDF preview and log it — do NOT charge PostGrid
        postgridTrackingId = `dry_run_${Date.now()}`;
        console.log(`[BidMailer] DRY RUN — letter PDF generated and logged (NOT sent to PostGrid).`);
        console.log(`[BidMailer] DRY RUN letter preview:\n${letterBody.substring(0, 500)}...`);
      } else if (POSTGRID_API_KEY) {
        try {
          const pgResp = await fetch('https://api.postgrid.com/print-mail/v1/letters', {
            method: 'POST',
            headers: {
              'x-api-key': POSTGRID_API_KEY,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              to: { addressLine1: address.split(',')[0]?.trim() || address, city: address.split(',')[1]?.trim() || '', provinceOrState: address.split(',')[2]?.trim() || '', postalOrZip: address.split(',')[3]?.trim() || '', countryCode: 'US' },
              from: { name: rep_name || 'YICN Roofing', addressLine1: '1234 Main St', city: 'Cleveland', provinceOrState: 'OH', postalOrZip: '44101', countryCode: 'US' },
              html: letterHtml,
              description: `Bid mailer for ${ownerName} at ${address}`
            })
          });
          postgridResult = await pgResp.json();
          postgridTrackingId = postgridResult.id || postgridResult.data?.id || null;
          if (!pgResp.ok || !postgridTrackingId) {
            postgridFailed = true;
            console.error(`[BidMailer] PostGrid returned ${pgResp.status}:`, JSON.stringify(postgridResult));
          } else {
            console.log(`[BidMailer] PostGrid letter sent: ${postgridTrackingId}`);
          }
        } catch (pgErr) {
          postgridFailed = true;
          console.error('[BidMailer] PostGrid send failed:', pgErr.message);
        }
      } else {
        // Live mode requested but no PostGrid key — this is an error, not a silent dry-run
        postgridFailed = true;
        console.error('[BidMailer] POSTGRID_API_KEY not configured but live mode requested');
      }

      if (!DRY_RUN && postgridFailed) {
        const errNoteId = `note_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Note', $2, $3, NOW(), NOW())`,
          [errNoteId, cid, JSON.stringify({ lead_id, title: '[AI Automation Error]', content: `Bid Mailer for ${ownerName} failed to send via PostGrid. Price: $${formattedBid}. Please retry.`, type: 'system' })]
        );
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'postgrid_failed', message: 'Letter was generated but PostGrid delivery failed. An error note was added to the lead.' }));
        return;
      }

      await logUsageEvent(cid, 'marcus', 1);
      await billAIUsage(cid, 1);

      const mailerId = `bm_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
      const mailerStatus = DRY_RUN ? 'dry_run' : (postgridFailed ? 'failed' : 'sent');
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'BidMailer', $2, $3, NOW(), NOW())`,
        [mailerId, cid, JSON.stringify({
          lead_id, address, owner_name: ownerName, total_bid: totalBid,
          rep_name: rep_name || '', field_photo_url,
          postgrid_tracking_id: postgridTrackingId || null,
          letter_body: letterBody, letter_html: letterHtml, dry_run: DRY_RUN, status: mailerStatus
        })]
      );

      const noteId = `note_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
      const noteContent = DRY_RUN
        ? `[AI Automation - DRY RUN]: Bid Mailer letter PDF generated and logged for ${ownerName}. Price: $${formattedBid}. Letter HTML stored in BidMailer record (not sent to PostGrid). Tracking ref: ${postgridTrackingId}`
        : `[AI Automation]: Personalized Bid Mailer sent to ${ownerName} for $${formattedBid}. PostGrid ID: ${postgridTrackingId}`;
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Note', $2, $3, NOW(), NOW())`,
        [noteId, cid, JSON.stringify({ lead_id, title: DRY_RUN ? '[AI Automation - DRY RUN]' : '[AI Automation]', content: noteContent, type: 'system' })]
      );

      const commId = `comm_bm_${Date.now()}_${Math.random().toString(36).substr(2,6)}`;
      try {
        const { rows: leadInfo } = await pool.query(`SELECT name, phone, email FROM leads WHERE id = $1 LIMIT 1`, [lead_id]);
        const ln = leadInfo[0] || {};
        await pool.query(
          `INSERT INTO communications (id, company_id, type, communication_type, direction, contact_name, contact_phone, contact_email, message, status, lead_id, created_by, data, created_at, updated_at)
           VALUES ($1,$2,'note','note','outbound',$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
          [commId, cid, ln.name || ownerName, ln.phone || '', ln.email || '', noteContent,
           mailerStatus, lead_id, rep_name || 'AI Automation',
           JSON.stringify({ bid_mailer_id: mailerId, total_bid: totalBid, owner_name: ownerName, postgrid_id: postgridTrackingId })]
        );
      } catch (commErr) {
        console.warn('[BidMailer] Failed to log communication:', commErr.message);
      }

      console.log(`[BidMailer] Complete: lead=${lead_id}, owner=${ownerName}, bid=$${formattedBid}, dry_run=${DRY_RUN}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true, dry_run: DRY_RUN, owner_name: ownerName, total_bid: totalBid,
        postgrid_tracking_id: postgridTrackingId || null,
        letter_preview: letterBody.substring(0, 300) + (letterBody.length > 300 ? '...' : ''),
        note: noteContent
      }));
    } catch (err) {
      console.error('[BidMailer] Pipeline error:', err.message, err.stack);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/hooks/bid-mailer' && req.method === 'OPTIONS') {
    setCorsHeaders(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api/hooks/bid-mailer-status' && req.method === 'GET') {
    setCorsHeaders(res, req);
    try {
      const sessionUser = req.session?.passport?.user || req.session?.user;
      const statusUserEmail = sessionUser?.claims?.email || sessionUser?.email;
      if (!statusUserEmail) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Authentication required' }));
        return;
      }
      const pool = prodDb.getPool();
      const { rows: statusCompanyRows } = await pool.query(
        `SELECT company_id FROM staff_profiles WHERE user_email = $1 AND is_active = true LIMIT 1`, [statusUserEmail]
      );
      let statusCid = statusCompanyRows[0]?.company_id || '';
      if (!statusCid) {
        const { rows: ownerRows } = await pool.query(`SELECT id FROM companies WHERE created_by = $1 LIMIT 1`, [statusUserEmail]);
        statusCid = ownerRows[0]?.id || '';
      }
      const leadId = url.searchParams.get('lead_id');
      if (!leadId) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'lead_id required' })); return; }
      const { rows } = await pool.query(
        `SELECT ge.data, ge.created_date FROM generic_entities ge WHERE ge.entity_type = 'BidMailer' AND ge.data->>'lead_id' = $1 AND ge.company_id = $2 AND ge.created_date > NOW() - INTERVAL '24 hours' ORDER BY ge.created_date DESC LIMIT 1`,
        [leadId, statusCid]
      );
      if (rows.length > 0) {
        const d = rows[0].data;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sent_recently: true, sent_at: rows[0].created_date, dry_run: d.dry_run }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sent_recently: false }));
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (pathname === '/api/functions/invoke' && req.method === 'POST') {
    await prodIntegrations.handleFunctionInvoke(req, res);
    return;
  }

  if (req.method === 'OPTIONS' && pathname.startsWith('/api/integrations/')) {
    setCorsHeaders(res);
    res.writeHead(200);
    res.end();
    return;
  }

  if (pathname.startsWith('/uploads/')) {
    if (await prodIntegrations.serveUploadedFile(req, res, pathname)) return;
    // File not found in disk or DB — return proper 404, not the SPA
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'File not found' }));
    return;
  }

  if (pathname === '/api/public/customer' && req.method === 'GET') {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const customerId = urlObj.searchParams.get('id');
    if (!customerId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'id required' }));
      return;
    }
    try {
      const pool = prodDb.getPool();
      const result = await pool.query('SELECT * FROM customers WHERE id = $1 LIMIT 1', [customerId]);
      if (result.rows.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Customer not found' }));
        return;
      }
      const c = result.rows[0];
      const safe = { id: c.id, name: c.name, email: c.email, phone: c.phone, street: c.street, city: c.city, state: c.state, zip: c.zip, company_id: c.company_id };
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: true, customer: safe }));
    } catch (err) {
      console.error('[Public API] Customer lookup error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error' }));
    }
    return;
  }

  if (pathname === '/api/debug/transfer-logs') {
    setCorsHeaders(res);
    const authHeader = req.headers['authorization'] || '';
    if (!BRIDGE_SECRET || authHeader !== `Bearer ${BRIDGE_SECRET}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
    try {
      const pool = prodDb.getPool();
      const { rows } = await pool.query(
        `SELECT data, created_date FROM generic_entities WHERE entity_type = 'TransferLog' ORDER BY created_date DESC LIMIT 50`
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows.map(r => ({ ...r.data, _ts: r.created_date }))));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (pathname.startsWith('/api/')) {
    console.warn(`[Server] 404 API route not found: ${req.method} ${pathname}`);
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Serve static files from dist/public/ (populated by vite-plugin-static-copy)
  const publicFilePath = path.join(__dirname, 'public', pathname);
  if (fs.existsSync(publicFilePath) && fs.statSync(publicFilePath).isFile()) {
    serveStaticFile(res, publicFilePath);
    return;
  }

  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveStaticFile(res, filePath);
    return;
  }

  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    serveStaticFile(res, indexPath);
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
  } catch (err) {
    console.error('[Server] Request handler error:', err.message, req.url);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

const twilioWss = new WebSocketServer({ noServer: true });
const lexiWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/ws/twilio')) {
    twilioWss.handleUpgrade(req, socket, head, ws => twilioWss.emit('connection', ws, req));
  } else if (req.url?.startsWith('/ws/lexi-native')) {
    lexiWss.handleUpgrade(req, socket, head, ws => lexiWss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

async function writeTransferLog(data) {
  try {
    const pool = prodDb.getPool();
    const id = `tlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'TransferLog', $2, $3, NOW(), NOW())`,
      [id, data.companyId || 'unknown', JSON.stringify({ ...data, written: new Date().toISOString() })]
    );
  } catch (e) {
    console.error('[TransferLog] DB write failed:', e.message);
  }
}

twilioWss.on('connection', async (twilioWs, req) => {
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
  let companyName = 'CompanySync';
  let assistantName = 'Sarah';
  let isOutboundCall = false;
  let outboundLeadName = '';
  let outboundLeadService = '';
  let outboundCampaign = null;
  let subscriberSystemPrompt = '';
  let companyDescription = '';
  let companyKnowledge = '';
  let geminiKeepaliveInterval = null;
  let isForwardedCall = false;
  let forwardedRepName = '';
  let forwardedRepEmail = '';
  let forwardedRepPhone = '';
  let callRoutingMode = 'sarah_answers';
  let staffCellPhone = '';
  let calledTwilioNumber = '';
  let schedulingDefaults = null;
  let isSarahSpeaking = false;
  let echoGateCooldownTimer = null;
  let echoGateFailsafeTimer = null;
  let recordingStarted = false;
  let recordingRetryTimer = null;

  let geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;

  async function startCallRecording(attempt = 1) {
    if (recordingStarted) return;
    console.log(`[Sarah] startCallRecording attempt=${attempt}, callSid=${callSid}, company=${callCompanyId}`);
    if (!callSid) { console.warn('[Sarah] startCallRecording: no callSid, aborting'); return; }
    if (!callCompanyId) { console.warn('[Sarah] startCallRecording: no companyId, aborting'); return; }
    try {
      const pool = prodDb.getPool();
      const { rows } = await pool.query(
        `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
        [callCompanyId]
      );
      const tw = rows[0]?.data || {};
      const acctSid = tw.account_sid || process.env.TWILIO_ACCOUNT_SID;
      const authToken = tw.auth_token || process.env.TWILIO_AUTH_TOKEN;
      if (!acctSid || !authToken) { console.warn('[Sarah] No Twilio creds for recording'); return; }
      const host = req.headers?.host || process.env.HOST || 'getcompanysync.com';
      const callbackUrl = `https://${host}/api/twilio/recording-callback`;
      console.log(`[Sarah] Recording API: acctSid=${acctSid.slice(0,8)}..., callbackUrl=${callbackUrl}`);
      const authB64 = Buffer.from(`${acctSid}:${authToken}`).toString('base64');
      const resp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${acctSid}/Calls/${callSid}/Recordings.json`,
        {
          method: 'POST',
          headers: { 'Authorization': `Basic ${authB64}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ RecordingStatusCallback: callbackUrl, RecordingStatusCallbackMethod: 'POST', RecordingChannels: 'dual' }).toString()
        }
      );
      if (resp.ok) {
        recordingStarted = true;
        const result = await resp.json();
        console.log(`[Sarah] Recording started via REST API for callSid=${callSid}, recordingSid=${result.sid}`);
      } else {
        const txt = await resp.text();
        console.warn(`[Sarah] Recording start failed (attempt ${attempt}): ${resp.status} ${txt}`);
        if (attempt === 1 && twilioWs.readyState === WebSocket.OPEN) {
          console.log('[Sarah] Will retry recording start in 5 seconds...');
          recordingRetryTimer = setTimeout(() => { recordingRetryTimer = null; startCallRecording(2); }, 5000);
        }
      }
    } catch (e) {
      console.warn(`[Sarah] Recording start error (attempt ${attempt}):`, e.message);
      if (attempt === 1 && twilioWs.readyState === WebSocket.OPEN) {
        recordingRetryTimer = setTimeout(() => { recordingRetryTimer = null; startCallRecording(2); }, 5000);
      }
    }
  }

  async function saveCallToBase44() {
    if (callLogSaved) return;
    callLogSaved = true;
    const dur = Math.round((Date.now() - callStartTime) / 1000);
    const transcript = conversationLog.map(e => `${e.role}: ${e.text}`).join('\n');
    const callDirection = isForwardedCall ? 'forwarded' : (isOutboundCall ? 'outbound' : 'inbound');
    const callerDisplayName = collectedCallerName || outboundLeadName || 'Voice Caller';
    const commId = `comm_ai_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    console.log(`[Sarah] saveCallToBase44: callSid=${callSid}, dur=${dur}s, transcript=${transcript.length} chars, conversationLog=${conversationLog.length} entries`);
    try {
      await callBase44API('saveCallLog', callCompanyId, { caller_phone: callerPhone || 'Unknown', caller_name: callerDisplayName, duration_seconds: dur, transcript, call_sid: callSid || '', tool_calls_made: toolCallsMade, assistant_name: assistantName, direction: callDirection });
      await callBase44API('trackCallMinutes', callCompanyId, { duration_seconds: dur });
      billAIUsage(callCompanyId, Math.max(1, Math.ceil(dur / 60)));
      logUsageEvent(callCompanyId, 'sarah', Math.max(1, Math.ceil(dur / 60))).catch(() => {});
    } catch (err) { console.error('[Sarah] Save failed:', err.message); }
    // Send post-call notifications (non-blocking)
    if (dur >= 5) {
      sendPostCallNotifications(callCompanyId, {
        callerPhone: callerPhone || 'Unknown',
        callerName: callerDisplayName,
        transcript,
        durationSeconds: dur,
        commId,
        repName: forwardedRepName || '',
        repEmail: forwardedRepEmail || '',
        repCell: staffCellPhone || forwardedRepPhone || '',
        companyName,
        assistantName,
        callDirection,
        toolCallsMade,
        callSid: callSid || '',
      }).catch(e => console.error('[Sarah] Post-call notifications failed:', e.message));
    }
  }

  try {
    const companyKey = await prodDb.getCompanyGeminiKey(callCompanyId);
    if (companyKey) geminiApiKey = companyKey;
  } catch (e) { console.error('[Sarah] BYOK key lookup failed:', e.message); }
  if (!geminiApiKey) { console.error('[Sarah] No API key'); twilioWs.close(); return; }

  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;

  async function connectGemini() {
    const currentSettings = loadSettings();
    let voiceName = currentSettings.voice || 'Kore';

    let inboundGreeting = '';
    if (callCompanyId) {
      try {
        const crm = await callBase44API('getSettings', callCompanyId);
        console.log(`[Sarah] getSettings response: ${JSON.stringify({company: callCompanyId, hasSettings: !!crm.settings, assistant_name: crm.settings?.assistant_name, brand: crm.settings?.brand_short_name})}`);
        const rawDisplay = (crm.settings?.intent_templates?._assistant_display_name || '').trim();
        const rawAssistant = (crm.settings?.assistant_name || '').trim();
        const rawBrand = (crm.settings?.brand_short_name || '').trim();
        if (rawBrand) companyName = rawBrand; else if (crm.companyName) companyName = crm.companyName;
        if (rawDisplay) assistantName = rawDisplay.charAt(0).toUpperCase() + rawDisplay.slice(1);
        else if (rawAssistant) assistantName = rawAssistant.charAt(0).toUpperCase() + rawAssistant.slice(1);
        if (crm.settings?.voice_id && VALID_GEMINI_VOICES.includes(crm.settings.voice_id)) voiceName = crm.settings.voice_id;
        else if (crm.settings?.voice && VALID_GEMINI_VOICES.includes(crm.settings.voice)) voiceName = crm.settings.voice;
        if (crm.customSystemPrompt) subscriberSystemPrompt = crm.customSystemPrompt;
        if (crm.knowledgeBase) companyKnowledge = crm.knowledgeBase;
        if (crm.companyDescription) companyDescription = crm.companyDescription;
        if (crm.companyServices) companyDescription += '\nServices: ' + crm.companyServices;
        if (crm.settings?.inbound_greeting) inboundGreeting = crm.settings.inbound_greeting;
        if (crm.settings?.scheduling_defaults) schedulingDefaults = crm.settings.scheduling_defaults;
      } catch (e) { console.error('[Sarah] CRM load FAILED:', {company: callCompanyId, error: e.message, stack: e.stack}); }
    }

    if (!VALID_GEMINI_VOICES.includes(voiceName)) { console.warn(`[Sarah] Invalid voice "${voiceName}", using Kore`); voiceName = 'Kore'; }
    console.log(`[Sarah] Connecting Gemini: voice=${voiceName}, company=${companyName}, assistant=${assistantName}`);

    geminiWs = new WebSocket(geminiUrl);

    geminiWs.on('open', () => {
      const forwardedInfo = isForwardedCall ? { isForwarded: true, repName: forwardedRepName, repEmail: forwardedRepEmail, repPhone: forwardedRepPhone } : null;
      let prompt = buildSystemPrompt(companyName, assistantName, isOutboundCall, outboundLeadName, outboundLeadService, subscriberSystemPrompt, companyDescription, companyKnowledge, forwardedInfo);
      if (schedulingDefaults) {
        const schedStart = formatHour12(schedulingDefaults.business_hours_start ?? 9);
        const schedEnd = formatHour12(schedulingDefaults.business_hours_end ?? 17);
        const schedDur = parseInt(schedulingDefaults.duration_min) || 45;
        prompt += `\n\nSCHEDULING: Business hours are ${schedStart}–${schedEnd}. Appointments are ${schedDur} minutes each. Always call check_availability first to get real open slots, then offer those exact times to the caller. After the caller confirms a time, call book_appointment with that exact ISO datetime. Never invent or guess available times — only offer what check_availability returns.`;
      }
      geminiWs.send(JSON.stringify({
        setup: {
          model: "models/gemini-2.5-flash-native-audio-latest",
          generation_config: { response_modalities: ["AUDIO"], speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } } },
          input_audio_transcription: {},
          output_audio_transcription: {},
          system_instruction: { parts: [{ text: prompt }] },
          tools: [{ function_declarations: CRM_TOOLS }]
        }
      }));
    });

    geminiWs.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        if (data.setupComplete) {
          setupComplete = true;
          console.log(`[${assistantName}] Gemini setup complete, sending greeting (outbound: ${isOutboundCall}, forwarded: ${isForwardedCall})...`);
          geminiKeepaliveInterval = setInterval(() => {
            if (geminiWs?.readyState === WebSocket.OPEN) {
              geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ data: Buffer.alloc(320).toString('base64'), mime_type: "audio/pcm;rate=16000" }] } }));
            } else {
              clearInterval(geminiKeepaliveInterval);
            }
          }, 5000);
          let returningLeadContext = '';
          if (callerPhone && callCompanyId) {
            try {
              const cleanPhone = callerPhone.replace(/[^\d+]/g, '');
              const phoneVariants = [cleanPhone, cleanPhone.replace(/^\+1/, ''), '+1' + cleanPhone.replace(/^\+1/, '')];
              const leadResult = await pool.query(
                `SELECT data FROM generic_entities WHERE entity_type = 'Lead' AND company_id = $1 AND (data->>'phone' = ANY($2) OR data->>'mobile_phone' = ANY($2)) ORDER BY updated_date DESC LIMIT 1`,
                [callCompanyId, phoneVariants]
              );
              if (leadResult.rows.length > 0) {
                const lead = leadResult.rows[0].data;
                const commResult = await pool.query(
                  `SELECT * FROM communications WHERE company_id = $1 AND lead_id = $2 ORDER BY created_at DESC LIMIT 3`,
                  [callCompanyId, lead.id || '']
                );
                const lastComm = commResult.rows[0];
                if (lead.full_name || lead.name) {
                  returningLeadContext = `\n\nRETURNING CALLER CONTEXT: This caller (${callerPhone}) is ${lead.full_name || lead.name}. `;
                  if (lastComm) returningLeadContext += `Last interaction: ${lastComm.type || 'contact'} on ${lastComm.date || lastComm.created_date || 'unknown date'}. `;
                  if (lead.service_needed || lead.service_type) returningLeadContext += `They previously inquired about: ${lead.service_needed || lead.service_type}. `;
                  if (lead.notes) returningLeadContext += `Notes: ${lead.notes}. `;
                  returningLeadContext += `Greet them by name and reference your prior conversation. Don't ask for info you already have.`;
                  console.log(`[${assistantName}] Returning lead detected: ${lead.full_name || lead.name}`);
                }
              }
            } catch (e) {
              console.log(`[${assistantName}] No prior history found for ${callerPhone}`);
            }
          }

          let greetingText;
          if (isForwardedCall && callRoutingMode === 'sarah_then_transfer') {
            greetingText = `A customer just called ${forwardedRepName}'s line. Greet them warmly as ${assistantName} with ${companyName}, answering for ${forwardedRepName}. Get their name and what they need, save with save_lead_details (assign to ${forwardedRepName}), then try transfer_call once. If it works, say you're connecting them. If it fails, do NOT retry — just tell them ${forwardedRepName} is tied up and offer to schedule an inspection or take a message. Remember your name is ${assistantName}.${returningLeadContext}`;
          } else if (isForwardedCall) {
            greetingText = `A customer just called ${forwardedRepName}'s line and it was forwarded to you. Greet them warmly as ${assistantName} with ${companyName}, answering for ${forwardedRepName}. Remember your name is ${assistantName}. Any leads from this call should be assigned to ${forwardedRepName}.${returningLeadContext}`;
          } else if (isOutboundCall) {
            if (outboundCampaign && outboundCampaign.intro) {
              const replaceVars = (t) => (t || '').replace(/\{agent\}/g, assistantName).replace(/\{brand\}/g, companyName).replace(/\{lead_name\}/g, outboundLeadName || 'the homeowner').replace(/\{lead_service\}/g, outboundLeadService || 'their inquiry');
              const campaignIntro = replaceVars(outboundCampaign.intro);
              const campaignPoints = outboundCampaign.points ? `\n\nTALKING POINTS:\n${replaceVars(outboundCampaign.points)}` : '';
              const campaignGoals = outboundCampaign.goals ? `\n\nGOALS: ${outboundCampaign.goals}` : '';

              let campaignTraining = '';
              if (outboundCampaign.campaign_system_prompt) campaignTraining += `\n\nCAMPAIGN SYSTEM PROMPT:\n${outboundCampaign.campaign_system_prompt}`;
              if (outboundCampaign.knowledge_base) campaignTraining += `\n\nCAMPAIGN KNOWLEDGE BASE:\n${outboundCampaign.knowledge_base}`;
              if (outboundCampaign.tone_style) {
                const toneMap = { warm_empathetic: 'Be warm, caring, and empathetic. Show genuine concern.', professional: 'Be polished and professional.', casual_friendly: 'Be casual and friendly, like talking to a neighbor.', direct_confident: 'Be direct and confident without being pushy.' };
                campaignTraining += `\n\nTONE: ${toneMap[outboundCampaign.tone_style] || ''}`;
              }
              if (outboundCampaign.humor_level !== undefined) campaignTraining += ` Humor level: ${outboundCampaign.humor_level}% (${outboundCampaign.humor_level < 20 ? 'very serious' : outboundCampaign.humor_level < 50 ? 'light' : 'witty'}).`;
              if (outboundCampaign.example_conversations?.length > 0) {
                campaignTraining += '\n\nEXAMPLE CONVERSATIONS:';
                outboundCampaign.example_conversations.forEach((ex, i) => { campaignTraining += `\n--- Example ${i+1} ---\nCustomer: "${ex.customer}"\nYou: "${ex.sarah}"`; });
              }
              if (outboundCampaign.objection_handling?.length > 0) {
                campaignTraining += '\n\nOBJECTION HANDLING:';
                outboundCampaign.objection_handling.forEach(oh => { campaignTraining += `\nIf they say: "${oh.objection}" → Respond: "${oh.response}"`; });
              }
              if (outboundCampaign.dos?.length > 0) campaignTraining += '\n\nDO: ' + outboundCampaign.dos.join('; ');
              if (outboundCampaign.donts?.length > 0) campaignTraining += '\nDO NOT: ' + outboundCampaign.donts.join('; ');
              if (outboundCampaign.bailout_message) campaignTraining += `\n\nBAILOUT SCRIPT: If the conversation stalls or the lead becomes unresponsive, say: "${outboundCampaign.bailout_message}"`;


              let aiIdLine = '';
              if (outboundCampaign.ai_identification) aiIdLine = `\n\nAI DISCLOSURE: ${outboundCampaign.ai_identification_text || 'If asked, honestly tell them you are an AI assistant.'}`;

              let customGreetingLine = '';
              if (outboundCampaign.custom_greeting) customGreetingLine = `\n\nCUSTOM OPENING LINE: Use this greeting: "${replaceVars(outboundCampaign.custom_greeting)}"`;

              greetingText = `You are making an outbound call to ${outboundLeadName || 'a potential customer'}. ${campaignIntro}${aiIdLine}${customGreetingLine}${campaignPoints}${campaignGoals}${campaignTraining}\n\nRemember your name is ${assistantName}. Start the conversation now.`;
            } else {
              greetingText = `You are making an outbound call to ${outboundLeadName || 'a potential customer'}${outboundLeadService ? ' who inquired about ' + outboundLeadService : ''}. Introduce yourself as ${assistantName}, an AI assistant from ${companyName}, and ask if you're speaking with ${outboundLeadName || 'the homeowner'}. You MUST mention you are an AI assistant in your opening line. Then continue the conversation naturally. Remember your name is ${assistantName}.`;
            }
          } else {
            const inboundReplaceVars = (t) => (t || '').replace(/\{agent\}/g, assistantName).replace(/\{brand\}/g, companyName);
            if (inboundGreeting) {
              greetingText = `A customer just called. Use this custom opening: "${inboundReplaceVars(inboundGreeting)}". You MUST identify yourself as an AI assistant. Remember your name is ${assistantName}.${returningLeadContext}`;
            } else {
              greetingText = `A customer just called. Greet them warmly as ${assistantName}, the AI assistant for ${companyName}. In your opening line, mention that you are an AI assistant. Remember, your name is ${assistantName}, not Sarah or any other name.${returningLeadContext}`;
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
          geminiWs.send(JSON.stringify({ client_content: { turns: [{ role: "user", parts: [{ text: greetingText }] }], turn_complete: true } }));
        }

        if (data.toolCall) {
          const fcs = data.toolCall.functionCalls || [];
          const responses = [];
          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({
              client_content: {
                turns: [{ role: "user", parts: [{ text: "[System: Tool call in progress. Say a brief filler like 'One sec, let me check on that' or 'Sure, pulling that up now' while waiting. Keep it under 8 words.]" }] }],
                turn_complete: true
              }
            }));
          }

          for (const fc of fcs) {
            let result;
            try {
              const toolContext = { staffCellPhone, forwardedRepName };
              const toolPromise = handleToolCall(fc, callCompanyId, toolContext);
              const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tool call timed out after 8s')), 8000));
              result = await Promise.race([toolPromise, timeoutPromise]);
            } catch (err) {
              console.error(`[Sarah] Tool call ${fc.name} failed:`, err.message);
              result = { error: err.message, status: 'failed' };
            }
            toolCallsMade.push(fc.name);
            if (fc.name === 'save_lead_details' && fc.args?.name) collectedCallerName = fc.args.name;
            if (fc.name === 'transfer_call') {
              console.log(`[TRANSFER-DEBUG] WS handler: result=${JSON.stringify(result)}, callSid=${callSid}, callCompanyId=${callCompanyId}`);
              writeTransferLog({ companyId: callCompanyId, callSid, step: 'tool_result', success: result?.success, resolved_cell: result?.resolved_cell, resolved_name: result?.resolved_name, callCompanyId, calledNumber: calledTwilioNumber });
            }
            if (fc.name === 'transfer_call' && result?.success && callSid) {
              const parsedTransferArgs = typeof fc.args === 'string' ? JSON.parse(fc.args) : (fc.args || {});
              const targetPerson = parsedTransferArgs.target_person || '';
              // Prefer resolved_cell from handleToolCall (it already did the lookup)
              let transferCellPhone = result.resolved_cell || staffCellPhone;
              let transferRepName = result.resolved_name || forwardedRepName;

              if (targetPerson && callCompanyId && !result.resolved_cell) {
                // handleToolCall didn't resolve it — try subscriber cache then DB
                for (const [, entry] of subscriberCache.entries()) {
                  if (entry.companyId === callCompanyId && entry.repName && nameMatchesSearch(entry.repName, targetPerson)) {
                    transferCellPhone = entry.cellPhone || '';
                    transferRepName = entry.repName;
                    console.log(`[Sarah] Name-based transfer (cache): found ${transferRepName}, cell=${transferCellPhone}`);
                    break;
                  }
                }
                if (!transferCellPhone) {
                  try {
                    const allRouting = await callBase44API('getAllSubscriberRouting', null);
                    if (allRouting?.subscribers && Array.isArray(allRouting.subscribers)) {
                      const matched = allRouting.subscribers.find(s =>
                        s.company_id === callCompanyId && s.rep_name && nameMatchesSearch(s.rep_name, targetPerson)
                      );
                      if (matched) {
                        transferCellPhone = matched.cell_phone || '';
                        transferRepName = matched.rep_name;
                        console.log(`[Sarah] Name-based transfer (DB): found ${transferRepName}, cell=${transferCellPhone}`);
                      }
                    }
                  } catch (e) { console.warn(`[Sarah] Routing lookup failed:`, e.message); }
                }
              }

              if (!transferCellPhone) {
                const cachedForTransfer = calledTwilioNumber ? getCachedSubscriber(calledTwilioNumber) : null;
                transferCellPhone = cachedForTransfer?.cellPhone || '';
                if (!transferCellPhone && calledTwilioNumber && callCompanyId) {
                  try {
                    const staffLookup = await callBase44API('lookupStaffByTwilioNumber', callCompanyId, { twilio_number: calledTwilioNumber });
                    transferCellPhone = staffLookup?.staff?.phone || staffLookup?.staff?.cell_phone || '';
                    if (transferCellPhone) {
                      transferRepName = transferRepName || staffLookup?.staff?.full_name || '';
                      console.log('[Sarah] Got cell from staff lookup:', transferCellPhone);
                    }
                  } catch (e) {}
                }
              }
              if (!transferCellPhone) {
                console.error(`[Sarah] Cannot transfer: no cell phone found for ${targetPerson || transferRepName || 'any staff'}`);
                responses.push({ id: fc.id, name: fc.name, response: { error: 'No cell phone number configured for transfer. Please set your cell phone in Twilio Setup.' } });
                continue;
              }
              console.log(`[Sarah] TRANSFER requested: callSid=${callSid}, cell=${transferCellPhone}, rep=${transferRepName}, target=${targetPerson || '(default)'}, calledNumber=${calledTwilioNumber}`);
              const _xferBase = { companyId: callCompanyId, callSid, calledNumber: calledTwilioNumber, transferCell: transferCellPhone, repName: transferRepName };
              await writeTransferLog({ ..._xferBase, step: 'transfer_requested', callerPhone });
              setTimeout(async () => {
                try {
                  let tSid, tToken, callerIdNum;
                  // 1. Direct DB lookup (most reliable — bypasses cache timing issues)
                  try {
                    const pool = prodDb.getPool();
                    const { rows: twRows } = await pool.query(
                      `SELECT data FROM generic_entities WHERE entity_type = 'TwilioSettings' AND company_id = $1 LIMIT 1`,
                      [callCompanyId]
                    );
                    const twData = twRows[0]?.data || {};
                    tSid = twData.account_sid || '';
                    tToken = twData.auth_token || '';
                    callerIdNum = twData.main_phone_number || calledTwilioNumber || '';
                    await writeTransferLog({ ..._xferBase, step: 'creds_from_db', hasSid: !!tSid, hasToken: !!tToken, callerIdNum, companyQueried: callCompanyId });
                  } catch (dbErr) {
                    await writeTransferLog({ ..._xferBase, step: 'creds_db_error', error: dbErr.message });
                  }
                  // 2. Fallback to subscriber cache
                  if (!tSid || !tToken) {
                    const cachedData = calledTwilioNumber ? getCachedSubscriber(calledTwilioNumber) : null;
                    tSid = cachedData?.twilioSid || '';
                    tToken = cachedData?.twilioToken || '';
                    callerIdNum = cachedData?.twilioPhone || calledTwilioNumber || '';
                    await writeTransferLog({ ..._xferBase, step: 'creds_from_cache', hasSid: !!tSid, hasToken: !!tToken });
                  }
                  // 3. Fallback to environment variables
                  if (!tSid || !tToken) {
                    tSid = process.env.TWILIO_ACCOUNT_SID || '';
                    tToken = process.env.TWILIO_AUTH_TOKEN || '';
                    callerIdNum = callerIdNum || calledTwilioNumber || process.env.TWILIO_PHONE_NUMBER || '';
                    await writeTransferLog({ ..._xferBase, step: 'creds_from_env', hasSid: !!tSid, hasToken: !!tToken });
                  }
                  if (!transferCellPhone) {
                    console.error('[TRANSFER-FATAL] No cell phone resolved for transfer:', {company: callCompanyId, target: targetPerson, cachedCell: cachedForTransfer?.cellPhone, staffCell: staffLookup?.staff?.cell_phone});
                    await writeTransferLog({ ..._xferBase, step: 'no_cell_phone_error' });
                  } else if (tSid && tToken) {
                    const authStr = Buffer.from(`${tSid}:${tToken}`).toString('base64');
                    const transferHost = getPublicHost(null);
                    const transferUrl = `https://${transferHost}/twiml/transfer?cellPhone=${encodeURIComponent(transferCellPhone)}&callerId=${encodeURIComponent(callerIdNum || calledTwilioNumber || '')}&repName=${encodeURIComponent(transferRepName || forwardedRepName)}&callerPhone=${encodeURIComponent(callerPhone || '')}`;
                    await writeTransferLog({ ..._xferBase, step: 'calling_twilio_api', transferUrl, acctSidPrefix: tSid.slice(0, 8) });
                    console.log(`[TRANSFER-DEBUG] Calling Twilio API: SID=${tSid}, callSid=${callSid}, transferUrl=${transferUrl}`);
                    try {
                      const updateResp = await fetch(
                        `https://api.twilio.com/2010-04-01/Accounts/${tSid}/Calls/${callSid}.json`,
                        { method: 'POST', headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `Url=${encodeURIComponent(transferUrl)}&Method=POST` }
                      );
                      const updateBody = await updateResp.text();
                      await writeTransferLog({ ..._xferBase, step: 'twilio_api_response', httpStatus: updateResp.status, responseBody: updateBody.substring(0, 500) });
                      if (!updateResp.ok) {
                        console.error('[TRANSFER-FATAL] Twilio API error:', {status: updateResp.status, body: updateBody.substring(0, 300), callSid, transferUrl});
                      } else {
                        console.log(`[TRANSFER-DEBUG] Twilio API response: status=${updateResp.status}, body=${updateBody.substring(0, 300)}`);
                      }
                    } catch (fetchErr) {
                      console.error('[TRANSFER-FATAL] Twilio API fetch failed:', {error: fetchErr.message, callSid, transferUrl});
                      await writeTransferLog({ ..._xferBase, step: 'twilio_fetch_error', error: fetchErr.message });
                    }
                    saveCallToBase44();
                  } else {
                    console.error('[TRANSFER-FATAL] Missing Twilio credentials:', {hasSid: !!tSid, hasToken: !!tToken, company: callCompanyId, calledNumber: calledTwilioNumber});
                    await writeTransferLog({ ..._xferBase, step: 'no_credentials_error', hasSid: !!tSid, hasToken: !!tToken });
                  }
                } catch (err) {
                  await writeTransferLog({ ..._xferBase, step: 'exception', error: err.message });
                  console.error('[Sarah] Transfer failed:', err.message);
                }
              }, 2000);
            }
            responses.push({ id: fc.id, name: fc.name, response: typeof result === 'object' ? result : { output: String(result) } });
          }
          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({ tool_response: { function_responses: responses } }));

            const toolNames = fcs.map(fc => fc.name).join(', ');
            geminiWs.send(JSON.stringify({
              client_content: {
                turns: [{
                  role: "user",
                  parts: [{ text: `[System: ${toolNames} completed. Now respond to the caller naturally with the result. Keep it brief and conversational.]` }]
                }],
                turn_complete: true
              }
            }));
          }
        }

        if (data.serverContent?.modelTurn?.parts) {
          for (const part of data.serverContent.modelTurn.parts) {
            if (part.text) {
              const isThinking = /\*\*/.test(part.text) || part.text.includes("I'm starting") || part.text.includes("I've formulated");
              if (!isThinking) conversationLog.push({ role: assistantName, text: part.text });
            }
            if (part.inlineData?.mimeType?.startsWith("audio/")) {
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
            }
            if (part.inlineData?.mimeType?.startsWith("audio/") && currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
              const mulawB64 = geminiToTwilio(part.inlineData.data);
              const CHUNK = 160;
              for (let off = 0; off < mulawB64.length; off += CHUNK) {
                twilioWs.send(JSON.stringify({ event: 'media', streamSid: currentStreamSid, media: { payload: mulawB64.slice(off, off + CHUNK) } }));
              }
            }
          }
        }

        if (data.serverContent?.turnComplete) {
          if (echoGateFailsafeTimer) { clearTimeout(echoGateFailsafeTimer); echoGateFailsafeTimer = null; }
          echoGateCooldownTimer = setTimeout(() => { isSarahSpeaking = false; echoGateCooldownTimer = null; }, 300);
        }

        if (data.serverContent?.interrupted) {
          isSarahSpeaking = false;
          if (echoGateCooldownTimer) { clearTimeout(echoGateCooldownTimer); echoGateCooldownTimer = null; }
          if (echoGateFailsafeTimer) { clearTimeout(echoGateFailsafeTimer); echoGateFailsafeTimer = null; }
          if (currentStreamSid && twilioWs.readyState === WebSocket.OPEN) {
            twilioWs.send(JSON.stringify({ event: 'clear', streamSid: currentStreamSid }));
          }
        }

        if (data.serverContent?.inputTranscript) {
          conversationLog.push({ role: 'Caller', text: data.serverContent.inputTranscript });
        }
        if (data.serverContent?.outputTranscript) {
          conversationLog.push({ role: assistantName, text: data.serverContent.outputTranscript });
        }
      } catch (err) { console.error('[Sarah] Gemini msg error:', err.message); }
    });

    geminiWs.on('close', () => {
      if (geminiKeepaliveInterval) clearInterval(geminiKeepaliveInterval);
      if (twilioWs.readyState === WebSocket.OPEN && callSid) {
        console.log('[Sarah] Gemini disconnected while call active - triggering bailout');
        try {
          const twilioSid = process.env.TWILIO_ACCOUNT_SID;
          const twilioToken = process.env.TWILIO_AUTH_TOKEN;
          if (twilioSid && twilioToken) {
            const bailoutMsg = "I'm having a technical glitch. I'll have a human manager call you right back. Thank you for your patience!";
            const twiml = `<Response><Say voice="Polly.Joanna">${bailoutMsg}</Say><Hangup/></Response>`;
            const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${callSid}.json`;
            const authB64 = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
            fetch(updateUrl, {
              method: 'POST',
              headers: { 'Authorization': `Basic ${authB64}`, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: `Twiml=${encodeURIComponent(twiml)}`
            }).catch(e => console.error('[Sarah] Bailout TwiML update failed:', e.message));
            if (callCompanyId) {
              const notifId = `notif_bailout_${Date.now()}`;
              const pool = prodDb.getPool();
              pool.query(
                `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
                [notifId, callCompanyId, JSON.stringify({
                  id: notifId,
                  company_id: callCompanyId,
                  type: 'ai_bailout',
                  title: 'Sarah AI Disconnected During Call',
                  message: `Sarah lost connection during a call${collectedCallerName ? ' with ' + collectedCallerName : ''}${callerPhone ? ' (' + callerPhone + ')' : ''}. The caller was told a manager would call back.`,
                  is_read: false,
                  priority: 'high',
                  created_at: new Date().toISOString()
                })]
              ).catch(e => console.error('[Sarah] Bailout notification DB save failed:', e.message));
            }
          }
        } catch (bailoutErr) {
          console.error('[Sarah] Bailout handler error:', bailoutErr.message);
        }
      }
      saveCallToBase44();
    });
    geminiWs.on('error', (err) => console.error('[Sarah] Gemini error:', err.message));
  }

  twilioWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'start') {
        currentStreamSid = msg.start?.streamSid;
        const customParams = msg.start?.customParameters || {};
        callerPhone = customParams.callerPhone || customParams.from || '';
        callCompanyId = customParams.companyId || DEFAULT_COMPANY_ID;
        callSid = msg.start?.callSid || customParams.callSid || '';
        console.log(`[Sarah] Stream start: callSid=${callSid}, company=${callCompanyId}, caller=${callerPhone}`);
        isOutboundCall = customParams.outbound === 'true';
        outboundLeadName = customParams.leadName || '';
        outboundLeadService = customParams.leadService || '';
        if (customParams.campaign) {
          try { outboundCampaign = JSON.parse(customParams.campaign); } catch(e) { outboundCampaign = null; }
        }
        callRoutingMode = customParams.callRoutingMode || 'sarah_answers';
        staffCellPhone = customParams.staffCellPhone || '';
        calledTwilioNumber = customParams.calledNumber || '';
        forwardedRepName = customParams.forwardedRepName || customParams.repName || '';
        forwardedRepEmail = customParams.forwardedRepEmail || customParams.repEmail || '';
        forwardedRepPhone = customParams.forwardedRepPhone || customParams.repPhone || '';
        isForwardedCall = customParams.isForwardedCall === 'true' || customParams.forwarded === 'true' || callRoutingMode === 'sarah_then_transfer' || callRoutingMode === 'forward_to_cell';
        if (isForwardedCall) console.log(`[Sarah] ROUTED call: rep=${forwardedRepName}, routing=${callRoutingMode}, cell=${staffCellPhone}`);
        connectGemini();
        setTimeout(() => startCallRecording(), 2000);
      }
      if (msg.event === 'media' && setupComplete && !waitingForOutboundGreeting && !isSarahSpeaking && geminiWs?.readyState === WebSocket.OPEN) {
        const pcmB64 = twilioToGemini(msg.media.payload);
        geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ data: pcmB64, mime_type: "audio/pcm;rate=16000" }] } }));
      }
      if (msg.event === 'stop') {
        if (recordingRetryTimer) { clearTimeout(recordingRetryTimer); recordingRetryTimer = null; }
        if (echoGateCooldownTimer) { clearTimeout(echoGateCooldownTimer); echoGateCooldownTimer = null; }
        if (echoGateFailsafeTimer) { clearTimeout(echoGateFailsafeTimer); echoGateFailsafeTimer = null; }
        if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close();
        if (geminiKeepaliveInterval) clearInterval(geminiKeepaliveInterval);
        saveCallToBase44();
      }
    } catch (e) {}
  });

  twilioWs.on('close', () => {
    if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close();
    if (geminiKeepaliveInterval) clearInterval(geminiKeepaliveInterval);
    saveCallToBase44();
  });
});

lexiWss.on('connection', async (clientWs, req) => {
  console.log('[Lexi] Browser client connected');
  const url = new URL(req.url, `http://${req.headers.host}`);
  const companyId = url.searchParams.get('companyId') || '';
  const userEmail = url.searchParams.get('userEmail') || '';
  const userName = url.searchParams.get('userName') || 'User';
  const requestedVoice = url.searchParams.get('voice') || 'Kore';

  let geminiWs = null;
  let setupComplete = false;
  let conversationLog = [];
  let toolCallsMade = [];
  let sessionStartTime = Date.now();

  let geminiApiKey = process.env.GOOGLE_GEMINI_API_KEY;
  try {
    const companyKey = await prodDb.getCompanyGeminiKey(companyId);
    if (companyKey) geminiApiKey = companyKey;
  } catch (e) { console.error('[Lexi Native] BYOK key lookup failed:', e.message); }
  if (!geminiApiKey) { clientWs.send(JSON.stringify({ type: 'error', message: 'API key missing' })); clientWs.close(); return; }
  const geminiUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${geminiApiKey}`;

  async function saveSession() {
    if (!companyId) return;
    const dur = Math.round((Date.now() - sessionStartTime) / 1000);
    try {
      await callLexiBridgeAPI('saveVoiceSession', companyId, userEmail, { duration_seconds: dur, transcript: conversationLog.map(e => `${e.role}: ${e.text}`).join('\n'), tool_calls_made: toolCallsMade, user_email: userEmail });
      billAIUsage(companyId, Math.max(1, Math.ceil(dur / 60)));
      logUsageEvent(companyId, 'lexi', Math.max(1, Math.ceil(dur / 60))).catch(() => {});
    } catch (e) {}
  }

  async function connectGemini() {
    let voiceName = requestedVoice;
    let companyName = 'CompanySync';
    let timezone = 'America/New_York';
    let knowledgeBase = '';
    let customerList = '';
    let staffList = [];
    let preferredLanguage = 'en';
    if (companyId) {
      try {
        let s = null;
        if (LEXI_BRIDGE_API_URL) {
          s = await callLexiBridgeAPI('getSettings', companyId, userEmail);
        }
        if (!s || s.error) {
          s = await localGetSettings(companyId);
        }
        if (s && !s.error) {
          if (s.companyName) companyName = s.companyName;
          if (s.timezone) timezone = s.timezone;
          if (s.knowledgeBase) knowledgeBase = s.knowledgeBase;
          if (s.customerList) customerList = s.customerList;
          if (s.staffList) staffList = s.staffList;
          if (s.preferredLanguage) preferredLanguage = s.preferredLanguage;
          if (!url.searchParams.has('voice')) {
            if (s.settings?.voice_id) voiceName = s.settings.voice_id;
            else if (s.settings?.voice) voiceName = s.settings.voice;
          }
        }
      } catch (e) { console.warn('[Lexi Native] Could not load settings:', e.message); }
    }
    if (!VALID_GEMINI_VOICES.includes(voiceName)) voiceName = 'Kore';

    geminiWs = new WebSocket(geminiUrl);
    geminiWs.on('open', () => {
      geminiWs.send(JSON.stringify({
        setup: {
          model: "models/gemini-2.5-flash-native-audio-latest",
          generation_config: {
            response_modalities: ["AUDIO"],
            speech_config: { voice_config: { prebuilt_voice_config: { voice_name: voiceName } } }
          },
          realtime_input_config: {
            automatic_activity_detection: {
              disabled: false,
              start_of_speech_sensitivity: "START_SENSITIVITY_HIGH",
              end_of_speech_sensitivity: "END_SENSITIVITY_HIGH",
              prefix_padding_ms: 200,
              silence_duration_ms: 800
            }
          },
          system_instruction: { parts: [{ text: buildLexiSystemPrompt(companyName, userName, timezone, knowledgeBase, customerList, staffList, preferredLanguage) }] },
          tools: [{ function_declarations: LEXI_CRM_TOOLS }]
        }
      }));
    });

    geminiWs.on('message', async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.setupComplete) {
          setupComplete = true;
          clientWs.send(JSON.stringify({ type: 'status', status: 'ready' }));
          geminiWs.send(JSON.stringify({ client_content: { turns: [{ role: "user", parts: [{ text: `Greet ${userName} warmly. Under 15 words.` }] }], turn_complete: true } }));
        }
        if (data.toolCall) {
          const fcs = data.toolCall.functionCalls || [];
          const responses = [];
          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({
              client_content: {
                turns: [{ role: "user", parts: [{ text: "[System: Tool call in progress. Say a brief filler like 'One sec, let me pull that up' or 'Sure, checking now' while waiting. Keep it under 8 words.]" }] }],
                turn_complete: true
              }
            }));
          }
          for (const fc of fcs) {
            let result;
            try {
              const toolPromise = handleLexiToolCall(fc, companyId, userEmail);
              const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tool call timed out after 8s')), 8000));
              result = await Promise.race([toolPromise, timeoutPromise]);
            } catch (err) {
              console.error(`[Lexi] Tool call ${fc.name} failed:`, err.message);
              result = { error: err.message, status: 'failed' };
            }
            toolCallsMade.push(fc.name);
            responses.push({ id: fc.id, name: fc.name, response: typeof result === 'object' ? result : { output: String(result) } });
          }
          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({ tool_response: { function_responses: responses } }));
            const toolSummaries = responses.map(r => {
              const res = r.response;
              if (res.error || res.success === false) return `${r.name}: FAILED - ${res.error || 'unknown error'}`;
              return `${r.name}: SUCCESS - ${res.message || 'done'}`;
            }).join('; ');
            geminiWs.send(JSON.stringify({
              client_content: {
                turns: [{
                  role: "user",
                  parts: [{ text: `[System: Tool results: ${toolSummaries}. Respond naturally. If any tool FAILED, tell the user honestly. Keep it brief.]` }]
                }],
                turn_complete: true
              }
            }));
          }
        }
        if (data.serverContent?.inputTranscript) {
          conversationLog.push({ role: 'User', text: data.serverContent.inputTranscript });
          clientWs.send(JSON.stringify({ type: 'transcript', role: 'user', text: data.serverContent.inputTranscript }));
        }
        if (data.serverContent?.modelTurn?.parts) {
          for (const part of data.serverContent.modelTurn.parts) {
            if (part.text && !/\*\*/.test(part.text)) {
              conversationLog.push({ role: 'Lexi', text: part.text });
              clientWs.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: part.text }));
            }
            if (part.inlineData?.mimeType?.startsWith("audio/") && clientWs.readyState === WebSocket.OPEN) {
              const audioSize = part.inlineData.data?.length || 0;
              if (audioSize > 0) {
                geminiIsSpeaking = true;
                if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
                clientWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data, mimeType: part.inlineData.mimeType }));
              } else {
                console.warn('[Lexi Native] Empty audio chunk received from Gemini — skipping');
              }
            }
          }
        }
        if (data.serverContent?.interrupted) {
          geminiIsSpeaking = false;
          if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
          clientWs.send(JSON.stringify({ type: 'interrupted' }));
        }
        if (data.serverContent?.turnComplete) clientWs.send(JSON.stringify({ type: 'turn_complete' }));
      } catch (err) { console.error('[Lexi Native] Gemini message error:', err.message); }
    });

    geminiWs.on('close', () => saveSession());
    geminiWs.on('error', (err) => clientWs.send(JSON.stringify({ type: 'error', message: err.message })));
  }

  let geminiIsSpeaking = false;
  let geminiSpeechEndTimer = null;
  const POST_SPEECH_BUFFER_MS = 200;

  connectGemini();

  clientWs.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'playback_done') {
        if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
        geminiSpeechEndTimer = setTimeout(() => {
          geminiIsSpeaking = false;
          geminiSpeechEndTimer = null;
        }, POST_SPEECH_BUFFER_MS);
      }
      if (msg.type === 'user_interrupted') {
        geminiIsSpeaking = true;
        if (geminiSpeechEndTimer) { clearTimeout(geminiSpeechEndTimer); geminiSpeechEndTimer = null; }
        geminiSpeechEndTimer = setTimeout(() => {
          geminiIsSpeaking = false;
          geminiSpeechEndTimer = null;
        }, POST_SPEECH_BUFFER_MS);
      }
      if (msg.type === 'audio' && geminiWs?.readyState === WebSocket.OPEN && setupComplete && !geminiIsSpeaking) {
        geminiWs.send(JSON.stringify({ realtime_input: { media_chunks: [{ data: msg.data, mime_type: "audio/pcm;rate=16000" }] } }));
      }
      if (msg.type === 'text' && geminiWs?.readyState === WebSocket.OPEN && setupComplete) {
        geminiWs.send(JSON.stringify({ client_content: { turns: [{ role: "user", parts: [{ text: msg.text }] }], turn_complete: true } }));
        conversationLog.push({ role: 'User', text: msg.text });
      }
    } catch (e) {}
  });

  clientWs.on('close', () => {
    saveSession();
    if (geminiWs?.readyState === WebSocket.OPEN) geminiWs.close();
  });
});

prodDb.initDatabase().then(async () => {
  console.log('[Production] Local database ready');
  try {
    const pool = prodDb.getPool();
    const { rows } = await pool.query(
      `SELECT id, data FROM generic_entities WHERE entity_type = 'AssistantSettings' AND data->>'voice_id' IS NOT NULL`
    );
    let fixed = 0;
    for (const row of rows) {
      const voiceId = row.data?.voice_id;
      if (voiceId && !VALID_GEMINI_VOICES.includes(voiceId)) {
        await pool.query(
          `UPDATE generic_entities SET data = jsonb_set(data::jsonb, '{voice_id}', '"Kore"'), updated_date = NOW() WHERE id = $1`,
          [row.id]
        );
        fixed++;
        console.log(`[VoiceMigration] Fixed invalid voice_id "${voiceId}" -> "Kore" for AssistantSettings ${row.id}`);
      }
    }
    if (fixed > 0) console.log(`[VoiceMigration] Cleaned up ${fixed} invalid voice IDs`);
  } catch (e) {
    console.warn('[VoiceMigration] Non-critical error:', e.message);
  }

  try {
    const pool = prodDb.getPool();
    const companiesResult = await pool.query(
      `SELECT id, data->>'created_by' as created_by FROM generic_entities WHERE entity_type = 'Company' AND COALESCE(data->>'is_deleted', 'false') != 'true'`
    );
    let totalCleared = 0;
    for (const company of companiesResult.rows) {
      if (!company.created_by) continue;
      const staffResult = await pool.query(
        `SELECT id, data->>'user_email' as user_email, data->>'full_name' as full_name
         FROM generic_entities WHERE entity_type = 'StaffProfile' AND company_id = $1 AND (data->>'is_administrator')::text = 'true'`,
        [company.id]
      );
      for (const staff of staffResult.rows) {
        const staffEmail = staff.user_email || '';
        if (staffEmail && staffEmail !== company.created_by) {
          await pool.query(
            `UPDATE generic_entities SET data = jsonb_set(data, '{is_administrator}', 'false'), updated_date = NOW() WHERE id = $1`,
            [staff.id]
          );
          totalCleared++;
          console.log(`[Security] Cleared is_administrator from non-owner: ${staff.full_name || staffEmail} (company: ${company.id})`);
        }
      }
    }
    if (totalCleared > 0) {
      console.log(`[Security] Server startup: cleared is_administrator flag from ${totalCleared} non-owner staff profile(s)`);
    } else {
      console.log('[Security] Server startup: no non-owner admin flags found');
    }

    const affectedEmails = ['stonekevin866@gmail.com', 'brian.yicn@gmail.com', 'bickel941@gmail.com'];
    for (const email of affectedEmails) {
      const profileResult = await pool.query(
        `SELECT id, data->>'role_id' as role_id, data->>'role_name' as role_name, company_id
         FROM generic_entities WHERE entity_type = 'StaffProfile' AND data->>'user_email' = $1`,
        [email]
      );
      for (const profile of profileResult.rows) {
        if (!profile.role_id || profile.role_id === '') {
          const roleResult = await pool.query(
            `SELECT id, data->>'name' as name FROM generic_entities WHERE entity_type = 'StaffRole' AND company_id = $1 AND LOWER(data->>'name') LIKE '%insurance claims specialist%'`,
            [profile.company_id]
          );
          if (roleResult.rows.length > 0) {
            const role = roleResult.rows[0];
            await pool.query(
              `UPDATE generic_entities SET data = data || $1, updated_date = NOW() WHERE id = $2`,
              [JSON.stringify({ role_id: role.id, role_name: role.name }), profile.id]
            );
            console.log(`[Security] Auto-assigned role "${role.name}" to ${email}`);
          } else {
            console.warn(`[Security] WARNING: No "Insurance Claims Specialist" role found for company ${profile.company_id} — ${email} has no role assigned`);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Security] Server startup admin flag cleanup failed:', e.message);
  }

  // Auto-fix YICN staff permissions and company data on every startup
  try {
    const pool = prodDb.getPool();
    const YICN_ID = 'loc_mmdvp1h5_e8i9eb';
    const WRONG_COMPANY_ID = 'company_1773143175492_bwwge66gf';

    // Set is_administrator = true for YICN admin staff (NOT Brian — he's regular staff)
    // NOTE: Do NOT add stonekevin866@gmail.com here — Kevin manages that role via the CRM UI
    const yicnAdmins = [
      'victoriafeliciapatindol@gmail.com',
      'raffy.vpa28@gmail.com',
    ];
    const adminFix = await pool.query(
      `UPDATE staff_profiles SET is_administrator = true, role = 'admin', updated_at = NOW()
       WHERE user_email = ANY($1) AND company_id = $2 AND is_administrator = false RETURNING user_email`,
      [yicnAdmins, YICN_ID]
    );
    if (adminFix.rowCount > 0) {
      console.log(`[YICNFix] Set is_administrator=true for: ${adminFix.rows.map(r => r.user_email).join(', ')}`);
    }

    // Ensure Brian and Virgil are NOT admin — Kevin manages their roles via CRM UI
    const nonAdminReset = await pool.query(
      `UPDATE staff_profiles SET is_administrator = false, updated_at = NOW()
       WHERE user_email IN ('brian.yicn@gmail.com', 'brian.ycinteam@gmail.com', 'stonekevin866@gmail.com')
       AND company_id = $1 AND is_administrator = true RETURNING user_email`,
      [YICN_ID]
    );
    if (nonAdminReset.rowCount > 0) {
      console.log(`[YICNFix] Reset non-admin staff: ${nonAdminReset.rows.map(r => r.user_email).join(', ')}`);
    }

    // Clear sessions for staff whose permissions have changed so they get fresh auth on next login
    try {
      const sessionClear = await pool.query(
        `DELETE FROM sessions WHERE data::text ILIKE '%brian.yicn@gmail.com%' OR data::text ILIKE '%brian.ycinteam@gmail.com%' OR data::text ILIKE '%stonekevin866@gmail.com%' RETURNING sid`
      );
      if (sessionClear.rowCount > 0) {
        console.log(`[YICNFix] Cleared ${sessionClear.rowCount} session(s) to refresh permissions`);
      }
    } catch (e) { /* sessions table may not exist in all envs */ }

    // Move Virgil Stone's active profile from wrong company into YICN; deactivate duplicates
    const virgilMove = await pool.query(
      `UPDATE staff_profiles SET company_id = $1, is_active = true, updated_at = NOW()
       WHERE user_email = 'stonekevin866@gmail.com' AND company_id = $2 AND is_active = true RETURNING id`,
      [YICN_ID, WRONG_COMPANY_ID]
    );
    if (virgilMove.rowCount > 0) {
      console.log(`[YICNFix] Moved ${virgilMove.rowCount} Virgil Stone active profile(s) to YICN`);
    }
    // Deactivate any remaining wrong-company profiles for Virgil
    await pool.query(
      `UPDATE staff_profiles SET is_active = false, updated_at = NOW()
       WHERE user_email = 'stonekevin866@gmail.com' AND company_id = $1`,
      [WRONG_COMPANY_ID]
    );

    // Mark wrong company as deleted
    const companyFix = await pool.query(
      `UPDATE companies SET is_deleted = true, updated_at = NOW()
       WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) RETURNING id`,
      [WRONG_COMPANY_ID]
    );
    if (companyFix.rowCount > 0) {
      console.log(`[YICNFix] Marked wrong company ${WRONG_COMPANY_ID} as deleted`);
    }

    // Move orphaned leads from wrong company to YICN
    const leadsFix = await pool.query(
      `UPDATE leads SET company_id = $1, updated_at = NOW()
       WHERE company_id = $2 RETURNING id, name`,
      [YICN_ID, WRONG_COMPANY_ID]
    );
    if (leadsFix.rowCount > 0) {
      console.log(`[YICNFix] Moved ${leadsFix.rowCount} orphaned lead(s) to YICN: ${leadsFix.rows.map(r => r.name).join(', ')}`);
    }
  } catch (e) {
    console.warn('[YICNFix] Startup auto-fix failed:', e.message);
  }
}).catch(err => {
  console.warn('[Production] Database init failed (will retry):', err.message);
});

// Storm alert cron — runs every 30 minutes in production
setInterval(async () => {
  try {
    const pool = prodDb.getPool();
    const stormFns = require('./db/storm-functions.cjs');
    const prodInteg = require('./db/prod-integrations.cjs');
    const result = await stormFns.checkAndSendStormAlerts(pool, {
      sendEmailFn: async (emailData) => prodInteg.sendEmailWithData(emailData, emailData.companyId),
    });
    if (result.totalStorms > 0) console.log('[Cron:stormAlerts]', JSON.stringify(result));
  } catch (err) {
    console.error('[Cron:stormAlerts] Error:', err.message);
  }
}, 30 * 60 * 1000);

// ============================================================
// AUTO-MIGRATION: runs once on startup if pending-migration.json
// exists in object storage. Safe to leave in permanently.
// ============================================================
(async () => {
  try {
    const objStore = require('./db/object-storage.cjs');
    const available = await objStore.isObjectStorageAvailable();
    if (!available) { console.log('[Migrate] Object storage not available — skipping'); return; }

    const exists = await objStore.objectExistsInStorage('pending-migration.json');
    if (!exists) { console.log('[Migrate] No pending-migration.json found — nothing to import'); return; }

    console.log('[Migrate] Found pending-migration.json — starting import...');
    const buf = await objStore.downloadFromObjectStorage('pending-migration.json');
    if (!buf) { console.log('[Migrate] Download returned null — skipping'); return; }

    const payload = JSON.parse(buf.toString('utf8'));
    const pool = prodDb.getPool();
    const counts = {};

    async function upsertRows(table, rows, conflictCols) {
      if (!rows || !rows.length) { counts[table] = 0; return; }
      let inserted = 0;
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = Object.values(row);
        const phs = cols.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${phs}) ON CONFLICT (${conflictCols}) DO NOTHING`;
        try { await pool.query(sql, vals); inserted++; } catch (_) {}
      }
      counts[table] = inserted;
      console.log(`[Migrate]   ${table}: ${inserted}/${rows.length}`);
    }

    await upsertRows('companies',                payload.companies,                'id');
    await upsertRows('users',                    payload.users,                    'id');
    await upsertRows('staff_profiles',           payload.staff_profiles,           'id');
    await upsertRows('inspector_profiles',       payload.inspector_profiles,       'id');
    await upsertRows('customers',                payload.customers,                'id');
    await upsertRows('leads',                    payload.leads,                    'id');
    await upsertRows('projects',                 payload.projects,                 'id');
    await upsertRows('estimates',                payload.estimates,                'id');
    await upsertRows('invoices',                 payload.invoices,                 'id');
    await upsertRows('payments',                 payload.payments,                 'id');
    await upsertRows('communications',           payload.communications,           'id');
    await upsertRows('tasks',                    payload.tasks,                    'id');
    await upsertRows('calendar_events',          payload.calendar_events,          'id');
    await upsertRows('generic_entities',         payload.generic_entities,         'id, entity_type');
    await upsertRows('signing_sessions',         payload.signing_sessions,         'id');
    await upsertRows('transaction_mapping_rules',payload.transaction_mapping_rules,'id');
    await upsertRows('file_uploads',             payload.file_uploads,             'id');

    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    console.log(`[Migrate] Complete! ${total} total records inserted`);

    // Mark as done so it won't re-run
    await objStore.uploadToObjectStorage('pending-migration.json', Buffer.from(JSON.stringify({ done: true, completedAt: new Date().toISOString(), counts })), 'application/json');
    console.log('[Migrate] pending-migration.json overwritten with done marker — will not run again');
  } catch (e) {
    console.error('[Migrate] Auto-migration failed:', e.message);
  }
})();

async function startupAutoProvisionWebhooks() {
  try {
    const pool = prodDb.getPool();
    const { rows } = await pool.query(
      `SELECT company_id, data->>'account_sid' as account_sid, data->>'auth_token' as auth_token,
              data->>'main_phone_number' as main_phone_number
       FROM generic_entities
       WHERE entity_type = 'TwilioSettings'
         AND data->>'account_sid' IS NOT NULL
         AND data->>'auth_token' IS NOT NULL
         AND data->>'main_phone_number' IS NOT NULL`
    );
    if (!rows.length) {
      console.log('[Startup] No Twilio accounts found to provision webhooks for');
      return;
    }
    const publicHost = getPublicHost(null);
    const voiceWebhookUrl = `https://${publicHost}/api/twilio/voice`;
    const statusCallbackUrl = `https://${publicHost}/api/sarah-missed-call`;
    const smsWebhookUrl = `https://${publicHost}/api/whatsapp-webhook`;
    console.log(`[Startup] Auto-provisioning Twilio webhooks for ${rows.length} account(s) -> ${voiceWebhookUrl}`);
    for (const row of rows) {
      try {
        const { account_sid, auth_token, main_phone_number, company_id } = row;
        const authStr = Buffer.from(`${account_sid}:${auth_token}`).toString('base64');
        const listResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${account_sid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(main_phone_number)}`,
          { headers: { 'Authorization': `Basic ${authStr}` } }
        );
        const listData = await listResp.json();
        if (!listData.incoming_phone_numbers?.length) {
          console.warn(`[Startup] ${main_phone_number} not found in Twilio account ${account_sid.substring(0, 10)}... (company: ${company_id})`);
          continue;
        }
        const phoneSid = listData.incoming_phone_numbers[0].sid;
        const currentVoiceUrl = listData.incoming_phone_numbers[0].voice_url || '';
        if (currentVoiceUrl === voiceWebhookUrl) {
          console.log(`[Startup] ${main_phone_number} webhook already correct: ${voiceWebhookUrl}`);
          continue;
        }
        console.log(`[Startup] ${main_phone_number} webhook is "${currentVoiceUrl}" — updating to "${voiceWebhookUrl}"`);
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
        if (updateData.voice_url === voiceWebhookUrl) {
          console.log(`[Startup] SUCCESS: ${main_phone_number} webhook updated to ${voiceWebhookUrl}`);
        } else {
          console.error(`[Startup] FAILED to update ${main_phone_number} webhook:`, JSON.stringify(updateData).substring(0, 200));
        }
      } catch (rowErr) {
        console.error(`[Startup] Error provisioning ${row.main_phone_number}:`, rowErr.message);
      }
    }
  } catch (e) {
    console.error('[Startup] Auto-provision webhooks failed:', e.message);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Production] Server running on port ${PORT}`);
  console.log(`[Production] Auth: /api/login, /api/callback, /api/auth/user, /api/logout, /api/auth/google, /api/auth/google/callback, /api/login-local, /api/signup, /api/confirm-email, /api/change-password`);
  console.log(`[Production] Integrations: /api/integrations/* (invoke-llm, upload, send-email)`);
  console.log(`[Production] Functions: /api/functions/invoke`);
  console.log(`[Production] Auto-provisioning: /api/twilio/auto-provision`);
  console.log(`[Production] Local DB API: /api/local/*`);
  console.log(`[Production] Lexi native bridge: /ws/lexi-native`);
  console.log(`[Production] Sarah voice bridge: /ws/twilio`);
  refreshCacheFromAPI().then(() => {
    console.log(`[Production] Subscriber cache loaded: ${subscriberCache.size} entries`);
    if (process.env.PROVISION_WEBHOOKS_ON_STARTUP === 'true') {
      startupAutoProvisionWebhooks();
    }
  }).catch(err => {
    console.warn(`[Production] Initial cache load failed (will retry):`, err.message);
  });
});
