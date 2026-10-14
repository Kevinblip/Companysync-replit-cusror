'use strict';

// Fail closed when production boots with a missing or placeholder secret.
// Callers must never log the secret value itself.

const PLACEHOLDER = /paste_from_replit|changeme|placeholder|your[-_]?secret|replace[-_]?me|^todo$|^xxx+$|^secret$|^password$/i; // pragma: allowlist secret

function problemWithSecret(name, value, { minLength = 32, hex = false } = {}) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return `${name} is not set`;
  if (PLACEHOLDER.test(raw)) return `${name} is still a placeholder`;
  if (raw.length < minLength) return `${name} is too short`;
  if (hex && !/^[0-9a-f]{64}$/i.test(raw)) return `${name} must be a 64-character hex string`;
  return null;
}

function isProductionEnv(env = process.env) {
  return env.NODE_ENV === 'production' || env.REPLIT_DEPLOYMENT === '1';
}

function collectStartupSecretProblems(env = process.env) {
  return [
    problemWithSecret('SESSION_SECRET', env.SESSION_SECRET),
    problemWithSecret('ENCRYPTION_KEY', env.ENCRYPTION_KEY, { minLength: 64, hex: true }),
  ].filter(Boolean);
}

/**
 * In production, exit the process when SESSION_SECRET or ENCRYPTION_KEY is
 * missing, too short, or still a placeholder such as PASTE_FROM_REPLIT. // pragma: allowlist secret
 * Other environments log a warning and keep running so local preview can boot.
 */
function assertStartupSecrets({ env = process.env, exit = true, log = console } = {}) {
  const problems = collectStartupSecretProblems(env);
  if (!problems.length) return { ok: true, problems: [], fatal: false };
  const message = `[startup] Unsafe secrets: ${problems.join('; ')}. Set them in the host secret store. There is no built-in default.`;
  const fatal = isProductionEnv(env);
  if (fatal) {
    log.error(message);
    if (exit) process.exit(1);
  } else {
    log.warn(message);
  }
  return { ok: false, problems, fatal };
}

function requireEncryptionKey(env = process.env) {
  const problem = problemWithSecret('ENCRYPTION_KEY', env.ENCRYPTION_KEY, { minLength: 64, hex: true });
  if (problem) throw new Error(problem);
  return Buffer.from(String(env.ENCRYPTION_KEY).trim(), 'hex');
}

module.exports = {
  problemWithSecret,
  isProductionEnv,
  collectStartupSecretProblems,
  assertStartupSecrets,
  requireEncryptionKey,
};
