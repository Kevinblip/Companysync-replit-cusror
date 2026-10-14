'use strict';

// AES-256-GCM for API keys and OAuth tokens stored as iv:authTag:ciphertext.
// Encrypt always uses ENCRYPTION_KEY. Decrypt tries that key first, then
// ENCRYPTION_KEY_PREVIOUS, so a rotation does not make existing rows unreadable.
// Never log key material or plaintext.

const crypto = require('crypto');
const { problemWithSecret } = require('./startupSecrets.cjs');

const CIPHER_RE = /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/i;

function keyBuffer(name, value) {
  const problem = problemWithSecret(name, value, { minLength: 64, hex: true });
  if (problem) return null;
  return Buffer.from(String(value).trim(), 'hex');
}

function currentKey(env = process.env) {
  const key = keyBuffer('ENCRYPTION_KEY', env.ENCRYPTION_KEY);
  if (!key) {
    throw new Error(problemWithSecret('ENCRYPTION_KEY', env.ENCRYPTION_KEY, { minLength: 64, hex: true }));
  }
  return key;
}

function previousKey(env = process.env) {
  const raw = env.ENCRYPTION_KEY_PREVIOUS;
  if (raw == null || String(raw).trim() === '') return null;
  const key = keyBuffer('ENCRYPTION_KEY_PREVIOUS', raw);
  if (!key) return null;
  const current = keyBuffer('ENCRYPTION_KEY', env.ENCRYPTION_KEY);
  if (current && key.equals(current)) return null;
  return key;
}

function encryptWithKey(rawKey, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(rawKey), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${body.toString('hex')}`;
}

function decryptWithKey(encrypted, key) {
  const parts = String(encrypted).split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted key format');
  const [ivHex, authTagHex, ciphertext] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

function encryptApiKey(rawKey, env = process.env) {
  if (!rawKey) return null;
  return encryptWithKey(rawKey, currentKey(env));
}

function decryptApiKey(encrypted, env = process.env) {
  if (!encrypted) return null;
  const keys = [currentKey(env)];
  const prev = previousKey(env);
  if (prev) keys.push(prev);
  let lastErr = null;
  for (const key of keys) {
    try {
      return decryptWithKey(encrypted, key);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Unable to decrypt');
}

module.exports = {
  CIPHER_RE,
  currentKey,
  previousKey,
  encryptWithKey,
  decryptWithKey,
  encryptApiKey,
  decryptApiKey,
};
