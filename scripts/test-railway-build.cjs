#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const railway = read('railway.toml');
const nix = read('nixpacks.toml');
const start = read('scripts/start-production.sh');
const ensure = read('scripts/ensure-schema.cjs');
const catalog = read('db/ensure-schema.cjs');
const vite = read('vite.config.js');
const lock = read('package-lock.json');
const docker = read('.dockerignore');

assert.match(railway, /buildCommand = "npm run build"/);
assert.match(railway, /startCommand = "node scripts\/ensure-schema\.cjs && node prod-server\.cjs"/);
assert.doesNotMatch(railway, /^startCommand = .*start-production\.sh/m);
assert.match(nix, /providers = \["node"\]/);
assert.match(nix, /node scripts\/ensure-schema\.cjs && node prod-server\.cjs/);
assert.match(ensure, /ensureSchema/);
assert.match(ensure, /Replit does not call this/);
assert.match(start, /\/nix\/store\/\*-nodejs-20\*/);
assert.doesNotMatch(start, /ensure-schema/);

assert.match(vite, /if \(!process\.argv\.includes\('--watch'\)\) \{\s*setTimeout\(\(\) => process\.exit\(0\), 500\);/s);
assert.doesNotMatch(lock, /package-firewall\.replit/);
assert.match(lock, /https:\/\/registry\.npmjs\.org\/@babel\/core\/-\/core-/);
assert.match(docker, /^\.replit$/m);
assert.doesNotMatch(docker, /^scripts\/start-production\.sh$/m);

const { TABLES, ensureSchema } = require('../db/ensure-schema.cjs');
assert.equal(typeof ensureSchema, 'function');
for (const name of ['caller_memories', 'sms_opt_outs', 'users', 'sessions', 'companies']) {
  assert.ok(TABLES.some((table) => table.name === name), name);
}
assert.doesNotMatch(catalog, /\bDROP TABLE\b|\bDELETE FROM\b|\bTRUNCATE\b/i);
const sql = catalog.slice(catalog.indexOf('async function ensureSchema'));
assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bUPDATE\b|\bTRUNCATE\b/i);

console.log('railway build checks passed');
