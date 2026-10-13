#!/usr/bin/env node
/**
 * Regression suite for the Street View frame usability gate and the bounded
 * recapture that follows a rejection.
 *
 * The behaviour under test:
 *   1. A frame showing trees, sky, or the neighbour's house is rejected and
 *      never measured as if it were the subject wall.
 *   2. A rejection produces a recapture PLAN — a different heading offset,
 *      panorama search distance, pitch, or field of view — so an alternative
 *      angle is genuinely attempted rather than the wall being skipped.
 *   3. Retries are bounded, per wall and per request, so a hopeless address
 *      cannot multiply AI cost or call latency.
 *   4. The panel-facing summary reports the frame that was FINALLY used, and
 *      says "Skipped" only when every attempt failed.
 *   5. An uploaded contractor photo is never rejected just because the model
 *      omitted the new frame_subject field.
 *
 * Also verifies the live handler stays aligned with the shared module.
 */
const fs = require('fs');
const path = require('path');
const gate = require('../lib/photoUsabilityGate.cjs');

let pass = 0, fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label} ${detail}`); }
};

const goodFrame = {
  frame_subject: 'subject_building',
  subject_visible_pct: 85,
  wall_width_ft: 34,
  eave_height_ft: 18,
  building_type: 'house',
};

// ── 1. Rejection categories ────────────────────────────────────────────────
console.log('\n1. Frame rejection');
{
  const usable = gate.evaluateFrameUsability(goodFrame, { label: 'Front', sourceType: 'street_view' });
  ok(usable.usable === true && usable.reason === null, 'a clear subject frame is measurable');

  for (const [subject, expected] of [
    ['foliage', 'foliage'],
    ['sky', 'sky'],
    ['other_building', 'other_building'],
    ['obstructed', 'obstructed'],
    ['unclear', 'unclear'],
  ]) {
    const v = gate.evaluateFrameUsability(
      { ...goodFrame, frame_subject: subject },
      { label: 'Left Side', sourceType: 'street_view' },
    );
    ok(v.usable === false && v.reason === expected, `frame_subject="${subject}" is rejected`, JSON.stringify(v));
  }

  // A rejected frame must not be measured even when the model still filled in
  // plausible-looking dimensions — that is exactly the "measuring scenery" bug.
  const scenery = gate.evaluateFrameUsability(
    { frame_subject: 'foliage', wall_width_ft: 40, eave_height_ft: 20 },
    { label: 'Back', sourceType: 'street_view' },
  );
  ok(scenery.usable === false, 'trees with confident dimensions are still rejected');

  // Near-miss spellings from the model must not launder into "measurable".
  ok(gate.normalizeFrameSubject('Trees') === 'foliage', '"Trees" normalizes to foliage');
  ok(gate.normalizeFrameSubject('neighboring house') === 'other_building', '"neighboring house" normalizes to other_building');
  ok(gate.normalizeFrameSubject('SUBJECT_BUILDING') === 'subject_building', 'casing is tolerated');
  ok(gate.normalizeFrameSubject('banana') === null, 'an unrecognised value is not silently accepted as a subject');

  const barelyVisible = gate.evaluateFrameUsability(
    { ...goodFrame, subject_visible_pct: 12 },
    { label: 'Right Side', sourceType: 'street_view' },
  );
  ok(barelyVisible.usable === false && barelyVisible.reason === 'obstructed',
    'right house but mostly hidden is rejected as obstructed');

  const zeroed = gate.evaluateFrameUsability(
    { frame_subject: 'subject_building', wall_width_ft: 0, eave_height_ft: 0 },
    { label: 'Back', sourceType: 'street_view' },
  );
  ok(zeroed.usable === false, 'a street view frame with nothing measured is rejected');

  ok(gate.evaluateFrameUsability(null, { label: 'Front', sourceType: 'street_view' }).usable === false,
    'a missing analysis is rejected, not treated as measurable');
}

// ── 2. Uploaded photos must not regress ────────────────────────────────────
console.log('\n2. Uploaded photos fail open');
{
  // Legacy/manual uploads predate frame_subject. Refusing to measure them
  // because one key is absent would be a far worse regression than the bug.
  const legacy = gate.evaluateFrameUsability(
    { wall_width_ft: 30, eave_height_ft: 17 },
    { label: 'Front', sourceType: 'uploaded' },
  );
  ok(legacy.usable === true, 'an uploaded photo with no frame_subject is still measured');

  const deliberateDetail = gate.evaluateFrameUsability(
    { wall_width_ft: 0, eave_height_ft: 0 },
    { label: 'Detail', sourceType: 'uploaded' },
  );
  ok(deliberateDetail.usable === true, 'a deliberate uploaded detail shot is not force-rejected');

  // An explicit rejection still applies to uploads.
  const uploadedTrees = gate.evaluateFrameUsability(
    { ...goodFrame, frame_subject: 'foliage' },
    { label: 'Front', sourceType: 'uploaded' },
  );
  ok(uploadedTrees.usable === false, 'an explicit rejection still applies to an upload');

  // But only auto-fetched frames can be re-fetched.
  ok(gate.shouldRecapture({ sourceType: 'uploaded', verdict: uploadedTrees }) === false,
    'an uploaded photo never triggers a recapture');
  ok(gate.shouldRecapture({ sourceType: 'street_view', verdict: uploadedTrees }) === true,
    'a rejected street view frame does trigger a recapture');
  ok(gate.shouldRecapture({ sourceType: 'street_view', verdict: { usable: true } }) === false,
    'a usable frame never triggers a recapture');
}

// ── 3. Recapture plans are real alternatives ───────────────────────────────
console.log('\n3. Recapture plans');
{
  for (const reason of ['foliage', 'sky', 'other_building', 'obstructed', 'unclear']) {
    const a = gate.buildRecapturePlan({ attempt: 1, reason });
    const b = gate.buildRecapturePlan({ attempt: 2, reason });
    ok(!!a && !!b, `${reason}: both attempts produce a plan`);
    const differs = a.search_distance_m !== b.search_distance_m
      || a.heading_offset_deg !== b.heading_offset_deg
      || a.pitch_deg !== b.pitch_deg
      || a.fov_deg !== b.fov_deg;
    ok(differs, `${reason}: attempt 2 is a genuinely different capture from attempt 1`);
    ok(Number.isFinite(a.search_radius_m) && a.search_radius_m > 0,
      `${reason}: attempt 1 has a panorama search radius`);
  }

  // Foliage is a fixed obstruction — re-aiming the same viewpoint does not
  // help, so the first remedy must MOVE the camera.
  const foliage1 = gate.buildRecapturePlan({ attempt: 1, reason: 'foliage' });
  ok(foliage1.search_distance_m !== 80,
    'foliage attempt 1 searches from a different distance than the original 80 m aim');

  // Sky means the aim is too high; the remedy is pitch, not position.
  const sky1 = gate.buildRecapturePlan({ attempt: 1, reason: 'sky' });
  ok(sky1.pitch_deg < 20, 'sky attempt 1 tilts the camera down from the default 20° pitch');

  // A neighbouring house filling the frame needs a tighter, closer shot.
  const other1 = gate.buildRecapturePlan({ attempt: 1, reason: 'other_building' });
  ok(other1.fov_deg < 60, 'other_building attempt 1 narrows the field of view');
  ok(other1.search_distance_m < 80, 'other_building attempt 1 moves closer to the subject');

  // An unknown reason must still yield a plan rather than silently skipping.
  ok(!!gate.buildRecapturePlan({ attempt: 1, reason: 'something_new' }),
    'an unrecognised reason falls back to the generic re-aim ladder');
}

// ── 4. Retries are bounded ─────────────────────────────────────────────────
console.log('\n4. Bounded retries');
{
  ok(gate.MAX_RECAPTURE_ATTEMPTS >= 1, 'at least one alternative capture is attempted');
  ok(gate.MAX_RECAPTURE_ATTEMPTS <= 3, 'per-wall attempts are capped low enough to bound latency');
  ok(gate.buildRecapturePlan({ attempt: gate.MAX_RECAPTURE_ATTEMPTS + 1, reason: 'foliage' }) === null,
    'no plan exists past the per-wall ceiling');
  ok(gate.buildRecapturePlan({ attempt: 0, reason: 'foliage' }) === null, 'attempt 0 is rejected');
  ok(gate.buildRecapturePlan({ attempt: 1.5, reason: 'foliage' }) === null, 'a non-integer attempt is rejected');

  ok(gate.MAX_TOTAL_RECAPTURE_ANALYSES >= 1, 'the request-wide budget allows at least one recapture');
  // The worst case is every one of the four primary faces being rejected. A
  // request-wide budget below the naive product is what stops a hopeless
  // address from multiplying AI spend by the per-wall ceiling.
  const naiveWorstCase = 4 * gate.MAX_RECAPTURE_ATTEMPTS;
  ok(gate.MAX_TOTAL_RECAPTURE_ANALYSES < naiveWorstCase,
    `request budget (${gate.MAX_TOTAL_RECAPTURE_ANALYSES}) is below the 4-wall worst case (${naiveWorstCase})`);

  for (const reason of Object.keys(gate.RECAPTURE_STRATEGIES)) {
    ok(gate.RECAPTURE_STRATEGIES[reason].length <= gate.MAX_RECAPTURE_ATTEMPTS,
      `${reason} ladder cannot exceed the attempt ceiling`);
  }
}

// ── 5. Attempts must be genuinely distinct captures ────────────────────────
console.log('\n5. Capture de-duplication');
{
  const base = { panoId: 'PANO_A', heading: 120, pitch: 20, fov: 60 };
  ok(gate.captureFingerprint(base) === gate.captureFingerprint({ ...base }),
    'the same capture fingerprints identically');
  ok(gate.captureFingerprint(base) !== gate.captureFingerprint({ ...base, panoId: 'PANO_B' }),
    'a different panorama is a different capture');
  // Re-aiming the SAME panorama is a legitimate alternative — it is the whole
  // remedy for a sky-filled or neighbour-filled frame. Fingerprinting on the
  // pano id alone would throw those attempts away as "duplicates".
  ok(gate.captureFingerprint(base) !== gate.captureFingerprint({ ...base, pitch: 0 }),
    'the same panorama re-pitched is a different capture');
  ok(gate.captureFingerprint(base) !== gate.captureFingerprint({ ...base, fov: 45 }),
    'the same panorama re-zoomed is a different capture');
  ok(gate.captureFingerprint(base) !== gate.captureFingerprint({ ...base, heading: 145 }),
    'the same panorama re-aimed is a different capture');
  ok(gate.captureFingerprint({ ...base, heading: 480 }) === gate.captureFingerprint(base),
    'headings are compared modulo 360');
}

// ── 6. Panel-facing summary ────────────────────────────────────────────────
console.log('\n6. Panel summary');
{
  const usedFirst = gate.summarizeRecapture({
    label: 'Front',
    attempts: [],
    initial: { usable: true, image_url: 'https://sv/front', pano_id: 'P1', heading: 90 },
  });
  ok(usedFirst.status === 'used' && usedFirst.final_image_url === 'https://sv/front',
    'a good first frame is reported as used, with that frame');

  const recovered = gate.summarizeRecapture({
    label: 'Left Side',
    attempts: [
      { attempt: 1, strategy: 'adjacent_panorama', usable: false, outcome: 'no_alternative_frame' },
      { attempt: 2, strategy: 'distant_panorama', usable: true, image_url: 'https://sv/left-alt', pano_id: 'P9', heading: 271 },
    ],
    initial: { usable: false, reason: 'foliage', image_url: 'https://sv/left', pano_id: 'P1', heading: 270 },
  });
  ok(recovered.status === 'recaptured', 'a recovered wall is not reported as skipped');
  ok(recovered.final_image_url === 'https://sv/left-alt' && recovered.final_pano_id === 'P9',
    'the panel is given the frame that was FINALLY used, not the rejected one');
  ok(recovered.final_heading === 271, 'the final heading follows the recaptured frame');
  ok(/trees|foliage/i.test(recovered.message), 'the message explains why the first angle was dropped');

  const skipped = gate.summarizeRecapture({
    label: 'Back',
    attempts: [
      { attempt: 1, strategy: 'adjacent_panorama', usable: false, outcome: 'rejected' },
      { attempt: 2, strategy: 'distant_panorama', usable: false, outcome: 'rejected' },
    ],
    initial: { usable: false, reason: 'foliage', image_url: 'https://sv/back', pano_id: 'P1', heading: 0 },
  });
  ok(skipped.status === 'skipped', 'a wall is skipped only after every attempt failed');
  ok(skipped.final_image_url === null,
    'a skipped wall exposes no frame — nothing was measured, so nothing is shown as used');
  ok(skipped.attempt_count === 2 && /2 alternative angles tried/.test(skipped.message),
    'the skipped message states how many alternatives were tried');

  // A wall that never got an attempt because WE ran out of budget has not been
  // shown to be obscured. Reporting it as "skipped" would tell the estimator
  // the house is blocked from the street when nothing of the sort was tested.
  const budgetLimited = gate.summarizeRecapture({
    label: 'Right Side',
    attempts: [],
    initial: { usable: false, reason: 'foliage', image_url: 'https://sv/right', pano_id: 'P1', heading: 180 },
    stoppedReason: 'budget_exhausted',
  });
  ok(budgetLimited.status === 'unmeasured',
    'a wall the budget never reached is NOT reported as skipped');
  ok(budgetLimited.stopped_reason === 'budget_exhausted', 'the summary records why the ladder stopped');
  ok(!/no alternative Street View angle exists/.test(budgetLimited.message),
    'a budget-limited wall does not claim no alternative angle exists');
  ok(/may still exist/.test(budgetLimited.message),
    'a budget-limited wall says a usable angle may still exist');
  ok(budgetLimited.final_image_url === null, 'a budget-limited wall still exposes no measured frame');

  const partialThenBudget = gate.summarizeRecapture({
    label: 'Back',
    attempts: [{ attempt: 1, strategy: 'adjacent_panorama', usable: false, outcome: 'rejected' }],
    initial: { usable: false, reason: 'foliage', image_url: 'https://sv/back', pano_id: 'P1', heading: 0 },
    stoppedReason: 'budget_exhausted',
  });
  ok(partialThenBudget.status === 'unmeasured',
    'a partially-tried wall cut short by budget is unmeasured, not skipped');
  ok(/1 alternative angle tried/.test(partialThenBudget.message),
    'the message still credits the attempts that did run');

  const noLookup = gate.summarizeRecapture({
    label: 'Front',
    attempts: [],
    initial: { usable: false, reason: 'sky', image_url: 'https://sv/front', pano_id: 'P1', heading: 90 },
    stoppedReason: 'lookup_unavailable',
  });
  ok(noLookup.status === 'unmeasured' && noLookup.stopped_reason === 'lookup_unavailable',
    'a missing Street View lookup key yields unmeasured, not skipped');
  ok(/not configured/.test(noLookup.message), 'the message names the configuration gap');

  // Every status must carry the field, so a consumer can branch on it safely.
  for (const s of [usedFirst, recovered, skipped, budgetLimited]) {
    ok('stopped_reason' in s, `${s.status} verdict carries stopped_reason`);
  }
  ok(usedFirst.stopped_reason === null && recovered.stopped_reason === null && skipped.stopped_reason === null,
    'only a curtailed ladder sets stopped_reason');

  const noCoverage = gate.summarizeRecapture({
    label: 'Right Side',
    attempts: [],
    initial: { usable: false, reason: 'sky', image_url: 'https://sv/right', pano_id: 'P1', heading: 180 },
  });
  ok(noCoverage.status === 'skipped' && /no alternative Street View angle exists/.test(noCoverage.message),
    'a wall with no alternative coverage fails honestly and says so');
}

// ── 7. Prompt/schema contract ──────────────────────────────────────────────
console.log('\n7. Prompt and schema contract');
{
  ok(gate.FRAME_SUBJECT_SCHEMA_FRAGMENT.includes('"frame_subject"'),
    'the schema fragment declares frame_subject');
  ok(gate.FRAME_SUBJECT_SCHEMA_FRAGMENT.includes('"subject_visible_pct"'),
    'the schema fragment declares subject_visible_pct');
  for (const subject of gate.FRAME_SUBJECTS) {
    ok(gate.FRAME_SUBJECT_PROMPT.includes(`"${subject}"`), `the prompt documents "${subject}"`);
    ok(gate.FRAME_SUBJECT_SCHEMA_FRAGMENT.includes(`"${subject}"`), `the schema allows "${subject}"`);
  }
  ok(/wall_width_ft to 0/.test(gate.FRAME_SUBJECT_PROMPT),
    'the prompt tells the model to zero the measurement on a bad frame');
}

// ── 8. Handler wiring (static) ─────────────────────────────────────────────
console.log('\n8. Handler wiring');
{
  const root = path.join(__dirname, '..');
  const plugin = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');

  ok(plugin.includes("nodeRequire('./lib/photoUsabilityGate.cjs')"),
    'the live handler uses the shared gate rather than its own copy');
  ok(plugin.includes('photoUsabilityGate.FRAME_SUBJECT_PROMPT')
    && plugin.includes('photoUsabilityGate.FRAME_SUBJECT_SCHEMA_FRAGMENT'),
    'the live per-photo prompt and schema come from the shared module');
  ok(plugin.includes('resolveAlternativeStreetViewFrame'),
    'the live handler can resolve an alternative Street View frame');
  ok(plugin.includes('street_view_frame_verdicts'),
    'the live handler returns per-wall frame verdicts to the client');
  ok(plugin.includes('photoUsabilityGate.MAX_TOTAL_RECAPTURE_ANALYSES'),
    'the live handler enforces the request-wide recapture budget');

  // The backend cannot work out where to stand for an alternative angle
  // without the wall azimuth, so the client must send it.
  const estimator = fs.readFileSync(path.join(root, 'src/pages/AIEstimator.jsx'), 'utf8');
  const photoList = fs.readFileSync(path.join(root, 'src/utils/sidingPhotoList.js'), 'utf8');
  ok(estimator.includes('wall_azimuth:'), 'AIEstimator sends wall_azimuth with Street View photos');
  ok(photoList.includes('wall_azimuth:'), 'buildSidingPhotoList sends wall_azimuth with Street View photos');
  ok(estimator.includes('streetViewFrameVerdicts'), 'AIEstimator holds the frame verdicts for the panel');
  ok(/Recaptured/.test(estimator) && /Skipped/.test(estimator),
    'the panel can render both the recaptured and skipped states');
}

// ── 9. Handler-level budget exhaustion ─────────────────────────────────────
// The per-wall ceiling and the request budget interact: earlier walls can eat
// the whole budget, leaving later walls with zero attempts. Simulate the
// handler's loop so that interaction is pinned down, not just the summary.
console.log('\n9. Request-budget exhaustion across walls');
{
  // Mirrors the handler: for each rejected wall, walk the ladder while the
  // shared budget lasts; a rung that finds no panorama costs no vision call.
  const runRequest = ({ walls, frameFound = () => true, everUsable = false, mapsKey = true }) => {
    let budget = gate.MAX_TOTAL_RECAPTURE_ANALYSES;
    let visionCalls = 0;
    return walls.map((label) => {
      const initial = { usable: false, reason: 'foliage', image_url: `https://sv/${label}`, pano_id: 'P1', heading: 0 };
      const attempts = [];
      let stoppedReason = null;
      for (let attempt = 1; attempt <= gate.MAX_RECAPTURE_ATTEMPTS; attempt++) {
        if (budget <= 0) { stoppedReason = 'budget_exhausted'; break; }
        if (!mapsKey) { stoppedReason = 'lookup_unavailable'; break; }
        const plan = gate.buildRecapturePlan({ attempt, reason: 'foliage' });
        if (!plan) break;
        if (!frameFound(label, attempt)) {
          attempts.push({ attempt, strategy: plan.strategy, usable: false, outcome: 'no_alternative_frame' });
          continue; // no panorama → no vision call, no budget spent
        }
        budget -= 1;
        visionCalls += 1;
        const usable = everUsable;
        attempts.push({ attempt, strategy: plan.strategy, usable, outcome: usable ? 'measured' : 'rejected', image_url: `https://sv/${label}-alt` });
        if (usable) break;
      }
      return { summary: gate.summarizeRecapture({ label, attempts, initial, stoppedReason }), visionCalls: () => visionCalls };
    });
  };

  const fourWalls = ['Front', 'Right Side', 'Back', 'Left Side'];
  const allBlocked = runRequest({ walls: fourWalls });
  const statuses = allBlocked.map((w) => w.summary.status);
  const totalCalls = allBlocked[allBlocked.length - 1].visionCalls();

  ok(totalCalls <= gate.MAX_TOTAL_RECAPTURE_ANALYSES,
    `a hopeless four-wall address spends at most the request budget (spent ${totalCalls})`);
  ok(statuses.includes('unmeasured'),
    'walls the budget never reached are reported as unmeasured, not skipped');
  // This is the regression that matters: with 4 walls x 2 attempts against a
  // 4-call budget, the last walls get zero attempts. Calling those "skipped"
  // would tell the estimator the house is obscured on evidence never gathered.
  const zeroAttemptWalls = allBlocked.filter((w) => w.summary.attempt_count === 0);
  ok(zeroAttemptWalls.length > 0, 'the four-wall worst case really does starve some walls');
  ok(zeroAttemptWalls.every((w) => w.summary.status === 'unmeasured'),
    'no wall with zero attempts is ever labelled skipped');
  ok(allBlocked.every((w) => w.summary.status !== 'used' && w.summary.final_image_url === null),
    'no blocked wall is reported as measured');

  // Walls whose ladder genuinely ran out (every rung found no panorama) cost no
  // budget, so all four can be honestly exhausted in one request.
  const noPanoramas = runRequest({ walls: fourWalls, frameFound: () => false });
  ok(noPanoramas.every((w) => w.summary.status === 'skipped'),
    'a wall whose every rung found no panorama is honestly skipped');
  ok(noPanoramas[noPanoramas.length - 1].visionCalls() === 0,
    'rungs that find no panorama cost no AI call');

  // A recoverable address must not be starved: a wall recovered on attempt 1
  // leaves budget for the walls behind it.
  const recoverable = runRequest({ walls: fourWalls, everUsable: true });
  ok(recoverable.every((w) => w.summary.status === 'recaptured'),
    'when the first alternative works, every wall is recovered within budget');

  // No Maps key: nothing can be attempted, and nothing may be claimed.
  const noKey = runRequest({ walls: fourWalls, mapsKey: false });
  ok(noKey.every((w) => w.summary.status === 'unmeasured' && w.summary.stopped_reason === 'lookup_unavailable'),
    'without a Street View key every wall is unmeasured, never skipped');
  ok(noKey[noKey.length - 1].visionCalls() === 0, 'a missing key spends no AI budget');
}

// ── 9b. Provider failures are indeterminate, never evidence ────────────────
// A metadata timeout, a denied key, or a blown quota tells us nothing about the
// house. Reporting those as "skipped" would turn our own outage into a claim
// that the wall is obscured from the street.
console.log('\n9b. Lookup and analysis failures');
{
  ok(gate.isIndeterminateLookupStatus('REQUEST_DENIED'), 'REQUEST_DENIED is indeterminate');
  ok(gate.isIndeterminateLookupStatus('OVER_QUERY_LIMIT'), 'OVER_QUERY_LIMIT is indeterminate');
  ok(gate.isIndeterminateLookupStatus('INVALID_REQUEST'), 'INVALID_REQUEST is indeterminate');
  ok(gate.isIndeterminateLookupStatus('UNKNOWN_ERROR'), 'UNKNOWN_ERROR is indeterminate');
  ok(gate.isIndeterminateLookupStatus(undefined), 'an unreadable/missing status is indeterminate');
  ok(gate.isIndeterminateLookupStatus(''), 'an empty status is indeterminate');
  ok(!gate.isIndeterminateLookupStatus('ZERO_RESULTS'),
    'ZERO_RESULTS is a real answer about coverage, not a failure');
  ok(!gate.isIndeterminateLookupStatus('NOT_FOUND'),
    'NOT_FOUND is a real answer about coverage, not a failure');
  ok(!gate.isIndeterminateLookupStatus('OK'), 'OK is not a failure');
  ok(gate.CONFIRMED_NO_COVERAGE_STATUSES.every((s) => !gate.isIndeterminateLookupStatus(s)),
    'every confirmed-no-coverage status is treated as determinate');

  // Walk the handler's loop with each provider failure mode.
  const runWall = ({ lookup, analysisOk = true }) => {
    const initial = { usable: false, reason: 'foliage', image_url: 'https://sv/f', pano_id: 'P1', heading: 0 };
    const attempts = [];
    let stoppedReason = null;
    for (let attempt = 1; attempt <= gate.MAX_RECAPTURE_ATTEMPTS; attempt++) {
      const plan = gate.buildRecapturePlan({ attempt, reason: 'foliage' });
      if (!plan) break;
      const frame = lookup(attempt);
      if (!frame || frame.indeterminate) {
        attempts.push({ attempt, strategy: plan.strategy, usable: false, outcome: 'lookup_failed' });
        stoppedReason = 'lookup_failed';
        break;
      }
      if (frame.noCoverage) {
        attempts.push({ attempt, strategy: plan.strategy, usable: false, outcome: 'no_alternative_frame' });
        continue;
      }
      if (!analysisOk) {
        attempts.push({ attempt, strategy: plan.strategy, usable: false, outcome: 'analysis_failed' });
        stoppedReason = 'analysis_failed';
        break;
      }
      attempts.push({ attempt, strategy: plan.strategy, usable: false, outcome: 'rejected' });
    }
    return gate.summarizeRecapture({ label: 'Front', attempts, initial, stoppedReason });
  };

  const okFrame = { panoId: 'P2', heading: 10, pitch: 20, fov: 60, strategy: 'adjacent_panorama', imageUrl: 'https://sv/alt' };

  for (const status of ['REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'UNKNOWN_ERROR', 'INVALID_REQUEST']) {
    const s = runWall({ lookup: () => ({ indeterminate: true, status, error: `Street View metadata returned ${status}` }) });
    ok(s.status === 'unmeasured' && s.stopped_reason === 'lookup_failed',
      `a ${status} lookup yields unmeasured, never skipped`);
    ok(!/no alternative Street View angle exists/.test(s.message),
      `a ${status} lookup does not claim no alternative angle exists`);
  }

  const timedOut = runWall({ lookup: () => ({ error: 'The operation timed out', indeterminate: true }) });
  ok(timedOut.status === 'unmeasured' && timedOut.stopped_reason === 'lookup_failed',
    'a network timeout on the metadata call yields unmeasured, never skipped');
  ok(/may still exist/.test(timedOut.message), 'a timed-out lookup says a usable angle may still exist');

  const nullFrame = runWall({ lookup: () => null });
  ok(nullFrame.status === 'unmeasured',
    'a resolver returning nothing at all is treated as indeterminate, not as no-coverage');

  // A failing lookup stops the ladder instead of hammering a broken API.
  ok(timedOut.attempt_count === 1, 'a failing lookup stops the ladder rather than retrying into the same outage');

  const visionDown = runWall({ lookup: () => ({ ...okFrame }), analysisOk: false });
  ok(visionDown.status === 'unmeasured' && visionDown.stopped_reason === 'analysis_failed',
    'a frame that could not be fetched or analyzed yields unmeasured, never skipped');
  ok(/never actually judged/.test(visionDown.message),
    'the message admits the alternative angle was never judged');

  // The determinate path must still be able to reach "skipped", or the honest
  // failure this feature depends on would be unreachable.
  const trulyNoCoverage = runWall({ lookup: () => ({ noCoverage: true, indeterminate: false, status: 'ZERO_RESULTS' }) });
  ok(trulyNoCoverage.status === 'skipped',
    'confirmed ZERO_RESULTS on every rung still reports an honest skip');
  const trulyRejected = runWall({ lookup: () => ({ ...okFrame }) });
  ok(trulyRejected.status === 'skipped',
    'alternatives that were fetched, analyzed, and rejected still report an honest skip');
}

// ── 10. Both handlers agree on the curtailed-ladder rule ───────────────────
console.log('\n10. Handler wiring for curtailed ladders');
{
  const root = path.join(__dirname, '..');
  const plugin = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
  const estimator = fs.readFileSync(path.join(root, 'src/pages/AIEstimator.jsx'), 'utf8');

  for (const [name, src] of [['live production handler', plugin]]) {
    ok(/stoppedReason = 'budget_exhausted'/.test(src),
      `the ${name} records budget exhaustion as the stop reason`);
    ok(/stoppedReason = 'lookup_unavailable'/.test(src),
      `the ${name} records a missing lookup key as the stop reason`);
    ok(/summarizeRecapture\(\{ label, attempts, initial, stoppedReason \}\)/.test(src),
      `the ${name} passes the stop reason into the summary`);
    ok(/status === 'skipped' \|\| summary\.status === 'unmeasured'/.test(src),
      `the ${name} drops the frame for BOTH unmeasured outcomes so scenery never aggregates`);
    ok(/street_view_unmeasured_count/.test(src),
      `the ${name} reports the unmeasured count separately from skipped`);
    ok(/stoppedReason = 'lookup_failed'/.test(src),
      `the ${name} treats a failed Street View lookup as indeterminate`);
    ok(/stoppedReason = 'analysis_failed'/.test(src),
      `the ${name} treats an unanalyzable recaptured frame as indeterminate`);
    ok(/frame\.noCoverage/.test(src),
      `the ${name} only continues the ladder on CONFIRMED no-coverage`);
    ok(!/if \(!frame \|\| frame\.error\)/.test(src),
      `the ${name} no longer lumps lookup errors in with genuine no-coverage`);
  }

  ok(estimator.includes("v.status === 'unmeasured'"), 'the panel renders the unmeasured status');
  ok(/Not retried/.test(estimator), 'the panel distinguishes a not-retried wall from a skipped one');
  ok(!/A skipped wall is genuinely obscured from the street/.test(estimator),
    'the skipped footnote no longer overclaims for walls that were never retried');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
