#!/usr/bin/env node
'use strict';

// Runs to completion before the server process starts (see railway.toml).
// Safe to run repeatedly and against a database that already has data.

const { Pool } = require('pg');
const { ensureSchema } = require('../db/ensure-schema.cjs');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[ensure-schema] DATABASE_URL is not set');
    process.exit(1);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 10000,
  });
  try {
    await ensureSchema(pool);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[ensure-schema] failed:', err.message);
  process.exit(1);
});
