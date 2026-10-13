'use strict';
/**
 * Shared Postgres pool helper for scripts/
 * ──────────────────────────────────────────────────────────────────────────
 * Why this exists
 *   Standalone scripts that open a `pg` Pool and are then killed (workflow
 *   restart, Ctrl-C, a crash before `pool.end()`) can leave a backend session
 *   alive on the server. Connections here go through a proxy, so the backend
 *   does not always notice the client is gone. If that session was mid
 *   transaction it keeps holding row/table locks on `generic_entities`, and
 *   every later connection — including the schema check the dev server runs at
 *   startup — queues behind it. The dev server then initializes normally but
 *   never opens its port, which looks exactly like an application crash.
 *
 * What this helper guarantees
 *   1. Every connection sets server-side timeouts, so an abandoned session
 *      cannot hold a transaction or a lock indefinitely no matter how the
 *      script dies.
 *   2. Pools are closed on normal exit, on signals, and on fatal errors, and
 *      any open transaction on a checked-out client is rolled back first.
 *   3. On hard exit the client sockets are destroyed synchronously so the
 *      server sees the disconnect immediately.
 *   4. Connections carry an `application_name` of `script:<file>` so a future
 *      lock investigation can name the culprit from `pg_stat_activity`.
 *   5. Pools a script never constructs itself get the same treatment. Loading
 *      this module wraps `pg.Pool` for THIS PROCESS ONLY, so a pool opened
 *      privately by an imported server module (a vite-*-plugin, `db/`) is
 *      adopted the moment it is built. Scripts import those modules constantly
 *      and cannot reach their pools otherwise. Nothing about the server's own
 *      configuration changes — a server process never loads this file.
 *
 * Usage
 *   const { createPool } = require('./lib/db-pool.cjs');
 *   const pool = createPool();                 // DATABASE_URL by default
 *   const pool = createPool({ max: 3 });       // any pg Pool option
 *
 *   // For a pool handed out by a shared module that this process imported
 *   // BEFORE loading this helper (hoisted ESM imports in a .mjs script):
 *   const { adoptPool } = require('./lib/db-pool.cjs');
 *   adoptPool(getPoolFromThatModule());
 *
 * Overrides (per pool option, or the matching env var):
 *   statementTimeoutMs          SCRIPT_STATEMENT_TIMEOUT_MS          (120000)
 *   lockTimeoutMs               SCRIPT_LOCK_TIMEOUT_MS               (30000)
 *   idleInTransactionTimeoutMs  SCRIPT_IDLE_TX_TIMEOUT_MS            (60000)
 *   Pass 0 to disable an individual timeout.
 */

const path = require('path');
const pg = require('pg');
// Captured before interception so createPool() does not build a self-adopting
// pool and adopt it twice.
const Pool = pg.Pool;

function envMs(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const DEFAULT_STATEMENT_TIMEOUT_MS = envMs('SCRIPT_STATEMENT_TIMEOUT_MS', 120000);
const DEFAULT_LOCK_TIMEOUT_MS = envMs('SCRIPT_LOCK_TIMEOUT_MS', 30000);
// Kept deliberately short: this is the ceiling on how long an abandoned script
// can hold locks that block dev-server startup after a hard kill.
const DEFAULT_IDLE_TX_TIMEOUT_MS = envMs('SCRIPT_IDLE_TX_TIMEOUT_MS', 30000);

/** Pools created through this helper, so teardown can find them all. */
const pools = new Set();
let handlersInstalled = false;
let shuttingDown = null;

function scriptName() {
  try {
    const entry = process.argv[1];
    return entry ? path.basename(entry) : 'node';
  } catch {
    return 'node';
  }
}

function ms(value, fallback) {
  const n = Number(value == null ? fallback : value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : Math.floor(fallback);
}

/**
 * Create a pg Pool with abandonment-safe defaults and automatic teardown.
 * Accepts every normal pg Pool option plus the timeout overrides above.
 */
function createPool(config = {}) {
  const {
    statementTimeoutMs,
    lockTimeoutMs,
    idleInTransactionTimeoutMs,
    ...poolConfig
  } = config || {};

  const statementTimeout = ms(statementTimeoutMs, DEFAULT_STATEMENT_TIMEOUT_MS);
  const lockTimeout = ms(lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS);
  const idleTxTimeout = ms(idleInTransactionTimeoutMs, DEFAULT_IDLE_TX_TIMEOUT_MS);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    application_name: `script:${scriptName()}`,
    // Do not keep sockets parked longer than a script normally needs them.
    idleTimeoutMillis: 10000,
    ...poolConfig,
  });

  return adoptPool(pool, {
    statementTimeoutMs: statementTimeout,
    lockTimeoutMs: lockTimeout,
    idleInTransactionTimeoutMs: idleTxTimeout,
    applicationName: poolConfig.application_name,
  });
}

/** The `SET` statements that make a session safe to abandon. */
function guardSql({ statementTimeout, lockTimeout, idleTxTimeout, applicationName }) {
  const guards = [];
  if (statementTimeout > 0) guards.push(`SET statement_timeout = ${statementTimeout}`);
  if (lockTimeout > 0) guards.push(`SET lock_timeout = ${lockTimeout}`);
  if (idleTxTimeout > 0) guards.push(`SET idle_in_transaction_session_timeout = ${idleTxTimeout}`);
  if (applicationName) guards.push(`SET application_name = ${quoteLiteral(applicationName)}`);
  return guards.join('; ');
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Bring any pool under the same guarantees as one this helper created: session
 * timeouts and an identifying application_name on every connection, plus
 * rollback and close on exit, signals, and fatal errors.
 *
 * Use this for a pool handed out by a shared module (e.g. `db/schema.js`
 * `getPool()`), which a script cannot construct itself. Call it before running
 * any query so the guards are in place first.
 */
function adoptPool(pool, options = {}) {
  if (!pool) return pool;
  if (pools.has(pool)) return pool;

  const sql = guardSql({
    statementTimeout: ms(options.statementTimeoutMs, DEFAULT_STATEMENT_TIMEOUT_MS),
    lockTimeout: ms(options.lockTimeoutMs, DEFAULT_LOCK_TIMEOUT_MS),
    idleTxTimeout: ms(options.idleInTransactionTimeoutMs, DEFAULT_IDLE_TX_TIMEOUT_MS),
    // Keep a name the pool already chose; otherwise stamp the script's own, so
    // a lock investigation can always trace the session back to a script.
    applicationName: options.applicationName
      || (pool.options && pool.options.application_name)
      || `script:${scriptName()}`,
  });

  if (sql) {
    const apply = (client) => {
      // Queued on the client before it is handed to the caller, so the guards
      // always run first — `pg` preserves query order per client.
      client.query(sql).catch((err) => {
        console.warn(`[db-pool] could not apply session guards: ${err && err.message ? err.message : err}`);
      });
    };
    pool.on('connect', apply);
    // A shared pool may already hold connections opened before we adopted it.
    for (const client of clientsOf(pool)) apply(client);
  }

  // An idle client that errors out (server restart, proxy hangup) otherwise
  // becomes an unhandled 'error' event and kills the script.
  if (pool.listenerCount('error') === 0) {
    pool.on('error', (err) => {
      console.warn(`[db-pool] idle client error: ${err && err.message ? err.message : err}`);
    });
  }

  pools.add(pool);
  installHandlers();
  return pool;
}

/** True when a pool is under this helper's guards and teardown. */
function isAdopted(pool) {
  return pools.has(pool);
}

/**
 * Wrap `pg.Pool` for this process so any pool built after this module loads is
 * adopted automatically — including pools a script cannot reach, such as the
 * private ones inside `vite-*-plugin.js` and `db/` modules that scripts import
 * to exercise real handlers.
 *
 * Scope: this only ever runs in a script process, because only scripts require
 * this file. Server defaults are untouched.
 *
 * Limit: a module that captured `Pool` before this ran (a hoisted ESM import in
 * a `.mjs` script) keeps the original constructor. Those few call sites adopt
 * their pool explicitly with `adoptPool()`.
 */
function interceptPoolConstruction() {
  if (pg.Pool && pg.Pool.__scriptGuarded) return;
  const Base = pg.Pool;

  class ScriptGuardedPool extends Base {
    constructor(...args) {
      super(...args);
      try {
        adoptPool(this);
      } catch (err) {
        console.warn(`[db-pool] could not adopt an inherited pool: ${err && err.message ? err.message : err}`);
      }
    }
  }
  Object.defineProperty(ScriptGuardedPool, 'name', { value: Base.name });
  ScriptGuardedPool.__scriptGuarded = true;

  try {
    pg.Pool = ScriptGuardedPool;
  } catch {
    /* a frozen pg export just means explicit adoptPool() is required */
  }
}

function clientsOf(pool) {
  const list = pool && Array.isArray(pool._clients) ? pool._clients : [];
  return list.filter(Boolean);
}

/** Best-effort rollback of any transaction left open on a checked-out client. */
async function rollbackOpenTransactions(pool) {
  await Promise.all(clientsOf(pool).map(async (client) => {
    try {
      // 'I' = idle (no transaction). Anything else means a transaction block is
      // still open on this session and must not survive the process.
      const state = client.connection && client.connection.transactionStatus;
      if (state === 'I') return;
      await client.query('ROLLBACK');
    } catch {
      /* the client may already be dead or busy — the socket destroy below covers it */
    }
  }));
}

/**
 * Hand back clients that are still checked out. `pool.end()` waits for every
 * borrowed client to be returned, so without this a script that dies holding a
 * client would leave the close hanging — and the other pools behind it.
 */
function retireCheckedOutClients(pool) {
  for (const client of clientsOf(pool)) {
    try {
      if (typeof client.release === 'function') {
        // Releasing with an error destroys the connection rather than returning
        // it to the idle set, which is what we want while shutting down.
        client.release(new Error('script shutdown'));
      }
    } catch {
      /* already released, or never checked out — pool.end() handles it */
    }
  }
}

/** Synchronously drop sockets so the server sees the disconnect immediately. */
function destroySocketsSync() {
  for (const pool of pools) {
    for (const client of clientsOf(pool)) {
      try {
        const stream = client.connection && client.connection.stream;
        if (stream && !stream.destroyed) stream.destroy();
      } catch {
        /* nothing further we can do while exiting */
      }
    }
  }
}

async function endPool(pool) {
  if (!pool || pool.ending || pool.ended) return;
  try {
    await pool.end();
  } catch (err) {
    console.warn(`[db-pool] pool.end() failed: ${err && err.message ? err.message : err}`);
  }
}

/**
 * Roll back open transactions and close every pool this helper created.
 * Safe to call repeatedly and safe to call after a script already ended its
 * own pool.
 */
function closeAllPools() {
  if (shuttingDown) return shuttingDown;
  const open = [...pools].filter((pool) => !pool.ending && !pool.ended);
  if (open.length === 0) return Promise.resolve();

  shuttingDown = (async () => {
    // Phase 1 — roll back EVERY pool before waiting on any of them. Closing one
    // pool at a time would let a slow drain delay the rollback of the next
    // pool's open transaction, which is exactly the lock we are trying to free.
    await Promise.all(open.map(rollbackOpenTransactions));
    // Phase 2 — retire borrowed clients so no close can block on them.
    for (const pool of open) retireCheckedOutClients(pool);
    // Phase 3 — close.
    await Promise.all(open.map(endPool));
  })().finally(() => {
    shuttingDown = null;
  });

  return shuttingDown;
}

/** Close pools, but never hang the exit path waiting on a wedged connection. */
async function closeAllPoolsWithDeadline(deadlineMs = 5000) {
  let timer;
  try {
    await Promise.race([
      closeAllPools(),
      new Promise((resolve) => { timer = setTimeout(resolve, deadlineMs); }),
    ]);
  } catch {
    /* teardown is best-effort */
  } finally {
    if (timer) clearTimeout(timer);
  }
  destroySocketsSync();
}

const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
  SIGQUIT: 131,
};

function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;

  for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
    process.on(signal, () => {
      closeAllPoolsWithDeadline().finally(() => {
        process.exit(SIGNAL_EXIT_CODES[signal]);
      });
    });
  }

  // A script that finishes without calling pool.end() would otherwise idle
  // until its connections time out; close them as soon as the loop drains.
  process.on('beforeExit', () => {
    void closeAllPools();
  });

  // Fatal errors must not leave a transaction holding locks. Only installed
  // when nothing else already handles them, so a script keeps its own policy.
  if (process.listenerCount('uncaughtException') === 0) {
    process.on('uncaughtException', (err) => {
      console.error('Uncaught exception:', err && err.stack ? err.stack : err);
      closeAllPoolsWithDeadline().finally(() => process.exit(1));
    });
  }
  if (process.listenerCount('unhandledRejection') === 0) {
    process.on('unhandledRejection', (err) => {
      console.error('Unhandled rejection:', err && err.stack ? err.stack : err);
      closeAllPoolsWithDeadline().finally(() => process.exit(1));
    });
  }

  // Last line of defence: process.exit() cannot await, but it can still drop
  // the sockets so the server tears the sessions down right away.
  process.on('exit', destroySocketsSync);
}

interceptPoolConstruction();

module.exports = {
  createPool,
  adoptPool,
  isAdopted,
  closeAllPools,
  closeAllPoolsWithDeadline,
  destroySocketsSync,
};
