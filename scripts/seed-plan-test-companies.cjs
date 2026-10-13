#!/usr/bin/env node
/**
 * Seed Plan-Tier Test Companies (idempotent)
 * ───────────────────────────────────────────
 * Creates (or updates) one company + admin login for each subscription tier:
 *
 *   Basic      test@basic.test      / Test1234!
 *   Business   test@business.test   / Test1234!
 *   Enterprise test@enterprise.test / Test1234!
 *
 * Safe to re-run at any time — all upserts use stable IDs.
 * Does NOT clean up; the companies are persistent test fixtures.
 *
 * Usage:  node scripts/seed-plan-test-companies.cjs
 *         npm run seed:plan-companies
 */

'use strict';

const { createPool } = require('./lib/db-pool.cjs');
const bcrypt   = require('bcryptjs');

const pool = createPool({ connectionString: process.env.DATABASE_URL });
const PASSWORD = 'Test1234!';

// Mirrors SUBSCRIPTION_LIMITS from src/components/SubscriptionGate.jsx
// max_customers lives in features_enabled JSONB (not a dedicated column)
const PLANS = [
  {
    id:            'plan_test_basic',
    company_name:  '[TEST] Basic Plan Company',
    email:         'plan-test-basic@example.com',
    plan:          'basic',
    max_users:     5,
    max_leads:     250,
    max_customers: 100,       // stored in features_enabled JSONB
    ai_queries:    1000,      // stored in features_enabled JSONB
    user_email:    'test@basic.test',
    user_name:     'Basic Tester',
    userId:        'plan_test_user_basic',
    staffId:       'plan_test_staff_basic',
  },
  {
    id:            'plan_test_business',
    company_name:  '[TEST] Business Plan Company',
    email:         'plan-test-business@example.com',
    plan:          'business',
    max_users:     10,
    max_leads:     null,      // unlimited
    max_customers: 1000,
    ai_queries:    10000,
    user_email:    'test@business.test',
    user_name:     'Business Tester',
    userId:        'plan_test_user_business',
    staffId:       'plan_test_staff_business',
  },
  {
    id:            'plan_test_enterprise',
    company_name:  '[TEST] Enterprise Plan Company',
    email:         'plan-test-enterprise@example.com',
    plan:          'enterprise',
    max_users:     25,
    max_leads:     null,      // unlimited
    max_customers: null,      // unlimited
    ai_queries:    null,      // unlimited
    user_email:    'test@enterprise.test',
    user_name:     'Enterprise Tester',
    userId:        'plan_test_user_enterprise',
    staffId:       'plan_test_staff_enterprise',
  },
];

(async () => {
  try {
    console.log('\n── Seed Plan-Tier Test Companies ──────────────────────────────\n');

    const passwordHash = await bcrypt.hash(PASSWORD, 10);

    for (const p of PLANS) {
      const featEnabled = JSON.stringify({
        max_customers:     p.max_customers,
        ai_queries_monthly: p.ai_queries,
      });

      // ── 1. Upsert company ────────────────────────────────────────────────
      await pool.query(`
        INSERT INTO companies
          (id, company_name, email, subscription_plan, subscription_status,
           max_users, max_leads, features_enabled, onboarding_completed,
           created_by, created_at, updated_at)
        VALUES ($1,$2,$3,$4,'active',$5,$6,$7::jsonb,true,$8,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          company_name        = EXCLUDED.company_name,
          subscription_plan   = EXCLUDED.subscription_plan,
          subscription_status = 'active',
          max_users           = EXCLUDED.max_users,
          max_leads           = EXCLUDED.max_leads,
          features_enabled    = EXCLUDED.features_enabled,
          onboarding_completed = true,
          updated_at          = NOW()
      `, [p.id, p.company_name, p.email, p.plan, p.max_users, p.max_leads, featEnabled, p.user_email]);

      // ── 2. Upsert user (handle email already existing under a different id) ──
      const existingUser = await pool.query(
        `SELECT id FROM users WHERE email = $1`, [p.user_email]
      );
      if (existingUser.rows.length > 0) {
        // Update in-place — preserve the existing user id
        await pool.query(`
          UPDATE users SET
            password_hash       = $1,
            is_local_auth       = true,
            must_change_password = false,
            company_id          = $2,
            updated_at          = NOW()
          WHERE email = $3
        `, [passwordHash, p.id, p.user_email]);
      } else {
        const [firstName, ...rest] = p.user_name.split(' ');
        const lastName = rest.join(' ') || 'User';
        await pool.query(`
          INSERT INTO users
            (id, email, first_name, last_name, password_hash,
             is_local_auth, must_change_password, company_id, created_at, updated_at)
          VALUES ($1,$2,$3,$4,$5,true,false,$6,NOW(),NOW())
          ON CONFLICT (id) DO UPDATE SET
            email               = EXCLUDED.email,
            password_hash       = EXCLUDED.password_hash,
            is_local_auth       = true,
            must_change_password = false,
            company_id          = EXCLUDED.company_id,
            updated_at          = NOW()
        `, [p.userId, p.user_email, firstName, lastName, passwordHash, p.id]);
      }

      // ── 3. Upsert staff profile ──────────────────────────────────────────
      await pool.query(`
        INSERT INTO staff_profiles
          (id, company_id, full_name, name, email, user_email, role,
           is_administrator, is_active, created_at, updated_at)
        VALUES ($1,$2,$3,$3,$4,$4,'admin',true,true,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          company_id       = EXCLUDED.company_id,
          full_name        = EXCLUDED.full_name,
          email            = EXCLUDED.email,
          user_email       = EXCLUDED.user_email,
          is_administrator = true,
          is_active        = true,
          updated_at       = NOW()
      `, [p.staffId, p.id, p.user_name, p.user_email]);

      const limits = [
        `${p.max_users ?? '∞'} users`,
        `${p.max_customers ?? '∞'} customers`,
        `${p.max_leads ?? '∞'} leads`,
      ].join(' · ');

      console.log(`✓ ${p.plan.toUpperCase().padEnd(10)} ${p.company_name}`);
      console.log(`  Login : ${p.user_email} / ${PASSWORD}`);
      console.log(`  Limits: ${limits}\n`);
    }

    console.log('─────────────────────────────────────────────────────────────');
    console.log('All three plan-tier test companies are ready.');
    console.log('Run `npm run test:plan-gates` to verify feature access rules.');
    console.log('');

  } catch (err) {
    console.error('✗ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
