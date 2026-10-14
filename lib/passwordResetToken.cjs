'use strict';

const crypto = require('crypto');

// Reset links stay valid for 30 minutes, are stored only as a hash, and the
// row's used_at column makes each token single-use.
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function resetTokenExpiresAt(now = Date.now()) {
  return new Date(now + RESET_TOKEN_TTL_MS);
}

module.exports = { RESET_TOKEN_TTL_MS, hashResetToken, resetTokenExpiresAt };
