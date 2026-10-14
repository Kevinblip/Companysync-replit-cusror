'use strict';

// Seed a platform super-admin only when none exists. Never updates an existing
// user, and never embeds a password hash in source.
async function ensureSuperAdmin(pool, env = process.env) {
  let existing;
  try {
    existing = await pool.query(
      `SELECT 1 FROM users WHERE platform_role = 'super_admin' LIMIT 1`,
    );
  } catch (err) {
    console.warn('[Init] Super-admin lookup skipped:', err.message);
    return { seeded: false, reason: 'lookup-failed' };
  }
  if (existing.rows.length > 0) return { seeded: false, reason: 'exists' };

  const email = String(env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(env.SUPER_ADMIN_PASSWORD || '');
  if (!email || password.length < 12) {
    console.error('[Init] No super-admin exists. Set SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD (12+ characters) to create one. Existing accounts are left unchanged.');
    return { seeded: false, reason: 'missing-env' };
  }

  const already = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
    [email],
  );
  if (already.rows.length > 0) {
    console.error('[Init] SUPER_ADMIN_EMAIL already belongs to a user. Not changing that password or role.');
    return { seeded: false, reason: 'email-taken' };
  }

  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash(password, 12);
  const id = `user_super_admin_${Date.now().toString(36)}`;
  await pool.query(
    `INSERT INTO users (id, email, first_name, last_name, password_hash, is_local_auth, must_change_password, company_id, platform_role, created_at, updated_at)
     VALUES ($1, $2, 'Platform', 'Admin', $3, true, true, 'companysync_master_001', 'super_admin', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [id, email, hash],
  );
  console.log('[Init] Seeded a new super-admin from SUPER_ADMIN_EMAIL. They must change the password on first login.');
  return { seeded: true, reason: 'created' };
}

module.exports = { ensureSuperAdmin };
