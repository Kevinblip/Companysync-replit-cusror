#!/usr/bin/env node
'use strict';

// One-time rewrite of ciphertext from ENCRYPTION_KEY_PREVIOUS onto ENCRYPTION_KEY.
// Idempotent. Prints counts only. Never prints key material or plaintext.
//
// Replit rotation:
// 1. In Secrets, copy the current ENCRYPTION_KEY value into a new secret
//    named ENCRYPTION_KEY_PREVIOUS. Do this before changing ENCRYPTION_KEY.
// 2. Set ENCRYPTION_KEY to a new 64-character hex string.
// 3. Publish (or restart) so both values are present at the same time.
//    Boot runs this rewrite. You can also run: node scripts/reencrypt-secrets.cjs
// 4. Confirm the log: rewritten=N already_current=N failed=0.
//    Run it once more; rewritten must be 0.
// 5. After that, delete ENCRYPTION_KEY_PREVIOUS and publish again.
//    Leave it in place until the second run reports rewritten=0 and Twilio,
//    SMTP, and Google OAuth connections still work.

const { Pool } = require('pg');
const { reencryptStoredSecrets } = require('../lib/reencryptSecrets.cjs');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[reencrypt] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  try {
    const stats = await reencryptStoredSecrets(pool);
    if (stats.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[reencrypt] failed:', err.message);
  process.exit(1);
});
