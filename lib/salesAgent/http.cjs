'use strict';

const fs = require('fs');
const path = require('path');
const { checkRateLimit, getClientIp } = require('../rateLimit.cjs');
const { sessionToken, verifyPayload } = require('./tokens.cjs');
const { agentName, agentVoice, handoffRep, MALE_VOICES, AI_LINE, RECORDING_LINE } = require('./prompt.cjs');
const { loadPricing } = require('./pricing.cjs');
const { agentClips } = require('./clips.cjs');
const { listSlots, bookDemo, rescheduleBooking, markJoined, appBase } = require('./booking.cjs');
const { readState, update } = require('./salesStore.cjs');
const { simulate, stopLead } = require('./sequences.cjs');
const { buildDailySummary } = require('./summary.cjs');
const { recordingsDir } = require('./recording.cjs');
const { inboundAuthorized, inboundSecret, ingestInboundEmail } = require('./inboundEmail.cjs');
const { isPhonePath, handlePhoneRequest, isColeCalledNumber } = require('./phoneHttp.cjs');
const staging = require('../stagingSideEffects.cjs');

const STAGES = ['New', 'Demo Booked', 'Demo Held', 'No-Show', 'Handoff', 'Trial Started', 'Subscribed', 'Lost'];

function isSalesPath(pathname) {
  return pathname.startsWith('/api/sales-demo') || pathname.startsWith('/api/sales-agent');
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

function readJson(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        const err = new Error('too large');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (err) {
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function originAllowed(origin, host) {
  if (!origin) return true;
  let parsed;
  try { parsed = new URL(origin); } catch (_) { return false; }
  const hostname = parsed.hostname;
  const allowed = new Set([
    String(host || '').split(':')[0],
    'getcompanysync.com',
    'www.getcompanysync.com',
    'companysync.io',
    'www.companysync.io',
    'localhost',
    '127.0.0.1',
  ]);
  if (allowed.has(hostname)) return true;
  if (hostname.endsWith('.railway.app') || hostname.endsWith('.up.railway.app')) return true;
  const extra = String(process.env.SALES_DEMO_ORIGINS || '').split(',').map((item) => item.trim()).filter(Boolean);
  return extra.includes(parsed.origin) || extra.includes(hostname);
}

async function authorizeAdmin(req, options) {
  if (options.authorize) return options.authorize(req);
  try {
    const pool = require('../../db/prod-db.cjs').getPool();
    const ctx = await require('../tenantGuard.cjs').resolveRequestContext(req, pool);
    if (!ctx || !ctx.authenticated) return { ok: false, status: 401 };
    if (!ctx.isSuperAdmin) return { ok: false, status: 403 };
    return { ok: true, email: ctx.email };
  } catch (_) {
    return { ok: false, status: 503 };
  }
}

async function handleSalesRequest(req, res, options = {}) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (!options.coleVoice && !isSalesPath(url.pathname)) return false;
  const ip = getClientIp(req);
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const base = appBase(options.appBase || `${(req.headers['x-forwarded-proto'] || 'https')}://${host}`);

  try {
    if (req.method === 'POST' && url.pathname === '/api/sales-demo/session') {
      if (!originAllowed(req.headers.origin, host)) return send(res, 403, { error: 'origin not allowed' }), true;
      const limit = checkRateLimit(`sales-session:${ip}`, { max: 8, windowMs: 10 * 60 * 1000 });
      if (!limit.allowed) return send(res, 429, { error: 'too many sessions' }), true;
      const token = sessionToken({ ip });
      return send(res, 200, {
        token,
        agentName: agentName(),
        voice: agentVoice(),
        recordingNotice: RECORDING_LINE,
        aiDisclosure: AI_LINE,
        maxMinutes: 20,
        dryRun: staging.sideEffectsDisabled() || process.env.SALES_AGENT_DRY_RUN === '1',
      }), true;
    }

    if (req.method === 'GET' && url.pathname === '/api/sales-demo/clips') {
      return send(res, 200, { clips: agentClips() }), true;
    }

    if (req.method === 'GET' && url.pathname === '/api/sales-demo/slots') {
      const busy = options.busy || [];
      return send(res, 200, { slots: listSlots({ busy }) }), true;
    }

    if (req.method === 'POST' && url.pathname === '/api/sales-demo/book') {
      if (!originAllowed(req.headers.origin, host)) return send(res, 403, { error: 'origin not allowed' }), true;
      const limit = checkRateLimit(`sales-book:${ip}`, { max: 6, windowMs: 60 * 60 * 1000 });
      if (!limit.allowed) return send(res, 429, { error: 'too many bookings' }), true;
      const body = await readJson(req);
      const result = await bookDemo({
        firstName: body.firstName || body.first_name,
        lastName: body.lastName || body.last_name,
        email: body.email,
        phone: body.phone,
        company: body.company,
        trade: body.trade,
        start: body.start,
        teamSize: body.teamSize,
        currentSoftware: body.currentSoftware,
        pain: body.pain,
      }, { appBase: base, busy: options.busy || [] });
      return send(res, result.ok ? 200 : 400, result), true;
    }

    if (req.method === 'GET' && url.pathname === '/api/sales-demo/reschedule') {
      const payload = verifyPayload(url.searchParams.get('t'));
      if (!payload || payload.kind !== 'reschedule') return send(res, 400, { error: 'link expired' }), true;
      const booking = readState().bookings.find((row) => row.id === payload.bookingId);
      const lead = booking && readState().leads.find((row) => row.id === booking.leadId);
      return send(res, 200, {
        booking: booking ? { id: booking.id, start: booking.start, status: booking.status, timezone: booking.timezone } : null,
        firstName: lead ? lead.firstName : '',
        slots: listSlots({ busy: options.busy || [] }),
      }), true;
    }

    if (req.method === 'POST' && url.pathname === '/api/sales-demo/reschedule') {
      const body = await readJson(req);
      const payload = verifyPayload(body.token || url.searchParams.get('t'));
      if (!payload || payload.kind !== 'reschedule') return send(res, 400, { error: 'link expired' }), true;
      const result = await rescheduleBooking({ bookingId: payload.bookingId, start: body.start, appBase: base });
      return send(res, result.ok ? 200 : 400, result), true;
    }

    if (req.method === 'POST' && url.pathname === '/api/sales-demo/opt-out') {
      const body = await readJson(req);
      const email = String(body.email || '').toLowerCase();
      const phone = String(body.phone || '');
      const text = String(body.text || '');
      const lead = readState().leads.find((row) => (email && row.email && row.email.toLowerCase() === email) || (phone && row.phone === phone));
      if (!lead) return send(res, 200, { ok: true, found: false }), true;
      if (/^\s*stop\b/i.test(text) || body.stop === true) await stopLead(lead.id, 'stop');
      else await stopLead(lead.id, 'reply');
      return send(res, 200, { ok: true, found: true }), true;
    }

    if (req.method === 'POST' && url.pathname === '/api/sales-demo/join') {
      const body = await readJson(req);
      const payload = verifyPayload(body.token);
      if (!payload || payload.kind !== 'session') return send(res, 401, { error: 'session required' }), true;
      const result = await markJoined(body.bookingId);
      return send(res, result && result.ok ? 200 : 404, result || { ok: false }), true;
    }

    if (req.method === 'POST' && url.pathname === '/api/sales-agent/inbound-email') {
      if (!inboundSecret()) return send(res, 503, { error: 'inbound secret not configured' }), true;
      if (!inboundAuthorized(req, url)) return send(res, 401, { error: 'unauthorized' }), true;
      const limit = checkRateLimit(`sales-inbound:${ip}`, { max: 60, windowMs: 10 * 60 * 1000 });
      if (!limit.allowed) return send(res, 429, { error: 'too many inbound emails' }), true;
      const body = await readJson(req, 1000000);
      const result = await ingestInboundEmail(body);
      return send(res, 200, result), true;
    }

    if (isPhonePath(req.method, url.pathname) || options.coleVoice) {
      await handlePhoneRequest(req, res, {
        ...options,
        pathname: options.coleVoice ? '/api/sales-agent/voice' : url.pathname,
      });
      return true;
    }

    if (url.pathname.startsWith('/api/sales-agent/')) {
      const auth = await authorizeAdmin(req, options);
      if (!auth.ok) return send(res, auth.status || 403, { error: 'super admin required' }), true;

      if (req.method === 'GET' && url.pathname === '/api/sales-agent/admin/overview') {
        const state = readState();
        const flaggedForKevin = (state.leads || []).filter((lead) => lead.needsKevinReview).map((lead) => ({
          id: lead.id,
          email: lead.email || '',
          name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim(),
          inboundReplyAt: lead.inboundReplyAt || null,
          followUpPausedReason: lead.followUpPausedReason || '',
        }));
        return send(res, 200, {
          ...state,
          flaggedForKevin,
          config: {
            agentName: agentName(),
            voice: agentVoice(),
            voices: MALE_VOICES,
            handoff: { name: handoffRep().name, hasEmail: !!handoffRep().email },
            pricing: loadPricing(),
            dryRun: staging.sideEffectsDisabled() || process.env.SALES_AGENT_DRY_RUN === '1',
            dbWrites: false,
          },
        }), true;
      }

      if (req.method === 'POST' && url.pathname === '/api/sales-agent/admin/simulate') {
        const body = await readJson(req);
        return send(res, 200, simulate({ leadId: body.leadId, days: 14 })), true;
      }

      if (req.method === 'GET' && url.pathname === '/api/sales-agent/admin/summary') {
        return send(res, 200, { summary: buildDailySummary(new Date()), suppressedOnStaging: true }), true;
      }

      if (req.method === 'POST' && url.pathname === '/api/sales-agent/admin/config') {
        const body = await readJson(req);
        if (body.pricing || body.monthly) return send(res, 400, { error: 'pricing is locked to $99/$199/$399' }), true;
        if (body.voice && !MALE_VOICES.includes(body.voice)) return send(res, 400, { error: `voice must be ${MALE_VOICES.join(', ')}` }), true;
        await update((state) => {
          state.config = state.config || {};
          if (body.agentName) state.config.agentName = String(body.agentName).slice(0, 40);
          if (body.voice) state.config.voice = body.voice;
        });
        return send(res, 200, { agentName: agentName(), voice: agentVoice() }), true;
      }

      if (req.method === 'POST' && url.pathname === '/api/sales-agent/admin/stage') {
        const body = await readJson(req);
        if (!STAGES.includes(body.stage)) return send(res, 400, { error: 'unknown stage' }), true;
        const result = await update((state) => {
          const lead = state.leads.find((row) => row.id === body.leadId);
          if (!lead) return { ok: false };
          const from = lead.stage;
          lead.stage = body.stage;
          lead.updatedAt = new Date().toISOString();
          state.pipelineEvents.push({
            id: `pipe_${Date.now()}`,
            leadId: lead.id,
            from,
            to: body.stage,
            reason: 'admin',
            at: lead.updatedAt,
          });
          return { ok: true, stage: lead.stage };
        });
        return send(res, result && result.ok ? 200 : 404, result || { ok: false }), true;
      }

      if (req.method === 'GET' && url.pathname === '/api/sales-agent/admin/recording') {
        const safe = String(url.searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const which = url.searchParams.get('leg') === 'out' ? 'out' : 'in';
        const file = path.join(recordingsDir(), `${safe}-${which}.wav`);
        if (!safe || !fs.existsSync(file)) return send(res, 404, { error: 'not found' }), true;
        res.statusCode = 200;
        res.setHeader('content-type', 'audio/wav');
        fs.createReadStream(file).pipe(res);
        return true;
      }
    }

    return send(res, 404, { error: 'not found' }), true;
  } catch (err) {
    return send(res, err.status || 500, { error: err.status ? err.message : 'sales request failed' }), true;
  }
}

module.exports = { isSalesPath, handleSalesRequest, originAllowed, STAGES, isColeCalledNumber };
