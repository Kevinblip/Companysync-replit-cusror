#!/usr/bin/env node

const assert = require('assert');
const {
  extractMessageText,
  extractSenderEmail,
  lifecycleResponse,
  handleLexiMessage,
} = require('../lib/googleChatLexi.cjs');

async function main() {
  assert.strictEqual(
    extractMessageText({ message: { argumentText: '  show today’s schedule  ' } }),
    'show today’s schedule'
  );
  assert.strictEqual(
    extractSenderEmail({ user: { email: 'REP@EXAMPLE.COM' } }),
    'rep@example.com'
  );
  assert.match(lifecycleResponse({ type: 'ADDED_TO_SPACE' }).text, /I'm Lexi/);

  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM (')) {
        return { rows: [{ email: 'rep@example.com', full_name: 'Roof Rep', is_admin: false }] };
      }
      if (sql.includes("entity_type = 'GoogleChatLexiTurn'")) return { rows: [] };
      if (sql.includes('INSERT INTO generic_entities')) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };

  let invocation = null;
  const reply = await handleLexiMessage({
    pool,
    companyId: 'company-1',
    body: {
      type: 'MESSAGE',
      user: { email: 'rep@example.com', displayName: 'Roof Rep', type: 'HUMAN' },
      space: { name: 'spaces/AAA' },
      message: { argumentText: 'What is on my schedule?' },
    },
    invokeLexi: async (params, caller) => {
      invocation = { params, caller };
      return { response: 'You have two appointments today.' };
    },
  });

  assert.deepStrictEqual(reply, { text: 'You have two appointments today.' });
  assert.strictEqual(invocation.params.mode, 'google_chat');
  assert.strictEqual(invocation.params.userEmail, 'rep@example.com');
  assert.strictEqual(invocation.caller.source, 'google_chat');
  assert.ok(queries.some((q) => q.sql.includes('INSERT INTO generic_entities')));

  const denied = await handleLexiMessage({
    pool: { query: async () => ({ rows: [] }) },
    companyId: 'company-1',
    body: {
      type: 'MESSAGE',
      user: { email: 'outsider@example.com', type: 'HUMAN' },
      message: { argumentText: 'Show every invoice' },
    },
    invokeLexi: async () => { throw new Error('must not run'); },
  });
  assert.match(denied.text, /can't access/);

  console.log('Google Chat Lexi tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});