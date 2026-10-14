#!/usr/bin/env node
/**
 * Portal Privacy Static SQL Guard
 * ────────────────────────────────
 * Scans vite-functions-plugin.js and prod-server.cjs to verify that every
 * SQL query fetching project_logs or project_photos from the public portal
 * route includes the `is_public = true` filter.
 *
 * This runs without a database or server — safe for CI/pre-deploy pipelines.
 * Exit 0 = safe.  Exit 1 = potential regression detected.
 *
 * Usage:  node scripts/check-portal-privacy-sql.cjs
 *
 * How the matching works (two-pass):
 *   Pass 1 — Locate the portal route block in the source file so we don't
 *             accidentally match SQL from admin or other routes.
 *   Pass 2 — Within that scoped block, find the SQL statement that matches
 *             the per-rule `context` pattern, then confirm the `guard` pattern
 *             is present in that same statement.
 *   This ensures each guard is anchored to its specific SQL statement rather
 *   than a loose file-wide search.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const FILES_TO_CHECK = [
  'vite-functions-plugin.js',
  'prod-server.cjs',
];

/**
 * Each rule:
 *   description — human-readable label for output
 *   context     — regex that matches the SQL statement we want to inspect
 *                 (used to anchor the guard to a specific query)
 *   guard       — regex that must match within the same SQL statement
 */
const REQUIRED_GUARDS = [
  {
    description: 'project_logs SELECT in public portal must filter AND is_public = true',
    // Matches the SELECT ... FROM project_logs ... WHERE project_id query
    context: /SELECT\s[^;]*FROM\s+project_logs\s[^;]*WHERE\s[^;]*project_id/is,
    // That same statement must include the is_public guard
    guard:   /AND\s+is_public\s*=\s*true/i,
  },
  {
    description: 'project_photos SELECT in public portal must filter by is_public or homeowner uploaded_by',
    context: /SELECT\s[^;]*FROM\s+project_photos\s[^;]*WHERE\s[^;]*project_id/is,
    // Allow either: bare `AND is_public = true`
    //            or: `AND (is_public = true OR uploaded_by LIKE 'homeowner:%')`
    // An optional table alias is accepted (`pp.is_public`). The live portal
    // photo query uses that form. Both patterns keep private photos out.
    guard:   /AND\s+(?:(?:\w+\.)?is_public\s*=\s*true|\((?:\w+\.)?is_public\s*=\s*true\s+OR\s+(?:\w+\.)?uploaded_by\s+LIKE\s+'homeowner:%'\))/i,
  },
  {
    description: "homeowner note INSERT must hard-code is_public = false (not a variable)",
    // Matches the INSERT with author_role='homeowner' — the homeowner note write-path
    context: /INSERT\s+INTO\s+project_logs\s[^;]*'homeowner'/is,
    guard:   /,\s*false\s*[,)]/i,  // is_public value must be the literal false
  },
];

/**
 * Extract the single SQL statement (up to the statement terminator ` \`` or `)`) that
 * contains the context match.  We scan backwards from the match start to the nearest
 * backtick or opening paren/quote, and forward to the matching closer.  In practice the
 * source uses template literals (`...`) for SQL, so we just grab the enclosing backtick
 * block to stay tight.
 */
function extractSqlStatement(src, contextMatch) {
  const matchStart = contextMatch.index;
  const matchEnd   = contextMatch.index + contextMatch[0].length;

  // Walk backwards to find the start of the enclosing SQL string
  let start = matchStart;
  while (start > 0 && src[start] !== '`' && src[start] !== "'") start--;

  // Walk forwards to find the end (next backtick or closing quote)
  const openChar  = src[start];
  const closeChar = openChar === '`' ? '`' : "'";
  let end = matchEnd;
  while (end < src.length && src[end] !== closeChar) end++;

  return src.slice(start, end + 1);
}

/**
 * Extract the portal route block from a source file.
 * Anchors matching to the /api/public/portal handler only, preventing false
 * positives from other routes that reference the same tables.
 */
function extractPortalBlock(src) {
  // Match from the first /api/public/portal occurrence to the next top-level
  // route section marker ("// ──") or end of file.
  const match = src.match(/\/api\/public\/portal[\s\S]*?(?=\/\/\s*──|$)/);
  return match ? match[0] : src;
}

let totalPassed = 0;
let totalFailed = 0;

for (const filename of FILES_TO_CHECK) {
  const filepath = path.join(ROOT, filename);
  if (!fs.existsSync(filepath)) {
    process.stderr.write(`[sql-guard] SKIP: file not found: ${filename}\n`);
    continue;
  }

  const src         = fs.readFileSync(filepath, 'utf8');
  const portalBlock = extractPortalBlock(src);
  process.stdout.write(`\nChecking ${filename}…\n`);

  for (const rule of REQUIRED_GUARDS) {
    // Pass 1: Locate the specific SQL statement within the portal block
    const contextMatch = rule.context.exec(portalBlock);
    if (!contextMatch) {
      process.stderr.write(`  ✗  ${rule.description}\n`);
      process.stderr.write(`       (context pattern not found in portal block — was the route removed or renamed?)\n`);
      totalFailed++;
      continue;
    }

    // Pass 2: Extract the enclosing SQL string and check for the guard
    const sqlStatement = extractSqlStatement(portalBlock, contextMatch);
    const guardPresent = rule.guard.test(sqlStatement);

    if (guardPresent) {
      process.stdout.write(`  ✓  ${rule.description}\n`);
      totalPassed++;
    } else {
      process.stderr.write(`  ✗  ${rule.description}\n`);
      process.stderr.write(`       Guard pattern not found in: ${sqlStatement.slice(0, 120).replace(/\n/g, ' ')}…\n`);
      totalFailed++;
    }
  }
}

console.log('');
process.stdout.write(`[sql-guard] Results: ${totalPassed} passed, ${totalFailed} failed\n`);

if (totalFailed > 0) {
  process.stderr.write(
    '[sql-guard] PRIVACY REGRESSION DETECTED — is_public guard missing in one or more SQL queries.\n'
  );
  process.exit(1);
} else {
  process.stdout.write('[sql-guard] All is_public guards are in place ✓\n');
  process.exit(0);
}
