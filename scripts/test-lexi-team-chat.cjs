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

const OWNER_CONFIG = {
  userEmail: 'owner@roofco.com',
  companyId: COMPANY,
  userName: 'Kevin',
  pin: '4242',
};

function geminiText(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function geminiCall(name, args) {
  return { candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] };
}

// ── 4. The turn uses the phone brain, with the signed-in caller ─────────────
check('the turn sends prior thread history to the phone brain once', async () => {
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
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async ({ body }) => { seen = body; return geminiText('Done — task created.'); },
  });
  assert.strictEqual(ok, true);
  assert.ok(seen.systemInstruction.parts[0].text.includes('THIS MESSAGE ARRIVED IN TEAM CHAT'));
  assert.ok(seen.systemInstruction.parts[0].text.includes('Do not ask for a PIN'));
  const contents = seen.contents;
  assert.strictEqual(contents[0].role, 'model');
  assert.strictEqual(contents[0].parts[0].text, 'How can I help?');
  assert.strictEqual(contents.length, 2);
  assert.strictEqual(contents[1].parts[0].text, 'Create a task for the Miller roof');

  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'Done — task created.');
  assert.ok(!pool.queries.some((q) => /staff_profiles/i.test(q.sql)));
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
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { throw new Error('gemini exploded'); },
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
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async () => ({ candidates: [{ content: { parts: [{ text: '   ' }] } }] }),
  });
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], lexiTeamChat.FALLBACK_REPLY);
});

check('an empty user message produces no reply at all', async () => {
  const pool = fakePool();
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool, companyId: COMPANY, conversationId: LEXI_CONV.id, userEmail: 'owner@roofco.com', text: '   ',
    generate: async () => { throw new Error('should never be called'); },
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(pool.queries.length, 0);
});

check('the owner can save a note through the phone tools', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }) });
  let calls = 0;
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'owner@roofco.com',
    text: 'Make a note to check the ridge',
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async () => {
      calls += 1;
      if (calls === 1) return geminiCall('create_personal_note', { text: 'Check the ridge' });
      return geminiText('Saved the note.');
    },
  });
  assert.strictEqual(ok, true);
  const note = pool.queries.find((q) => q.sql.includes("INSERT INTO generic_entities") && q.sql.includes("'Note'"));
  assert.ok(note, 'the note must be stored');
  assert.strictEqual(note.params[1], COMPANY);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[3], 'lexi@system');
  assert.strictEqual(insert.params[5], 'Saved the note.');
});

check('another staff member gets a polite refusal and no tools', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }) });
  let generated = false;
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'vicky@roofco.com',
    text: 'Save a note',
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { generated = true; return geminiText('nope'); },
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(generated, false);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], lexiTeamChat.OWNER_ONLY);
  assert.ok(!pool.queries.some((q) => q.sql.includes("'Note'") || q.sql.includes('INSERT INTO tasks')));
});

check('a job-title admin flag is not enough to use Lexi', async () => {
  const pool = fakePool({
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
    'FROM staff_profiles': () => ({ rows: [{ is_administrator: false, is_super_admin: false }], rowCount: 1 }),
  });
  let generated = false;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'mike@roofco.com',
    text: 'List my tasks',
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { generated = true; return geminiText('nope'); },
  });
  assert.strictEqual(generated, false);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'I only work for Kevin.');
});

check('a company administrator can use Lexi in the pinned company', async () => {
  const pool = fakePool({
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
    'FROM staff_profiles': () => ({ rows: [{ is_administrator: true, is_super_admin: false }], rowCount: 1 }),
  });
  let generated = false;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'vicky@roofco.com',
    text: 'Hi Lexi',
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { generated = true; return geminiText('Hello.'); },
  });
  assert.strictEqual(generated, true);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'Hello.');
});

check('the configured owner email gets assistant mode even when Team Chat is a different company', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }) });
  let generated = false;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: 'companysync_master_001',
    conversationId: LEXI_CONV.id,
    userEmail: '  YicnTeam@Gmail.com ',
    text: 'Hey Lexi',
    conversation: LEXI_CONV,
    phoneConfig: { ...OWNER_CONFIG, userEmail: 'yicnteam@gmail.com', companyId: 'yicn_roofing_001' },
    generate: async () => { generated = true; return geminiText('Hi Kevin.'); },
  });
  assert.strictEqual(generated, true);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'Hi Kevin.');
  assert.ok(!pool.queries.some((q) => /staff_profiles/i.test(q.sql)), 'the owner email match does not depend on the staff row');
});

check('an administrator of a different company is still refused', async () => {
  const pool = fakePool({
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
    'FROM staff_profiles': () => ({ rows: [{ is_administrator: true, is_super_admin: false }], rowCount: 1 }),
  });
  let generated = false;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'vicky@roofco.com',
    text: 'Hi Lexi',
    conversation: LEXI_CONV,
    phoneConfig: { ...OWNER_CONFIG, companyId: 'yicn_roofing_001' },
    generate: async () => { generated = true; return geminiText('nope'); },
  });
  assert.strictEqual(generated, false);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], lexiTeamChat.OWNER_ONLY);
});

check('a string or JSON administrator flag counts in the pinned company', async () => {
  const pool = fakePool({
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
    'FROM staff_profiles': () => ({
      rows: [{ is_administrator: false, is_super_admin: false, data: { is_administrator: 'true', role: 'admin' } }],
      rowCount: 1,
    }),
  });
  let generated = false;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'vicky@roofco.com',
    text: 'Hi Lexi',
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { generated = true; return geminiText('Hello.'); },
  });
  assert.strictEqual(generated, true);
  const staffSql = pool.queries.find((q) => /FROM staff_profiles/i.test(q.sql));
  assert.ok(staffSql, 'the staff lookup ran');
  assert.ok(staffSql.sql.includes("data->>'user_email'"), 'a bootstrap row stored only in data JSON still matches');
  assert.ok(staffSql.sql.includes("data->>'email'"));
  assert.ok(/ORDER BY/i.test(staffSql.sql), 'an administrator row is preferred over a duplicate non-admin row');
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'Hello.');
});

check('the company owner on the companies row or the Company entity can use Lexi', async () => {
  const pool = fakePool({
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
    'FROM staff_profiles': () => ({ rows: [], rowCount: 0 }),
    'FROM companies': () => ({ rows: [], rowCount: 0 }),
    "entity_type = 'Company'": () => ({ rows: [{ id: COMPANY }], rowCount: 1 }),
  });
  let generated = false;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'pat@roofco.com',
    text: 'Hi Lexi',
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { generated = true; return geminiText('Hello owner.'); },
  });
  assert.strictEqual(generated, true);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'Hello owner.');
});

check('an administrator is recognized when chat uses the pinned company base44 id', async () => {
  const pool = fakePool({
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
    'SELECT id, base44_id FROM companies': (params) => (
      params[0] === 'base44_yicn' && params[1] === 'yicn_roofing_001'
        ? { rows: [{ id: 'yicn_roofing_001', base44_id: 'base44_yicn' }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    ),
    'FROM staff_profiles': () => ({ rows: [{ is_administrator: 't', is_super_admin: false }], rowCount: 1 }),
  });
  let generated = false;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: 'base44_yicn',
    conversationId: LEXI_CONV.id,
    userEmail: 'vicky@roofco.com',
    text: 'Hi Lexi',
    conversation: LEXI_CONV,
    phoneConfig: { ...OWNER_CONFIG, companyId: 'yicn_roofing_001' },
    generate: async () => { generated = true; return geminiText('Hello.'); },
  });
  assert.strictEqual(generated, true);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'Hello.');
});

check('@Lexi in a Space is answered for the owner without a fan-out lookup', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [TEAM_SPACE], rowCount: 1 }) });
  let userText = '';
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: TEAM_SPACE.id,
    userEmail: 'owner@roofco.com',
    text: '@Lexi what is on my schedule',
    conversation: TEAM_SPACE,
    phoneConfig: OWNER_CONFIG,
    generate: async ({ body }) => {
      userText = body.contents[body.contents.length - 1].parts[0].text;
      return geminiText('Nothing booked.');
    },
  });
  assert.strictEqual(ok, true);
  assert.strictEqual(userText, 'what is on my schedule');
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[2], TEAM_SPACE.id);
  assert.strictEqual(insert.params[3], 'lexi@system');
  assert.ok(!pool.queries.some((q) => /staff_profiles/i.test(q.sql)));
});

check('@Lexi in a Space from other staff is the polite reply', async () => {
  const pool = fakePool({ 'FROM chat_conversations WHERE id': () => ({ rows: [TEAM_SPACE], rowCount: 1 }) });
  let generated = false;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: TEAM_SPACE.id,
    userEmail: 'vicky@roofco.com',
    text: 'hey @Lexi delete the Miller job',
    conversation: TEAM_SPACE,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { generated = true; return geminiText('nope'); },
  });
  assert.strictEqual(generated, false);
  const insert = pool.queries.find((q) => q.sql.startsWith('INSERT INTO chat_messages'));
  assert.strictEqual(insert.params[5], 'I only work for Kevin.');
});

check('a Space message that does not mention Lexi gets no reply', async () => {
  const pool = fakePool();
  let generated = false;
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: TEAM_SPACE.id,
    userEmail: 'owner@roofco.com',
    text: 'The crew is on the way',
    conversation: TEAM_SPACE,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { generated = true; return geminiText('nope'); },
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(generated, false);
  assert.strictEqual(pool.queries.length, 0);
});

check('a broadcast mention does not answer', async () => {
  const broadcast = { id: 'conv_all', chat_type: 'broadcast', participants: [] };
  const pool = fakePool();
  const ok = await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: broadcast.id,
    userEmail: 'owner@roofco.com',
    text: '@Lexi hello',
    conversation: broadcast,
    phoneConfig: OWNER_CONFIG,
    generate: async () => { throw new Error('should not run'); },
  });
  assert.strictEqual(ok, false);
  assert.strictEqual(pool.queries.length, 0);
});

check('a later message in the same thread still sees the earlier turn', async () => {
  const history = [
    { sender_email: 'owner@roofco.com', message: 'The Miller ridge is leaking', message_type: 'text' },
    { sender_email: 'lexi@system', message: 'Noted.', message_type: 'text' },
    { sender_email: 'owner@roofco.com', message: 'What did I just tell you?', message_type: 'text' },
  ];
  const pool = fakePool({
    'FROM chat_messages': () => ({ rows: [...history].reverse(), rowCount: history.length }),
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
  });
  let contents = [];
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'owner@roofco.com',
    text: 'What did I just tell you?',
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async ({ body }) => { contents = body.contents; return geminiText('The Miller ridge is leaking.'); },
  });
  assert.strictEqual(contents[0].parts[0].text, 'The Miller ridge is leaking');
  assert.strictEqual(contents[1].parts[0].text, 'Noted.');
  assert.strictEqual(contents[contents.length - 1].parts[0].text, 'What did I just tell you?');
  assert.strictEqual(contents.filter((item) => item.parts[0].text === 'What did I just tell you?').length, 1);
});

check('a customer draft is kept until yes, send it, and staging does not deliver it', async () => {
  const sessions = new Map();
  const pool = fakePool({
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
    'SELECT data FROM generic_entities': (params) => {
      const data = sessions.get(params[1]);
      return { rows: data ? [{ data }] : [], rowCount: data ? 1 : 0 };
    },
    'INSERT INTO generic_entities': (params) => {
      if (params[1] === 'LexiPhoneThread') sessions.set(params[0], JSON.parse(params[3]));
      return { rows: [], rowCount: 1 };
    },
  });
  const prev = process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
  process.env.STAGING_READ_ONLY_SIDE_EFFECTS = '1';
  const originalFetch = global.fetch;
  let fetched = false;
  global.fetch = async () => { fetched = true; return { ok: true, json: async () => ({}) }; };
  try {
    let step = 0;
    await lexiTeamChat.handleLexiTeamChatTurn({
      pool,
      companyId: COMPANY,
      conversationId: LEXI_CONV.id,
      userEmail: 'owner@roofco.com',
      text: 'Text Miller that the crew is on the way',
      conversation: LEXI_CONV,
      phoneConfig: OWNER_CONFIG,
      sendCustomerMessage: lexiTeamChat.defaultSendCustomerMessage,
      generate: async () => {
        step += 1;
        if (step === 1) {
          return geminiCall('draft_customer_message', {
            channel: 'sms', to: '+15551212', message: 'The crew is on the way', contact_name: 'Miller',
          });
        }
        return geminiText('Draft ready.');
      },
    });
    const drafted = [...sessions.values()][0];
    assert.ok(drafted?.pending_draft, 'the draft is stored on the conversation');
    assert.strictEqual(drafted.pending_draft.message, 'The crew is on the way');
    assert.strictEqual(fetched, false);

    step = 0;
    await lexiTeamChat.handleLexiTeamChatTurn({
      pool,
      companyId: COMPANY,
      conversationId: LEXI_CONV.id,
      userEmail: 'owner@roofco.com',
      text: 'please send that',
      conversation: LEXI_CONV,
      phoneConfig: OWNER_CONFIG,
      sendCustomerMessage: lexiTeamChat.defaultSendCustomerMessage,
      generate: async () => {
        step += 1;
        if (step === 1) return geminiCall('confirm_send', {});
        return geminiText('Still waiting.');
      },
    });
    assert.ok([...sessions.values()][0].pending_draft, 'a vague send request keeps the draft');
    assert.strictEqual(fetched, false);

    step = 0;
    await lexiTeamChat.handleLexiTeamChatTurn({
      pool,
      companyId: COMPANY,
      conversationId: LEXI_CONV.id,
      userEmail: 'owner@roofco.com',
      text: 'yes, send it',
      conversation: LEXI_CONV,
      phoneConfig: OWNER_CONFIG,
      sendCustomerMessage: lexiTeamChat.defaultSendCustomerMessage,
      generate: async () => {
        step += 1;
        if (step === 1) return geminiCall('confirm_send', {});
        return geminiText('Staging blocked the send.');
      },
    });
    assert.ok([...sessions.values()][0].pending_draft, 'staging keeps the draft');
    assert.strictEqual(fetched, false);
  } finally {
    if (prev === undefined) delete process.env.STAGING_READ_ONLY_SIDE_EFFECTS;
    else process.env.STAGING_READ_ONLY_SIDE_EFFECTS = prev;
    global.fetch = originalFetch;
  }
});

check('a lookup in Team Chat does not ask for a PIN', async () => {
  const pool = fakePool({
    'FROM chat_conversations WHERE id': () => ({ rows: [LEXI_CONV], rowCount: 1 }),
    'FROM customers': () => ({
      rows: [{ id: 'c1', name: 'Miller', phone: '5551231234', email: 'm@x.com', status: 'active', address: '1 Main', city: 'Cleveland', state: 'OH', zip: '44101' }],
      rowCount: 1,
    }),
  });
  let toolResult = null;
  await lexiTeamChat.handleLexiTeamChatTurn({
    pool,
    companyId: COMPANY,
    conversationId: LEXI_CONV.id,
    userEmail: 'owner@roofco.com',
    text: 'Look up Miller',
    conversation: LEXI_CONV,
    phoneConfig: OWNER_CONFIG,
    generate: async ({ body }) => {
      const last = body.contents[body.contents.length - 1];
      const response = last.parts.find((part) => part.functionResponse);
      if (response) {
        toolResult = response.functionResponse.response;
        return geminiText(toolResult.read_back || 'Found Miller.');
      }
      return geminiCall('lookup_contact', { name: 'Miller' });
    },
  });
  assert.ok(toolResult, 'lookup ran');
  assert.notStrictEqual(toolResult.code, 'PIN_REQUIRED');
  assert.strictEqual(toolResult.success, true);
  assert.ok(String(toolResult.read_back || '').includes('Miller'));
  assert.ok(!JSON.stringify(toolResult).includes('portal_token'));
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

check('Lexi is always a hands-free recipient, including when nobody else is on the team', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'handsFreeDelivery.js')).href);
  const onlyLexi = mod.voiceRecipients([]);
  assert.deepStrictEqual(onlyLexi.map((c) => c.email), ['lexi@system']);
  assert.strictEqual(mod.soleVoiceRecipient(onlyLexi).name, 'Lexi');
  const withPeople = mod.voiceRecipients([
    { email: 'lexi@system', name: 'Lexi' },
    { email: 'vicky@roofco.com', name: 'Vicky Alvarez' },
  ]);
  assert.deepStrictEqual(withPeople.map((c) => c.email), ['lexi@system', 'vicky@roofco.com']);
  assert.strictEqual(mod.soleVoiceRecipient(withPeople), null);

  const names = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'teammateNameMatch.js')).href);
  const heard = names.resolveTeammateName('Lexi', onlyLexi);
  assert.strictEqual(heard.status, 'match');
  assert.strictEqual(heard.match.email, 'lexi@system');
  const wrapped = names.resolveTeammateName('send this to Lexi', withPeople);
  assert.strictEqual(wrapped.status, 'match');
  assert.strictEqual(wrapped.match.email, 'lexi@system');
});

check('a hands-free message to Lexi posts the transcript as text and does not upload audio', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'handsFreeDelivery.js')).href);
  const calls = [];
  let uploaded = false;
  const result = await mod.deliverVoiceMessage({
    companyId: COMPANY,
    sender: { email: 'yicnteam@gmail.com', name: 'Kevin' },
    recipient: { email: 'Lexi@system', name: 'Lexi' },
    clip: { file: { name: 'voice.webm' }, seconds: 4, transcript: '  Remind me to call Miller  ' },
    uploadFile: async () => { uploaded = true; return { file_url: 'https://cdn/voice.webm' }; },
    request: async (url, body) => {
      calls.push({ url, body });
      if (url === '/api/chat/conversations') return { conversation: { id: 'conv_lexi' } };
      return { ok: true };
    },
  });
  assert.strictEqual(uploaded, false, 'Lexi replies from the transcript, not from an audio attachment');
  assert.strictEqual(result.conversationId, 'conv_lexi');
  assert.strictEqual(result.transcript, 'Remind me to call Miller');
  const [openThread, sendMessage] = calls;
  assert.deepStrictEqual(
    openThread.body.participants.map((p) => p.email).sort(),
    ['Lexi@system', 'yicnteam@gmail.com']
  );
  assert.strictEqual(sendMessage.body.message_type, 'text');
  assert.strictEqual(sendMessage.body.message, 'Remind me to call Miller');
  assert.ok(!sendMessage.body.attachment_name);
});

check('a hands-free message to Lexi with no transcript is refused before any request', async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'utils', 'handsFreeDelivery.js')).href);
  let requested = false;
  await assert.rejects(() => mod.deliverVoiceMessage({
    companyId: COMPANY,
    sender: { email: 'yicnteam@gmail.com', name: 'Kevin' },
    recipient: { email: 'lexi@system', name: 'Lexi' },
    clip: { file: { name: 'voice.webm' }, seconds: 4, transcript: '   ' },
    uploadFile: async () => ({ file_url: 'x' }),
    request: async () => { requested = true; return { conversation: { id: 'conv_lexi' } }; },
  }), /transcribe/);
  assert.strictEqual(requested, false);
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
    assert.ok(src.includes('shouldLexiAnswer'), `${label} must answer DMs and @Lexi mentions`);
    assert.ok(src.includes('isAllowedLexiConversationRequest'), `${label} must guard Lexi conversation creation`);
    assert.ok(src.includes('isSystemChatAddress'), `${label} must skip system addresses in the fan-out`);
    assert.ok(src.includes('sendCustomerMessage'), `${label} must pass the guarded customer send`);
  }
  const ui = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TeamChat.jsx'), 'utf8');
  assert.ok(ui.includes('Message Lexi…'), 'the Lexi thread tells Kevin who he is writing to');
  assert.ok(ui.includes('Type @Lexi to ask her'), 'a Space composer tells Kevin how to mention Lexi');
  assert.ok(ui.includes('voiceRecipients('), 'hands-free voice messages can be addressed to Lexi');
  assert.ok(!ui.includes('never Lexi'), 'the voice roster must not drop Lexi');
  const handsFree = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'chat', 'HandsFreeVoiceMessage.jsx'), 'utf8');
  assert.ok(handsFree.includes('startBodyTranscript'), 'a message for Lexi is transcribed in the browser');
  assert.ok(handsFree.includes('isLexiVoiceRecipient'), 'the recorder knows when the recipient is Lexi');
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
