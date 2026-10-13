#!/usr/bin/env node
// ============================================================
// Unit tests for lib/staffVoiceAuth.cjs — staff phone-call PIN auth.
// Uses the dev database (DATABASE_URL) with self-cleaning fixtures.
// Run: node scripts/test-staff-voice-auth.cjs
// ============================================================
'use strict';

const crypto = require('crypto');
const { createPool } = require('./lib/db-pool.cjs');
const {
  findStaffByCallerPhone,
  verifyPinAttempt,
  hashPin,
  redactPinDigits,
  MAX_FAILED_ATTEMPTS,
} = require('../lib/staffVoiceAuth.cjs');

const pool = createPool({ connectionString: process.env.DATABASE_URL });

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.error(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}

const RUN_ID = crypto.randomBytes(4).toString('hex');
const COMPANY_ID = `test_sva_co_${RUN_ID}`;
const OTHER_COMPANY_ID = `test_sva_co2_${RUN_ID}`;
const STAFF_PIN = `test_sva_staff_pin_${RUN_ID}`;
const STAFF_NOPIN = `test_sva_staff_nopin_${RUN_ID}`;
const STAFF_INACTIVE = `test_sva_staff_inactive_${RUN_ID}`;
const CELL_PIN = '+15559871234';
const CELL_NOPIN = '+15559875678';
const CELL_INACTIVE = '+15559870000';
const PIN = '4271';
const SALT = crypto.randomBytes(16).toString('hex');

async function setup() {
  await pool.query(
    `INSERT INTO companies (id, name, data, created_by) VALUES ($1, 'SVA Test Co', $2::jsonb, 'sva-test@example.com')`,
    [COMPANY_ID, JSON.stringify({ timezone: 'America/Chicago' })]
  );
  await pool.query(
    `INSERT INTO companies (id, name, data, created_by) VALUES ($1, 'SVA Other Co', '{}'::jsonb, 'sva-test@example.com')`,
    [OTHER_COMPANY_ID]
  );
  await pool.query(
    `INSERT INTO staff_profiles (id, company_id, full_name, user_email, cell_phone, is_active, data)
     VALUES ($1, $2, 'Pin Person', 'pin@example.com', $3, true, $4::jsonb)`,
    [STAFF_PIN, COMPANY_ID, CELL_PIN, JSON.stringify({ voice_pin_salt: SALT, voice_pin_hash: hashPin(PIN, SALT) })]
  );
  await pool.query(
    `INSERT INTO staff_profiles (id, company_id, full_name, user_email, cell_phone, is_active, data)
     VALUES ($1, $2, 'NoPin Person', 'nopin@example.com', $3, true, '{}'::jsonb)`,
    [STAFF_NOPIN, COMPANY_ID, CELL_NOPIN]
  );
  await pool.query(
    `INSERT INTO staff_profiles (id, company_id, full_name, user_email, cell_phone, is_active, data)
     VALUES ($1, $2, 'Inactive Person', 'inactive@example.com', $3, false, $4::jsonb)`,
    [STAFF_INACTIVE, COMPANY_ID, CELL_INACTIVE, JSON.stringify({ voice_pin_salt: SALT, voice_pin_hash: hashPin(PIN, SALT) })]
  );
}

async function cleanup() {
  await pool.query(`DELETE FROM staff_profiles WHERE id LIKE $1`, [`test_sva_staff_%_${RUN_ID}`]);
  await pool.query(`DELETE FROM companies WHERE id LIKE $1`, [`test_sva_co%_${RUN_ID}`]);
}

async function main() {
  console.log('== staffVoiceAuth tests ==');
  await setup();
  try {
    // --- findStaffByCallerPhone ---
    const hit = await findStaffByCallerPhone(pool, COMPANY_ID, CELL_PIN);
    check('matches staff with PIN by exact cell', !!hit && hit.staffId === STAFF_PIN);
    check('returns staff email + name + tz', hit && hit.userEmail === 'pin@example.com' && hit.fullName === 'Pin Person' && hit.timezone === 'America/Chicago');

    const hitFmt = await findStaffByCallerPhone(pool, COMPANY_ID, '(555) 987-1234');
    check('matches on normalized formats', !!hitFmt && hitFmt.staffId === STAFF_PIN);

    const noPin = await findStaffByCallerPhone(pool, COMPANY_ID, CELL_NOPIN);
    check('staff WITHOUT a PIN never enters staff mode', noPin === null);

    const inactive = await findStaffByCallerPhone(pool, COMPANY_ID, CELL_INACTIVE);
    check('inactive staff never matches', inactive === null);

    const wrongCo = await findStaffByCallerPhone(pool, OTHER_COMPANY_ID, CELL_PIN);
    check('no cross-company match', wrongCo === null);

    const unknown = await findStaffByCallerPhone(pool, COMPANY_ID, '+15550001111');
    check('unknown caller returns null', unknown === null);

    const shortNum = await findStaffByCallerPhone(pool, COMPANY_ID, '1234');
    check('short/garbage caller id returns null', shortNum === null);

    // --- verifyPinAttempt ---
    const bad = await verifyPinAttempt(pool, STAFF_PIN, '9999');
    check('wrong PIN rejected', bad.ok === false && bad.locked === false);
    check('wrong PIN decrements attempts', bad.attemptsLeft === MAX_FAILED_ATTEMPTS - 1);

    const good = await verifyPinAttempt(pool, STAFF_PIN, PIN);
    check('correct PIN verifies', good.ok === true);

    const afterGood = await pool.query(`SELECT data FROM staff_profiles WHERE id = $1`, [STAFF_PIN]);
    check('success resets failed counter', (afterGood.rows[0].data.voice_pin_failed_count || 0) === 0);

    const spoken = await verifyPinAttempt(pool, STAFF_PIN, '4-2-7-1');
    check('PIN with separators (spoken transcription) verifies', spoken.ok === true);

    // --- lockout ---
    let last;
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      last = await verifyPinAttempt(pool, STAFF_PIN, '0000');
    }
    check(`locks after ${MAX_FAILED_ATTEMPTS} consecutive failures`, last.locked === true && !!last.lockedUntil);

    const whileLocked = await verifyPinAttempt(pool, STAFF_PIN, PIN);
    check('correct PIN rejected while locked', whileLocked.ok === false && whileLocked.locked === true);

    // expire the lock manually → correct PIN works again
    await pool.query(
      `UPDATE staff_profiles SET data = data || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ voice_pin_locked_until: new Date(Date.now() - 1000).toISOString() }), STAFF_PIN]
    );
    const afterExpiry = await verifyPinAttempt(pool, STAFF_PIN, PIN);
    check('lock expiry restores access with correct PIN', afterExpiry.ok === true);

    const missing = await verifyPinAttempt(pool, 'no_such_staff_id', PIN);
    check('unknown staff id rejected', missing.ok === false);

    // --- redaction ---
    check('redacts contiguous digit runs', !redactPinDigits('my pin is 4271 ok').includes('4271'));
    check('redacts spaced digits', !redactPinDigits('it is 4 2 7 1 thanks').includes('4 2 7 1'));
    check('redacts dashed digits', !redactPinDigits('4-2-7-1').includes('4-2-7-1'));
    check('leaves normal text alone', redactPinDigits('call me back tomorrow') === 'call me back tomorrow');
    check('leaves 1-2 digit numbers alone', redactPinDigits('I need 2 quotes') === 'I need 2 quotes');
  } finally {
    await cleanup();
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error('Test run crashed:', e);
  try { await cleanup(); } catch (_) {}
  try { await pool.end(); } catch (_) {}
  process.exit(1);
});
