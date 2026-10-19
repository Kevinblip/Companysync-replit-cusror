'use strict';

// Staging-only login bootstrap. Railway staging cannot be reached from outside,
// so the process ensures one email/password admin after the database connects.
// It runs only when STAGING is on and all three bootstrap env vars are set.
// The hash is never written to the log.

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

function stagingEnabled(env) {
  const raw = env && env.STAGING;
  if (raw == null) return false;
  const value = String(raw).trim();
  if (!value) return false;
  return !/^(0|false|no|off)$/i.test(value);
}

function splitName(raw) {
  const fullName = String(raw || '').trim() || 'Kevin';
  const parts = fullName.split(/\s+/);
  return {
    fullName,
    firstName: parts[0] || 'Kevin',
    lastName: parts.slice(1).join(' '),
  };
}

function bootstrapConfig(env = process.env) {
  if (!stagingEnabled(env)) return null;
  const email = String(env.STAGING_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const hash = String(env.STAGING_BOOTSTRAP_ADMIN_HASH || '').trim();
  const companyId = String(env.STAGING_BOOTSTRAP_COMPANY_ID || '').trim();
  if (!email || !hash || !companyId || !email.includes('@')) return null;
  if (!BCRYPT_HASH.test(hash)) return { invalidHash: true };
  const name = splitName(env.STAGING_BOOTSTRAP_ADMIN_NAME);
  return { email, hash, companyId, ...name };
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function usersHaveCompanyId(pool) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'users'
        AND column_name = 'company_id'
      LIMIT 1`
  );
  return rows.length > 0;
}

async function ensureUser(pool, config) {
  const hasCompanyId = await usersHaveCompanyId(pool);
  const existing = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [config.email]
  );
  if (existing.rows.length > 0) {
    if (hasCompanyId) {
      await pool.query(
        `UPDATE users
            SET password_hash = $1, is_local_auth = true, company_id = $2, updated_at = NOW()
          WHERE LOWER(email) = $3`,
        [config.hash, config.companyId, config.email]
      );
    } else {
      await pool.query(
        `UPDATE users
            SET password_hash = $1, is_local_auth = true, updated_at = NOW()
          WHERE LOWER(email) = $2`,
        [config.hash, config.email]
      );
    }
    return;
  }
  // Same columns as a local signup in db/local-auth.cjs. first_name/last_name
  // carry the display name; users has no full_name column.
  const id = newId('loc');
  if (hasCompanyId) {
    await pool.query(
      `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, false, $6, NOW(), NOW())`,
      [id, config.email, config.firstName, config.lastName, config.hash, config.companyId]
    );
    return;
  }
  await pool.query(
    `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, true, false, NOW(), NOW())`,
    [id, config.email, config.firstName, config.lastName, config.hash]
  );
}

async function ensureStaff(pool, config) {
  const existing = await pool.query(
    `SELECT id FROM staff_profiles
      WHERE company_id = $1
        AND LOWER(COALESCE(user_email, '')) = $2
      ORDER BY created_at ASC NULLS LAST
      LIMIT 1`,
    [config.companyId, config.email]
  );
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE staff_profiles
          SET email = $1,
              user_email = $2,
              full_name = $3,
              name = $3,
              is_active = true,
              is_administrator = true,
              updated_at = NOW()
        WHERE id = $4 AND company_id = $5`,
      [config.email, config.email, config.fullName, existing.rows[0].id, config.companyId]
    );
    return;
  }
  // Local signup inserts email, user_email, role admin, is_administrator, is_active.
  // full_name and name match the platform staff seed so Team Chat can show a name.
  await pool.query(
    `INSERT INTO staff_profiles (id, company_id, name, full_name, email, user_email, role, is_administrator, is_super_admin, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $3, $4, $4, 'admin', true, false, true, NOW(), NOW())`,
    [newId('staff'), config.companyId, config.fullName, config.email]
  );
}

async function ensureStagingBootstrapAdmin(pool, env = process.env, log = console) {
  const config = bootstrapConfig(env);
  if (!config) return { ran: false };
  if (config.invalidHash) {
    log.warn('[staging-bootstrap] admin hash is not a bcrypt hash; skipped');
    return { ran: false, reason: 'bad-hash' };
  }
  try {
    if (!pool || typeof pool.query !== 'function') throw new Error('database pool is not ready');
    await ensureUser(pool, config);
    await ensureStaff(pool, config);
    log.log(`[staging-bootstrap] admin ensured for ${config.email}`);
    return { ran: true, email: config.email };
  } catch (err) {
    const hash = String(env.STAGING_BOOTSTRAP_ADMIN_HASH || '');
    const message = String(err && err.message ? err.message : err);
    const safe = hash ? message.split(hash).join('[redacted]') : message;
    log.warn('[staging-bootstrap] failed:', safe.slice(0, 200));
    return { ran: false, error: 'failed' };
  }
}

module.exports = {
  ensureStagingBootstrapAdmin,
  bootstrapConfig,
  stagingEnabled,
};
