/**
 * scripts/test-lexi-team-chat.cjs
 *
 * Lexi as a conversational Team Chat teammate, plus hands-free voice delivery.
 *
 * Two things must hold no matter what:
 *   - Lexi's reply is inserted directly and lands in HER thread only. It must
 *     never travel through the public message endpoint, which would fan out
 *     email + SMS to the whole company.
 *   - A hands-free voice message lands in the intended teammate's direct
 *     thread — never a different thread, never a Space.
 *
 * Run: node scripts/test-lexi-team-chat.cjs
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const lexiTeamChat = require('../lib/lexiTeamChat.cjs');
const chatBot = require('../lib/chatBot.cjs');

let passed = 0;
const checks = [];
function check(name, fn) { checks.push({ name, fn }); }

// A pool that records every statement so we can prove what was (and was not) run.
function fakePool(handlers = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      for (const [pattern, respond] of Object.entries(handlers)) {
        if (String(sql).includes(pattern)) return respond(params);
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

const COMPANY = 'co_1';
const LEXI_CONV = {
  id: 'conv_lexi_1',
  chat_type: 'direct',
  participants: [{ email: 'owner@roofco.com', name: 'Owner' }, { email: 'lexi@system', name: 'Lexi' }],
};
const TEAM_SPACE = {
  id: 'conv_space_1',
  chat_type: 'space',
  participants: [{ email: 'owner@roofco.com' }, { email: 'vicky@roofco.com' }, { email: 'mike@roofco.com' }],
};

// ── 1. Identity ──────────────────────────────────────────────────────────────
check('Lexi has a stable identity distinct from the one-way alert bot', () => {
  assert.strictEqual(lexiTeamChat.LEXI_EMAIL, 'lexi@system');
  assert.strictEqual(lexiTeamChat.LEXI_NAME, 'Lexi');
  assert.notStrictEqual(lexiTeamChat.LEXI_EMAIL, chatBot.BOT_EMAIL);
});

check('both internal identities are excluded from the notification fan-out', () => {
  assert.strictEqual(lexiTeamChat.isSystemChatAddress('lexi@system'), true);
  assert.strictEqual(lexiTeamChat.isSystemChatAddress(chatBot.BOT_EMAIL), true);
  assert.strictEqual(lexiTeamChat.isSystemChatAddress('LEXI@SYSTEM'), true);
  assert.strictEqual(lexiTeamChat.isSystemChatAddress(''), true);
});

check('a real teammate is never skipped by the fan-out', () => {
  assert.strictEqual(lexiTeamChat.isSystemChatAddress('vicky@roofco.com'), false);
  assert.strictEqual(lexiTeamChat.isSystemChatAddress('owner@systemsroofing.com'), false);
});

// ── 2. Lexi may only live in a one-to-one thread ─────────────────────────────
check('Lexi is allowed in a two-person direct thread', () => {
  assert.strictEqual(
    lexiTeamChat.isAllowedLexiConversationRequest('direct', ['owner@roofco.com', 'lexi@system']),
    true
  );
});

check('Lexi is rejected from a Space or group', () => {
  assert.strictEqual(lexiTeamChat.isAllowedLexiConversationRequest('space', ['owner@roofco.com', 'lexi@system']), false);
  assert.strictEqual(lexiTeamChat.isAllowedLexiConversationRequest('group', ['owner@roofco.com', 'lexi@system']), false);
  assert.strictEqual(lexiTeamChat.isAllowedLexiConversationRequest('broadcast', ['lexi@system']), false);
});

check('Lexi is rejected from a three-way direct thread', () => {
  assert.strictEqual(
    lexiTeamChat.isAllowedLexiConversationRequest('direct', ['owner@roofco.com', 'vicky@roofco.com', 'lexi@system']),
    false
  );
});

check('conversations without Lexi are untouched by the guard', () => {
  assert.strictEqual(lexiTeamChat.isAllowedLexiConversationRequest('space', ['a@x.com', 'b@x.com', 'c@x.com']), true);
});

check('only a direct thread containing Lexi counts as her thread', () => {
  assert.strictEqual(lexiTeamChat.isLexiDirectConversation(LEXI_CONV), true);
  assert.strictEqual(lexiTeamChat.isLexiDirectConversation(TEAM_SPACE), false);
  assert.strictEqual(lexiTeamChat.isLexiDirectConversation(null), false);
  assert.strictEqual(lexiTeamChat.isLexiDirectConversation({
    id: 'c', chat_type: 'direct', participants: [{ email: 'a@x.com' }, { email: 'b@x.com' }],
  }), false);
});

// ── 3. Replying never re-enters the email/SMS fan-out ────────────────────────
check('a reply is a direct INSERT into the right thread, not an endpoint call', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }) });
  const ok = await lexiTeamChat.postLexiReply(pool, COMPANY, LEXI_CONV.id, 'Task created.');
  assert.strictEqual(ok, true);

  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.ok(insert, 'expected a direct chat_messages INSERT');
  assert.strictEqual(insert.params[1], COMPANY);
  assert.strictEqual(insert.params[2], LEXI_CONV.id, 'the reply must land in the thread it answers');
  assert.strictEqual(insert.params[3], 'lexi@system');
  assert.strictEqual(insert.params[4], 'Lexi');
  assert.ok(insert.sql.includes("'text'"), "Lexi's reply renders as a normal message bubble");
  // A fan-out would require reading the participant list of the conversation
  // and looking up staff contact details; none of that may happen here.
  assert.ok(
    !pool.queries.some((q) => /staff_profiles|SELECT .*participants.* FROM chat_conversations WHERE company_id/i.test(q.sql)),
    'posting a reply must not touch the notification fan-out path'
  );
});

check('a reply into a Space is refused outright', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [TEAM_SPACE], rowCount: 1 }) });
  const ok = await lexiTeamChat.postLexiReply(pool, COMPANY, TEAM_SPACE.id, 'hello everyone');
  assert.strictEqual(ok, false, 'Lexi must never post into a Space');
  assert.ok(!pool.queries.some((q) => q.sql.startsWith('INSERT INTO chat_messages')));
});

check("a reply into another company's thread is refused", async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [], rowCount: 0 }) });
  const ok = await lexiTeamChat.postLexiReply(pool, 'co_other', LEXI_CONV.id, 'leak');
  assert.strictEqual(ok, false);
  assert.ok(!pool.queries.some((q) => q.sql.startsWith('INSERT INTO chat_messages')));
});

// ── 4. The turn reuses Lexi's own assistant, with the caller's identity ──────
check('the turn calls the shared Lexi handler with the caller and thread history', async () => {
  const history = [
    { sender_email: 'lexi@system', message: 'How can I help?', message_type: 'text' },
    { sender_email: 'owner@roofco.com', message: 'Create a task for the Miller roof', message_type: 'text' },
  ];
  const pool = fakePool({
    'FROM chat_messages': () => ({ rows: [...history].reverse(), rowCount: history.length }),
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
  });
  let seen = null;
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'owner@roofco.com',
    userName: 'Owner',
    text: 'Create a task for the Miller roof',
    invokeLexi: async (params) => { seen = params; return { response: 'Done — task created.' }; },
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(seen.companyId, COMPANY);
  assert.strictEqual(seen.userEmail, 'owner@roofco.com');
  assert.strictEqual(seen.message, 'Create a task for the Miller roof');
  // The message being answered was already stored; it must not be repeated in
  // the history or Lexi sees it twice.
  assert.strictEqual(seen.conversationHistory.length, 1);
  assert.strictEqual(seen.conversationHistory[0].role, 'assistant');

  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'Done — task created.');
});

check('history maps Lexi to assistant and everyone else to user', async () => {
  const pool = fakePool({
    'FROM chat_messages': () => ({
      rows: [
        { sender_email: 'lexi@system', message: 'second', message_type: 'text' },
        { sender_email: 'owner@roofco.com', message: 'first', message_type: 'text' },
      ],
      rowCount: 2,
    }),
  });
  const turns = await lexiTeamChat.loadLexiHistory(pool, COMPANY, LEXI_CONV.id);
  assert.deepStrictEqual(turns, [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second' },
  ]);
});

check('a failing assistant posts a visible failure, never silence', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }) });
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'owner@roofco.com',
    userName: 'Owner',
    text: 'anything',
    invokeLexi: async () => { throw new Error('gemini exploded'); },
  });
  assert.strictEqual(ok, false);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.ok(insert, 'the user must be told the answer failed');
  assert.strictEqual(insert.params[5], lexiTeamChat.FAILURE_REPLY);
});

check('an empty assistant answer still posts something readable', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }) });
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'owner@roofco.com',
    text: 'hi',
    invokeLexi: async () => ({ response: '   ' }),
  });
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], lexiTeamChat.FALLBACK_REPLY);
});

check('an empty user message produces no reply at all', async () => {
  const pool = fakePool();
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool, companyId: COMPANY, conversationId: LEXI_CONV.id, userEmail: 'owner@roofco.com', text: '   ',
    invokeLexi: async () => { throw new Error('should never be called'); },
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(pool.queries.length, 0);
});

// ── 5. The alert bot is untouched ────────────────────────────────────────────
check('the one-way alert bot keeps its own identity and alerts Space', () => {
  assert.strictEqual(chatBot.BOT_EMAIL, 'companysync-bot@system');
  assert.strictEqual(chatBot.alertsSpaceId(COMPANY), `conv_alerts_${COMPANY}`);
  assert.strictEqual(lexiTeamChat.isLexiDirectConversation({
    id: chatBot.alertsSpaceId(COMPANY),
    chat_type: 'space',
    participants: [{ email: chatBot.BOT_EMAIL }],
  }), false);
});

// ── 6. Hands-free delivery lands in the correct thread ───────────────────────
check('a voice message is delivered to the named teammate\'s direct thread', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'handsFreeDelivery.js')).href);
  const calls = [];
  const result = await mod.deliverVoiceMessage({
    companyId: COMPANY,
    sender: { email: 'owner@roofco.com', name: 'Owner' },
    recipient: { email: 'vicky@roofco.com', name: 'Vicky Alvarez' },
    clip: { file: { name: 'voice.webm' }, seconds: 7 },
    uploadFile: async () => ({ file_url: 'https://cdn/voice.webm' }),
    request: async (url, body) => {
      calls.push({ url, body });
      if (url === '/api/chat/conversations') return { conversation: { id: 'conv_vicky' } };
      return { ok: true };
    },
  });

  assert.strictEqual(result.conversationId, 'conv_vicky');
  const [openThread, sendMessage] = calls;
  assert.strictEqual(openThread.body.chat_type, 'direct');
  assert.deepStrictEqual(
    openThread.body.participants.map((p) => p.email).sort(),
    ['owner@roofco.com', 'vicky@roofco.com']
  );
  assert.strictEqual(sendMessage.url, '/api/chat/messages');
  assert.strictEqual(sendMessage.body.conversation_id, 'conv_vicky', 'must post into the recipient thread');
  assert.strictEqual(sendMessage.body.message_type, 'audio', 'recipient sees a normal playable voice message');
  assert.strictEqual(sendMessage.body.message, 'https://cdn/voice.webm');
  assert.strictEqual(sendMessage.body.attachment_name, 'Voice message');
});

check('a failed upload never posts an empty message', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'handsFreeDelivery.js')).href);
  const calls = [];
  await assert.rejects(() => mod.deliverVoiceMessage({
    companyId: COMPANY,
    sender: { email: 'owner@roofco.com', name: 'Owner' },
    recipient: { email: 'vicky@roofco.com', name: 'Vicky' },
    clip: { file: { name: 'voice.webm' }, seconds: 3 },
    uploadFile: async () => ({}),
    request: async (url, body) => { calls.push({ url, body }); return { conversation: { id: 'conv_vicky' } }; },
  }), /uploaded/);
  assert.ok(!calls.some((c) => c.url === '/api/chat/messages'), 'nothing may be posted after a failed upload');
});

check('a thread that cannot be opened fails loudly instead of dropping the clip', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'handsFreeDelivery.js')).href);
  let uploaded = false;
  await assert.rejects(() => mod.deliverVoiceMessage({
    companyId: COMPANY,
    sender: { email: 'owner@roofco.com', name: 'Owner' },
    recipient: { email: 'vicky@roofco.com', name: 'Vicky' },
    clip: { file: { name: 'voice.webm' }, seconds: 3 },
    uploadFile: async () => { uploaded = true; return { file_url: 'x' }; },
    request: async () => ({ conversation: null }),
  }), /thread/);
  assert.strictEqual(uploaded, false);
});

check('missing recipient or recording is refused before any request', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'handsFreeDelivery.js')).href);
  const base = {
    companyId: COMPANY,
    sender: { email: 'owner@roofco.com', name: 'Owner' },
    recipient: { email: 'vicky@roofco.com', name: 'Vicky' },
    clip: { file: { name: 'v.webm' } },
    uploadFile: async () => ({ file_url: 'x' }),
    request: async () => { throw new Error('should not be reached'); },
  };
  await assert.rejects(() => mod.deliverVoiceMessage({ ...base, recipient: null }), /send it to/);
  await assert.rejects(() => mod.deliverVoiceMessage({ ...base, clip: null }), /recording/);
  await assert.rejects(() => mod.deliverVoiceMessage({ ...base, companyId: null }), /company/);
});

// ── Dev / prod parity ────────────────────────────────────────────────────────
check('the Lexi chat wiring exists in BOTH the dev plugin and the prod server', () => {
  const fs = require('fs');
  const dev = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
  const prod = fs.readFileSync(path.join(__dirname, '..', 'prod-server.cjs'), 'utf8');
  for (const [label, src] of [['dev', dev], ['prod', prod]]) {
    assert.ok(src.includes("lib/lexiTeamChat.cjs"), `${label} must load the shared Lexi Team Chat module`);
    assert.ok(src.includes('handleLexiTeamChatTurn'), `${label} must trigger a Lexi reply`);
    assert.ok(src.includes('isAllowedLexiConversationRequest'), `${label} must guard Lexi conversation creation`);
    assert.ok(src.includes('isSystemChatAddress'), `${label} must skip system addresses in the fan-out`);
  }
});

(async () => {
  console.log('\nLexi in Team Chat + hands-free voice delivery\n');
  for (const { name, fn } of checks) {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      console.error(`  ✗ ${name}\n    ${err.message}`);
      process.exitCode = 1;
    }
  }
  console.log(`\n${passed}/${checks.length} checks passed.`);
  if (process.exitCode) console.error('FAILED\n'); else console.log('OK\n');
})();
