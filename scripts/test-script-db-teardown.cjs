#!/usr/bin/env node
/**
 * Script DB Teardown Test
 * ──────────────────────────────────────────────────────────────────────────
 * Regression guard for: "the app won't start" caused by an abandoned test
 * script, not by application code.
 *
 * A script that opened a transaction touching generic_entities and then died
 * used to leave its backend session alive, still holding RowExclusiveLock.
 * The dev server's startup schema check then queued behind that lock forever:
 * vite initialized normally but never opened port 5000.
 *
 * Tests:
 *   A) Pools from scripts/lib/db-pool.cjs carry server-side session timeouts
 *      and an identifying application_name.
 *   B) A killed script (SIGTERM) rolls back its open transaction and closes
 *      its session, so the lock is released immediately.
 *   C) A script that dies without any chance to clean up (SIGKILL) still has
 *      its session reaped by idle_in_transaction_session_timeout, so the lock
 *      cannot be held indefinitely.
 *   D) A pool the script did not construct (handed out by a shared db/ module)
 *      picks up the same guards, including on connections opened before it was
 *      adopted.
 *   E) With several pools each holding an open transaction, shutdown rolls back
 *      ALL of them and completes on its own — it does not stall on one pool's
 *      drain and fall through to the socket-destroy backstop.
 *   F) A pool the script never sees — one built privately by an imported server
 *      module — is guarded and torn down like any other.
 *
 * Prerequisites:
 *   - DATABASE_URL set (dev server does NOT need to be running)
 *
 * Usage:  node scripts/test-script-db-teardown.cjs
 */
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const { Pool } = require('pg');
const { createPool, adoptPool, closeAllPools, isAdopted } = require('./lib/db-pool.cjs');

const argValue = (flag) => process.argv[process.argv.indexOf(flag) + 1];

/** Open a transaction that holds RowExclusiveLock on generic_entities. */
async function holdLock(pool, rowId) {
  const client = await pool.connect();
  await client.query('BEGIN');
  // An INSERT takes RowExclusiveLock on the table. It is never committed, so
  // nothing is ever written — the point is only to hold the lock.
  await client.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, 'ScriptTeardownProbe', 'smoke_teardown_company', '{}'::jsonb, NOW(), NOW())`,
    [rowId]
  );
  return client;
}

// ── Child mode: hold a lock, then hang until the parent kills us ───────────
if (process.argv.includes('--hold-lock-child')) {
  const appName = argValue('--app-name');
  const rowId = argValue('--row-id');

  (async () => {
    // --via-raw-pg builds the pool the way an imported server module does:
    // straight off the `pg` export, with no knowledge of this helper.
    const pool = process.argv.includes('--via-raw-pg')
      ? new (require('pg').Pool)({
          connectionString: process.env.DATABASE_URL,
          application_name: appName,
          max: 1,
        })
      : createPool({ application_name: appName, max: 1 });
    await holdLock(pool, rowId);
    console.log('READY');
    // Hang forever; the parent decides how this process dies.
    setInterval(() => {}, 1000);
  })().catch((err) => {
    console.error('CHILD_ERROR', err.message);
    process.exit(1);
  });
  return;
}

// ── Child mode: two pools, each with an open transaction, closed gracefully ─
// Stays alive after closing so the parent can prove the pools were drained by
// closeAllPools() itself — not by the socket destroy that runs on exit.
if (process.argv.includes('--close-pools-child')) {
  const appA = argValue('--app-a');
  const appB = argValue('--app-b');

  (async () => {
    const poolA = createPool({ application_name: appA, max: 1 });
    const poolB = createPool({ application_name: appB, max: 1 });
    await holdLock(poolA, `smoke_teardown_${crypto.randomUUID().slice(0, 8)}`);
    await holdLock(poolB, `smoke_teardown_${crypto.randomUUID().slice(0, 8)}`);
    console.log('READY');

    process.stdin.on('data', () => {
      const startedAt = Date.now();
      closeAllPools().then(() => {
        console.log(`CLOSED ${Date.now() - startedAt}`);
      }).catch((err) => {
        console.error('CHILD_ERROR', err.message);
        process.exit(1);
      });
    });
    process.stdin.resume();
    setInterval(() => {}, 1000);
  })().catch((err) => {
    console.error('CHILD_ERROR', err.message);
    process.exit(1);
  });
  return;
}

// ── Parent mode ────────────────────────────────────────────────────────────
const pool = createPool();

let passed = 0, failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✅ PASS  ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    console.error(`  ❌ FAIL  ${msg}`);
    failures.push(msg);
    failed++;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** How many backends are alive under this application_name. */
async function sessionCount(appName) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1`,
    [appName]
  );
  return rows[0].n;
}

/** Does any backend hold a lock on generic_entities under this app name? */
async function holdsEntityLock(appName) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE a.application_name = $1
        AND l.relation = 'generic_entities'::regclass
        AND l.granted`,
    [appName]
  );
  return rows[0].n > 0;
}

/** Poll until the predicate is true or the budget runs out. */
async function waitFor(fn, budgetMs, stepMs = 500) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(stepMs);
  }
}

/** Spawn a child mode of this file and resolve once it reports READY. */
function spawnChild(args, env = {}) {
  const child = spawn(process.execPath, [__filename, ...args], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdoutText = '';
  child.stdout.on('data', (buf) => { child.stdoutText += buf.toString(); });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child never reported READY')), 30000);
    let stderr = '';
    const onData = () => {
      if (child.stdoutText.includes('READY')) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (buf) => { stderr += buf.toString(); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`child exited early (code ${code}) ${stderr.trim()}`));
    });
  });
}

function spawnLockHolder(appName, rowId, env = {}) {
  return spawnChild(['--hold-lock-child', '--app-name', appName, '--row-id', rowId], env);
}

/** Wait until the child prints a line matching the pattern. */
function waitForOutput(child, pattern, budgetMs = 30000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const m = child.stdoutText.match(pattern);
      if (m) { cleanup(); resolve(m); }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`child never printed ${pattern}`));
    }, budgetMs);
    const cleanup = () => { clearTimeout(timer); child.stdout.off('data', check); };
    child.stdout.on('data', check);
    check();
  });
}

async function cleanupProbeRows() {
  try {
    await pool.query(`DELETE FROM generic_entities WHERE entity_type = 'ScriptTeardownProbe'`);
  } catch (e) {
    console.warn('[cleanup] warning:', e.message);
  }
}

async function run() {
  console.log('\n🔒  Script DB Teardown Test\n');

  try {
    await cleanupProbeRows();

    // ── Test A: session guards are applied to every connection ─────────────
    console.log('─── Test A: pooled connections carry session guards ───');
    const guarded = createPool({
      application_name: 'script:teardown-probe-settings',
      statementTimeoutMs: 45000,
      lockTimeoutMs: 7000,
      idleInTransactionTimeoutMs: 9000,
      max: 1,
    });
    try {
      const { rows } = await guarded.query(
        `SELECT current_setting('statement_timeout') AS st,
                current_setting('lock_timeout') AS lt,
                current_setting('idle_in_transaction_session_timeout') AS it,
                current_setting('application_name') AS an`
      );
      const s = rows[0];
      ok('statement_timeout is set on the connection', s.st === '45s', `got ${s.st}`);
      ok('lock_timeout is set on the connection', s.lt === '7s', `got ${s.lt}`);
      ok('idle_in_transaction_session_timeout is set on the connection', s.it === '9s', `got ${s.it}`);
      ok('application_name identifies the script', s.an === 'script:teardown-probe-settings', `got ${s.an}`);
    } finally {
      await guarded.end();
    }

    // Default pools must be guarded too — that is what unmodified scripts get.
    const { rows: defRows } = await pool.query(
      `SELECT current_setting('idle_in_transaction_session_timeout') AS it,
              current_setting('application_name') AS an`
    );
    ok('default pool has a non-zero idle-in-transaction timeout',
      defRows[0].it !== '0', `got ${defRows[0].it}`);
    ok('default pool names the running script',
      defRows[0].an === 'script:test-script-db-teardown.cjs', `got ${defRows[0].an}`);

    // ── Test B: a killed script releases its lock right away ───────────────
    console.log('\n─── Test B: SIGTERM rolls back the open transaction ───');
    const appB = `script:teardown-probe-${crypto.randomUUID().slice(0, 8)}`;
    const childB = await spawnLockHolder(appB, `smoke_teardown_${crypto.randomUUID().slice(0, 8)}`);

    ok('child holds a lock on generic_entities before it is killed',
      await holdsEntityLock(appB));

    const exitedB = new Promise((resolve) => childB.on('exit', resolve));
    childB.kill('SIGTERM');
    await exitedB;

    const releasedB = await waitFor(async () => (await sessionCount(appB)) === 0, 15000);
    ok('SIGTERM closed the session, releasing the lock immediately',
      releasedB, 'session still alive 15s after SIGTERM');

    // ── Test C: an unkillable-cleanup death is still reaped by the timeout ──
    console.log('\n─── Test C: SIGKILL leaves nothing holding the lock ───');
    const appC = `script:teardown-probe-${crypto.randomUUID().slice(0, 8)}`;
    const childC = await spawnLockHolder(
      appC,
      `smoke_teardown_${crypto.randomUUID().slice(0, 8)}`,
      // Shorten the guard so the test does not have to wait out the real one.
      { SCRIPT_IDLE_TX_TIMEOUT_MS: '2000' }
    );

    ok('child holds a lock on generic_entities before it is killed',
      await holdsEntityLock(appC));

    const exitedC = new Promise((resolve) => childC.on('exit', resolve));
    childC.kill('SIGKILL');
    await exitedC;

    const releasedC = await waitFor(async () => !(await holdsEntityLock(appC)), 30000);
    ok('a SIGKILLed script cannot hold the lock indefinitely',
      releasedC, 'lock still held 30s after SIGKILL');

    // ── Test D: a pool this helper did not construct is guarded too ─────────
    console.log('\n─── Test D: an adopted (shared-module) pool gets the same guards ───');
    const appD = 'script:teardown-probe-adopted';
    const raw = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    try {
      // Open a connection BEFORE adopting, the way a shared db/ module hands
      // out a pool that has already served queries.
      await raw.query('SELECT 1');
      const beforeAdopt = await raw.query(
        `SELECT current_setting('statement_timeout') AS st,
                current_setting('idle_in_transaction_session_timeout') AS it`
      );
      // The server default is permissive (no statement limit, an hour of idle
      // transaction) — long enough to block a dev-server start indefinitely.
      ok('an unguarded pool runs with the permissive server defaults',
        beforeAdopt.rows[0].st === '0' && beforeAdopt.rows[0].it !== '8s',
        `got statement_timeout=${beforeAdopt.rows[0].st}, idle_in_transaction=${beforeAdopt.rows[0].it}`);

      adoptPool(raw, {
        applicationName: appD,
        statementTimeoutMs: 41000,
        lockTimeoutMs: 6000,
        idleInTransactionTimeoutMs: 8000,
      });

      const { rows: adopted } = await raw.query(
        `SELECT current_setting('statement_timeout') AS st,
                current_setting('lock_timeout') AS lt,
                current_setting('idle_in_transaction_session_timeout') AS it,
                current_setting('application_name') AS an`
      );
      ok('adopting retrofits the guards onto an already-open connection',
        adopted[0].st === '41s' && adopted[0].lt === '6s' && adopted[0].it === '8s',
        `got ${adopted[0].st}/${adopted[0].lt}/${adopted[0].it}`);
      ok('adopting tags the connection with the script name',
        adopted[0].an === appD, `got ${adopted[0].an}`);
    } finally {
      await raw.end();
    }

    // ── Test E: several open transactions all get rolled back on shutdown ───
    console.log('\n─── Test E: shutdown drains every pool, not just the first ───');
    const appE1 = `script:teardown-probe-${crypto.randomUUID().slice(0, 8)}`;
    const appE2 = `script:teardown-probe-${crypto.randomUUID().slice(0, 8)}`;
    const childE = await spawnChild(['--close-pools-child', '--app-a', appE1, '--app-b', appE2]);

    ok('both pools hold a lock before shutdown',
      (await holdsEntityLock(appE1)) && (await holdsEntityLock(appE2)));

    childE.stdin.write('CLOSE\n');
    const [, elapsedRaw] = await waitForOutput(childE, /CLOSED (\d+)/, 30000);
    const elapsed = Number(elapsedRaw);

    ok('shutdown completed without falling through to the deadline',
      elapsed < 5000, `closeAllPools() took ${elapsed}ms`);
    ok('the child is still running, so nothing was closed by exit-time cleanup',
      childE.exitCode === null && childE.signalCode === null);
    ok('the first pool released its transaction', (await sessionCount(appE1)) === 0);
    ok('the second pool released its transaction too', (await sessionCount(appE2)) === 0);

    childE.kill('SIGKILL');

    // ── Test F: a pool built privately by an imported module is covered ─────
    console.log('\n─── Test F: a pool an imported module builds for itself is guarded ───');
    const appF = 'script:teardown-probe-indirect';
    // Exactly how a vite-*-plugin builds its own pool: straight off the `pg`
    // export, with no knowledge that a script is driving it.
    const indirect = new (require('pg').Pool)({
      connectionString: process.env.DATABASE_URL,
      application_name: appF,
      max: 1,
    });
    try {
      ok('an inherited pool is adopted the moment it is constructed', isAdopted(indirect));
      const { rows: ind } = await indirect.query(
        `SELECT current_setting('statement_timeout') AS st,
                current_setting('lock_timeout') AS lt,
                current_setting('idle_in_transaction_session_timeout') AS it,
                current_setting('application_name') AS an`
      );
      ok('an inherited pool gets the session guards',
        ind[0].st !== '0' && ind[0].lt !== '0' && ind[0].it !== '0',
        `got ${ind[0].st}/${ind[0].lt}/${ind[0].it}`);
      ok('an inherited pool keeps the application_name its owner chose',
        ind[0].an === appF, `got ${ind[0].an}`);
    } finally {
      await indirect.end();
    }

    const appF2 = `script:teardown-probe-${crypto.randomUUID().slice(0, 8)}`;
    const childF = await spawnChild([
      '--hold-lock-child', '--via-raw-pg', '--app-name', appF2,
      '--row-id', `smoke_teardown_${crypto.randomUUID().slice(0, 8)}`,
    ]);
    ok('the inherited pool holds a lock before the kill', await holdsEntityLock(appF2));
    childF.kill('SIGTERM');
    ok('SIGTERM rolls back a transaction held on an inherited pool',
      await waitFor(async () => (await sessionCount(appF2)) === 0, 15000));

    // Nothing the probe did may ever be committed.
    const { rows: leftovers } = await pool.query(
      `SELECT count(*)::int AS n FROM generic_entities WHERE entity_type = 'ScriptTeardownProbe'`
    );
    ok('no probe rows were ever committed', leftovers[0].n === 0, `found ${leftovers[0].n}`);

  } finally {
    await cleanupProbeRows();
    await pool.end();
  }

  console.log('\n─────────────────────────────────────────');
  if (failed === 0) {
    console.log(`✅  All ${passed} tests passed`);
    process.exit(0);
  } else {
    console.error(`❌  ${failed} test(s) failed, ${passed} passed`);
    failures.forEach((f) => console.error(`   • ${f}`));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal error:', err.message, err.stack);
  process.exit(1);
});
