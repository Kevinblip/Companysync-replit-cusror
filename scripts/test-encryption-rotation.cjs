#!/usr/bin/env node
'use strict';

// Encrypt a fixture with key A, rotate to key B while keeping A as
// ENCRYPTION_KEY_PREVIOUS, confirm decrypt, rewrite the row, then confirm
// the row decrypts with key B alone. Uses local Postgres only.

const crypto = require('crypto');
const { Pool } = require('pg');
const encryption = require('../lib/encryption.cjs');
const { reencryptStoredSecrets } = require('../lib/reencryptSecrets.cjs');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://companysync:preview@127.0.0.1:5432/companysync_preview';
let failed = 0;

function ok(name, cond) {
  if (cond) console.log('  ✓', name);
  else {
    failed += 1;
    console.log('  ✗', name);
  }
}

function hexKey() {
  return crypto.randomBytes(32).toString('hex');
}

async function main() {
  const oldKey = hexKey();
  const newKey = hexKey();
  const plain = 'rotation-fixture-token';
  const pool = new Pool({ connectionString: DATABASE_URL });
  const id = `reencrypt_${crypto.randomBytes(6).toString('hex')}`;
  const entityType = 'ReencryptFixture';

  process.env.ENCRYPTION_KEY = oldKey;
  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  const original = encryption.encryptApiKey(plain);
  ok('ciphertext uses the iv:tag:body format', encryption.CIPHER_RE.test(original));

  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, 'companysync_master_001', $3::jsonb, NOW(), NOW())`,
    [id, entityType, JSON.stringify({
      twilio_auth_token: original,
      smtp_password: encryption.encryptApiKey('smtp-fixture'),
      access_token_enc: encryption.encryptApiKey('oauth-fixture'),
      note: 'not a secret',
    })]
  );

  process.env.ENCRYPTION_KEY = newKey;
  process.env.ENCRYPTION_KEY_PREVIOUS = oldKey;
  ok('new key alone cannot read the old ciphertext', (() => {
    try {
      encryption.decryptWithKey(original, encryption.currentKey());
      return false;
    } catch {
      return true;
    }
  })());
  ok('decrypt tries the previous key', encryption.decryptApiKey(original) === plain);

  const first = await reencryptStoredSecrets(pool, process.env, { info() {} });
  ok('first pass rewrites the three old values', first.rewritten === 3 && first.rowsUpdated >= 1);

  const stored = await pool.query(
    `SELECT data FROM generic_entities WHERE id = $1 AND entity_type = $2`,
    [id, entityType]
  );
  const data = stored.rows[0].data;
  ok('plaintext note is untouched', data.note === 'not a secret');
  ok('stored token changed', data.twilio_auth_token !== original);

  delete process.env.ENCRYPTION_KEY_PREVIOUS;
  ok('twilio token decrypts with the new key only', encryption.decryptApiKey(data.twilio_auth_token) === plain);
  ok('smtp password decrypts with the new key only', encryption.decryptApiKey(data.smtp_password) === 'smtp-fixture');
  ok('oauth token decrypts with the new key only', encryption.decryptApiKey(data.access_token_enc) === 'oauth-fixture');

  process.env.ENCRYPTION_KEY_PREVIOUS = oldKey;
  const second = await reencryptStoredSecrets(pool, process.env, { info() {} });
  ok('second pass rewrites nothing', second.rewritten === 0 && second.alreadyCurrent >= 3);

  const again = await pool.query(
    `SELECT data->>'twilio_auth_token' AS token FROM generic_entities WHERE id = $1 AND entity_type = $2`,
    [id, entityType]
  );
  ok('second pass leaves the ciphertext in place', again.rows[0].token === data.twilio_auth_token);

  await pool.query(`DELETE FROM generic_entities WHERE id = $1 AND entity_type = $2`, [id, entityType]);
  await pool.end();

  console.log(`\n[encryption-rotation] ${failed === 0 ? 'passed' : failed + ' failed'}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[encryption-rotation] error:', err.message);
  process.exit(1);
});
