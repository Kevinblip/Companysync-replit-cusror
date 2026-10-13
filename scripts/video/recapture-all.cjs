#!/usr/bin/env node
/**
 * recapture-all.cjs — Full pipeline: re-capture screenshots + rebuild all 26 training videos.
 *
 * Usage:
 *   COOKIE='s%3A...' node scripts/video/recapture-all.cjs
 *   COOKIE='s%3A...' npm run video:recapture
 *
 * Prerequisites:
 *   - COOKIE env var set to a valid connect.sid value (see README.md Step 0)
 *   - Dev server running on http://localhost:5000  (npm run dev)
 *
 * Runtime: ~10 minutes (3-parallel capture batches, then 3-parallel clip builds per assembler).
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DIR   = __dirname; // scripts/video/
const SHOTS = path.join(DIR, 'shots-live');

// ── Guard: COOKIE is required ─────────────────────────────────────────────────
if (!process.env.COOKIE) {
  console.error(
    '\n❌ COOKIE env var is required.\n' +
    '   1. Log into the app in Chrome as an admin.\n' +
    '   2. DevTools → Application → Cookies → copy connect.sid value.\n' +
    '   3. Run: COOKIE=\'s%3A<value>\' npm run video:recapture\n'
  );
  process.exit(1);
}

// ── All 26 topics and their 9 expected screenshot filenames ───────────────────
const ALL_TOPICS = [
  'dashboard', 'leads', 'estimates', 'ai-estimator', 'build-schedule', 'invoices',
  'customers', 'staff', 'communications', 'automations', 'storm-tracking', 'settings',
  'reports', 'financing', 'mobile', 'reviews',
  'quickbooks', 'contracts', 'pricelist', 'aivoice', 'portal', 'photos',
  'calendar', 'gohighlevel', 'tasks', 'onboarding',
];

// Each topic has exactly 9 beats → shots <topic>-01.png … <topic>-09.png
function expectedShots(topics) {
  const shots = [];
  for (const t of topics) {
    for (let i = 1; i <= 9; i++) {
      shots.push(`${t}-${String(i).padStart(2, '0')}.png`);
    }
  }
  return shots;
}

// ── Topic batches for parallel capture ───────────────────────────────────────
// Three batches of ~9 topics run simultaneously to cut capture time by ~3×.
const CAPTURE_BATCHES = [
  ALL_TOPICS.slice(0, 9),   // dashboard … communications
  ALL_TOPICS.slice(9, 18),  // automations … contracts
  ALL_TOPICS.slice(18),     // pricelist … onboarding
];

// ── Assembler definitions ─────────────────────────────────────────────────────
const ASSEMBLERS = [
  {
    script: 'assemble-long.cjs',
    beats: 54,
    concats: null, // assemble-long infers topic numbers itself; single 'concat' pass
  },
  {
    script: 'assemble-v2.cjs',
    beats: 90,
    concats: [
      ['customers', '07'], ['staff', '08'], ['communications', '09'],
      ['automations', '10'], ['storm-tracking', '11'], ['settings', '12'],
      ['reports', '13'], ['financing', '14'], ['mobile', '15'], ['reviews', '16'],
    ],
  },
  {
    script: 'assemble-v3.cjs',
    beats: 90,
    concats: [
      ['quickbooks', '17'], ['contracts', '18'], ['pricelist', '19'],
      ['aivoice', '20'], ['portal', '21'], ['photos', '22'],
      ['calendar', '23'], ['gohighlevel', '24'], ['tasks', '25'], ['onboarding', '26'],
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: DIR,
      env: { ...process.env, ...env },
      stdio: 'inherit',
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} ${args.join(' ')} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

function runNode(script, args = [], env = {}) {
  return run(process.execPath, [path.join(DIR, script), ...args], env);
}

function parallel(promises) {
  return Promise.all(promises);
}

function elapsed(start) {
  const s = Math.round((Date.now() - start) / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Verify that all expected screenshots were freshly captured.
 * Returns an array of missing filenames (empty = all good).
 */
function missingShots(topics) {
  return expectedShots(topics).filter(
    (name) => !fs.existsSync(path.join(SHOTS, name))
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();

  // ── Phase 1: Capture ─────────────────────────────────────────────────────
  console.log('\n═══ Phase 1: Capturing screenshots (3 batches in parallel) ═══\n');
  console.log('Topics per batch:');
  CAPTURE_BATCHES.forEach((b, i) => console.log(`  Batch ${i + 1}: ${b.join(', ')}`));
  console.log();

  await parallel(
    CAPTURE_BATCHES.map((topics) =>
      runNode('capture-live.cjs', [], { TOPICS: topics.join(',') })
    )
  );
  console.log(`\n✓ Capture processes complete (${elapsed(t0)})\n`);

  // ── Verify all 234 screenshots landed ────────────────────────────────────
  const missing = missingShots(ALL_TOPICS);
  if (missing.length > 0) {
    console.error(`\n❌ ${missing.length} screenshot(s) missing after capture — aborting assembly.`);
    console.error('   Missing files:');
    missing.forEach((f) => console.error(`     shots-live/${f}`));
    console.error(
      '\n   Likely causes:\n' +
      '   • Session cookie expired — refresh COOKIE and retry (see README Step 0).\n' +
      '   • Dev server not reachable on http://localhost:5000.\n' +
      '   • A topic handler threw an unhandled error (scroll up for details).\n'
    );
    process.exit(1);
  }
  console.log(`✓ All ${ALL_TOPICS.length * 9} screenshots verified.\n`);

  // ── Phase 2: Build clips + concat ────────────────────────────────────────
  for (const { script, beats, concats } of ASSEMBLERS) {
    console.log(`\n═══ Building clips: ${script} ═══\n`);
    const t1 = Date.now();

    // Split beat range into 3 parallel sub-batches
    const third = Math.ceil(beats / 3);
    const ranges = [
      [0, third],
      [third, Math.min(third * 2, beats)],
      [Math.min(third * 2, beats), beats],
    ];

    await parallel(
      ranges.map(([start, end]) =>
        runNode(script, [String(start), String(end)], { FORCE: '1' })
      )
    );

    // Concat pass
    console.log(`\nConcatenating ${script}…`);
    if (concats === null) {
      // assemble-long handles all topics in a single 'concat' call
      await runNode(script, ['concat']);
    } else {
      // assemble-v2 / assemble-v3: one concat call per topic
      for (const [topic, outNum] of concats) {
        await runNode(script, ['concat', topic, outNum]);
      }
    }

    console.log(`✓ ${script} done (${elapsed(t1)})\n`);
  }

  console.log(
    `\n✅ All 26 videos rebuilt in ${elapsed(t0)}.\n` +
    `   Output: public/videos/clip01-dashboard.mp4 … clip26-onboarding.mp4\n`
  );
}

main().catch((err) => {
  console.error('\n❌ recapture-all failed:', err.message);
  process.exit(1);
});
