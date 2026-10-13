#!/usr/bin/env node
/**
 * test-heartbeat-workflow.cjs
 *
 * Static analysis for .github/workflows/alerting-heartbeat.yml
 *
 * Checks performed
 * ────────────────
 * 1. YAML is parseable (structural validity).
 * 2. The file declares exactly one job (sanity check).
 * 3. All step IDs are unique within the job.
 * 4. Every steps.<id>.outcome / steps.<id>.outputs.<key> reference that
 *    appears in a step's `if:` condition, `run:` block, or `with:` values
 *    resolves to a step ID that is actually declared in the same job.
 * 5. Steps that use secrets guards (if: ... && secrets.FOO != '') actually
 *    reference at least one secret in their `env:` or `with:` block,
 *    preventing guards that were written but the actual usage was removed.
 * 6. Every step that contains `steps.ts.outputs.now` in its body references
 *    the `ts` step, which must exist — verifying the timestamp anchor.
 *
 * Exit codes
 * ──────────
 *  0 — all checks passed
 *  1 — one or more checks failed (details printed to stderr)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../.github/workflows/alerting-heartbeat.yml'
);

let failures = 0;

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  failures++;
}

function pass(msg) {
  console.log(`  ok  : ${msg}`);
}

// ── 1. Load & parse ──────────────────────────────────────────────────────────
console.log(`\n[heartbeat-workflow] Validating ${path.relative(process.cwd(), WORKFLOW_PATH)}\n`);

let raw;
try {
  raw = fs.readFileSync(WORKFLOW_PATH, 'utf8');
} catch (e) {
  console.error(`  FAIL: Cannot read workflow file — ${e.message}`);
  process.exit(1);
}

let doc;
try {
  doc = yaml.load(raw);
  pass('YAML parses without errors');
} catch (e) {
  fail(`YAML parse error — ${e.message}`);
  process.exit(1);
}

// ── 2. Basic structure ───────────────────────────────────────────────────────
if (!doc || typeof doc !== 'object') {
  fail('Workflow document is empty or not an object');
  process.exit(1);
}

const jobs = doc.jobs || {};
const jobNames = Object.keys(jobs);

if (jobNames.length === 0) {
  fail('Workflow has no jobs defined');
  process.exit(1);
} else if (jobNames.length !== 1) {
  fail(`Expected exactly 1 job, found ${jobNames.length}: ${jobNames.join(', ')}`);
} else {
  pass(`Exactly one job defined: "${jobNames[0]}"`);
}

const jobName  = jobNames[0];
const job      = jobs[jobName];
const steps    = Array.isArray(job.steps) ? job.steps : [];

if (steps.length === 0) {
  fail('Job has no steps');
  process.exit(1);
}

pass(`Job "${jobName}" has ${steps.length} step(s)`);

// ── 3. Collect declared step IDs ─────────────────────────────────────────────
const declaredIds = new Set();
const duplicateIds = [];

for (const step of steps) {
  if (step.id) {
    if (declaredIds.has(step.id)) {
      duplicateIds.push(step.id);
    }
    declaredIds.add(step.id);
  }
}

if (duplicateIds.length > 0) {
  fail(`Duplicate step IDs: ${duplicateIds.join(', ')}`);
} else {
  pass(`All step IDs are unique (${declaredIds.size} named step(s): ${[...declaredIds].join(', ')})`);
}

// ── 4. Verify steps.<id>.outcome / steps.<id>.outputs.<key> references ───────
// Scan `if:`, `run:`, and `with:` fields for references.
const STEPS_REF_RE = /steps\.([a-zA-Z0-9_-]+)\.(outcome|outputs\.[a-zA-Z0-9_-]+)/g;

const badRefs = [];

function collectRefs(value) {
  if (typeof value !== 'string') return [];
  const refs = [];
  let m;
  STEPS_REF_RE.lastIndex = 0;
  while ((m = STEPS_REF_RE.exec(value)) !== null) {
    refs.push({ id: m[1], full: m[0] });
  }
  return refs;
}

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const stepLabel = step.id ? `step[id=${step.id}]` : `step[${i}]("${step.name || '?'}")`;

  const fieldsToCheck = [
    step.if,
    step.run,
    ...(step.with ? Object.values(step.with) : []),
  ];

  for (const field of fieldsToCheck) {
    for (const ref of collectRefs(field)) {
      if (!declaredIds.has(ref.id)) {
        badRefs.push(`${stepLabel} references steps.${ref.id} but no step with id="${ref.id}" exists`);
      }
    }
  }
}

if (badRefs.length > 0) {
  for (const msg of badRefs) fail(msg);
} else {
  pass('All steps.<id>.outcome/outputs references resolve to declared step IDs');
}

// ── 5. Secrets guard consistency ─────────────────────────────────────────────
// Any step whose `if:` contains `secrets.FOO != ''` should also reference
// that secret in its `env:` block or `with:` block values. This catches
// guards left in place after the actual secret usage was deleted.
const SECRETS_GUARD_RE = /secrets\.([A-Z0-9_]+)\s*!=\s*['"]{2}/g;
const SECRETS_USAGE_RE = /secrets\.([A-Z0-9_]+)/g;

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  if (!step.if) continue;

  const stepLabel = step.id ? `step[id=${step.id}]` : `step[${i}]("${step.name || '?'}")`;

  const guardedSecrets = new Set();
  let gm;
  SECRETS_GUARD_RE.lastIndex = 0;
  while ((gm = SECRETS_GUARD_RE.exec(step.if)) !== null) {
    guardedSecrets.add(gm[1]);
  }

  if (guardedSecrets.size === 0) continue;

  // Collect secret usages in env and with
  const usedSecrets = new Set();
  const usageFields = [
    ...(step.env ? Object.values(step.env) : []),
    ...(step.with ? Object.values(step.with) : []),
  ];

  for (const field of usageFields) {
    if (typeof field !== 'string') continue;
    SECRETS_USAGE_RE.lastIndex = 0;
    let um;
    while ((um = SECRETS_USAGE_RE.exec(field)) !== null) {
      usedSecrets.add(um[1]);
    }
  }

  for (const guardedSecret of guardedSecrets) {
    if (!usedSecrets.has(guardedSecret)) {
      fail(
        `${stepLabel} guards on secrets.${guardedSecret} != '' but does not use that secret in env/with — orphaned guard`
      );
    }
  }
}

if (failures === 0) {
  pass('All secrets guards have corresponding usage in env/with');
}

// ── 6. Timestamp anchor (steps.ts.outputs.now) ───────────────────────────────
// Any step body that interpolates steps.ts.outputs.now requires id:ts to exist.
const TS_USAGE_RE = /steps\.ts\.outputs\.now/;

const tsExists = declaredIds.has('ts');

let tsUsages = 0;
for (const step of steps) {
  const body = [
    step.if,
    step.run,
    ...(step.with ? Object.values(step.with) : []),
  ].filter(Boolean).join('\n');

  if (TS_USAGE_RE.test(body)) tsUsages++;
}

if (tsUsages > 0 && !tsExists) {
  fail(`${tsUsages} step(s) reference steps.ts.outputs.now but no step with id="ts" is declared`);
} else if (tsUsages > 0) {
  pass(`Timestamp anchor step (id="ts") exists and is used in ${tsUsages} step(s)`);
} else {
  pass('No steps.ts.outputs.now references (no anchor check needed)');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log('');
if (failures > 0) {
  console.error(`[heartbeat-workflow] ${failures} check(s) failed.`);
  process.exit(1);
} else {
  console.log(`[heartbeat-workflow] All checks passed ✓`);
}
