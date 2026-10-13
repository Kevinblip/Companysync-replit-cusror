#!/usr/bin/env node
/**
 * test-email-verify-steps.cjs
 *
 * Unit tests for the email verify-step lint logic exported by
 * check-email-verify-steps.cjs.  All fixtures are in-memory YAML strings —
 * no disk I/O is required.  Tests call the real exported functions so any
 * regression in the production lint is caught here immediately.
 *
 * Fixtures covered
 * ────────────────
 *  ✓  correct pair                        (send-mail id + matching verify if:)
 *  ✗  no id                               (send-mail step missing id: field)
 *  ✗  wrong verify name                   (next step name doesn't match pattern)
 *  ✗  verify if references wrong step id  (copy-paste: valid id but wrong step)
 *  ✗  verify step is last (nothing after) (send-mail is last step in job)
 *  ✓  YAML-parse fallback correct pair    (content that breaks js-yaml but passes
 *                                          line-based extractor with correct pair)
 *  ✗  cross-job stale step id reference   (two-job workflow where job B's verify
 *                                          if: references a step id that only
 *                                          exists in job A)
 *  ✗  Check 4 isolated: stale id mixed    (verify if: contains both the correct
 *     into a compound if: expression       send-mail id AND a stale cross-job id;
 *                                          Check 3 passes, Check 4 catches it)
 *  ✗  Check 5: orphan verify phantom id   (verify step not following any send-mail
 *                                          step; its if: references a step id that
 *                                          does not exist anywhere in the job)
 *  ✗  4-space indent + js-yaml failure +  (workflow with 4-space job-name indent
 *     cross-job stale ref                  that breaks js-yaml AND has a cross-job
 *                                          stale verify reference — the auto-detected
 *                                          indent logic must catch it)
 *  ✗  Check 4: paired verify in two-job   (job B has a correct send-mail/verify pair
 *     workflow with stale cross-job id     but the verify if: ALSO contains a stale id
 *                                          from job A; Check 3c passes, Check 4 fires)
 *  ✓  mixed tab/space job-name indent     (job A tab-indented, job B space-indented;
 *     graceful degradation                 locked-in tab indent skips job B boundary,
 *                                          folding its steps under job A — both correct
 *                                          pairs still produce zero violations)
 *
 * Exit codes
 * ──────────
 *  0 — all tests passed
 *  1 — one or more tests failed
 */

'use strict';

const {
  parseWorkflowContent,
  checkJobSteps,
} = require('./check-email-verify-steps.cjs');

// ── Test harness ──────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(description, condition, detail) {
  if (condition) {
    console.log(`  ok  : ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

/**
 * Helper: parse workflow YAML content and run checks against all jobs.
 * Returns { violations, sendMailCount, usedFallback, jobBoundaryDetected, noJobsSection }.
 */
function lint(content, label) {
  const { jobStepLists, usedFallback, jobBoundaryDetected, noJobsSection } = parseWorkflowContent(content, label);
  let violations = [];
  let sendMailCount = 0;
  for (const { jobId, steps } of jobStepLists) {
    const context = `${label} → job '${jobId}'`;
    const result = checkJobSteps(steps, context);
    violations = violations.concat(result.violations);
    sendMailCount += result.sendMailCount;
  }
  return { violations, sendMailCount, usedFallback, jobBoundaryDetected, noJobsSection };
}

console.log('\n[test-email-verify-steps] Running unit tests for email verify-step lint logic\n');

// ── Fixture 1: correct pair ───────────────────────────────────────────────────
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        id: send_alert
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: steps.send_alert.conclusion == 'success'
        run: echo ok
`;
  const { violations, usedFallback } = lint(content, 'fixture-correct-pair');

  assert('Fixture 1: correct pair — YAML parsed (not line-based)', !usedFallback);
  assert('Fixture 1: correct pair — zero violations', violations.length === 0, violations.join('; '));
}

// ── Fixture 2: send-mail step missing id: ────────────────────────────────────
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: steps.send_alert.conclusion == 'success'
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-no-id');

  assert('Fixture 2: no id — exactly one violation', violations.length === 1, violations.join('; '));
  assert(
    'Fixture 2: no id — violation mentions missing id field',
    violations.some(v => v.includes("no 'id:' field")),
    violations.join('; ')
  );
}

// ── Fixture 3: wrong verify step name ────────────────────────────────────────
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        id: send_alert
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Check email was sent
        if: steps.send_alert.conclusion == 'success'
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-wrong-name');

  assert('Fixture 3: wrong verify name — exactly one violation', violations.length === 1, violations.join('; '));
  assert(
    'Fixture 3: wrong verify name — violation mentions wrong name',
    violations.some(v => v.includes('NOT immediately followed')),
    violations.join('; ')
  );
}

// ── Fixture 4: verify if: references a DIFFERENT (wrong) send-mail step id ──
// This is the copy-paste mistake the task targets: two send-mail steps where
// the second verify step has the correct name pattern but its `if:` references
// the first step's id (send_heartbeat) instead of its own (send_alert).
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send heartbeat email
        id: send_heartbeat
        uses: dawidd6/action-send-mail@v3
        with:
          to: ops@example.com
      - name: Verify heartbeat email delivery (Resend)
        if: steps.send_heartbeat.conclusion == 'success'
        run: echo ok
      - name: Send alert email
        id: send_alert
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: steps.send_heartbeat.conclusion == 'success'
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-wrong-ref-id');

  assert(
    'Fixture 4: wrong ref id — exactly one violation (heartbeat pair ok, alert pair fails)',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 4: wrong ref id — violation says steps.send_alert.conclusion was expected',
    violations.some(v => v.includes('steps.send_alert.conclusion')),
    violations.join('; ')
  );
  assert(
    'Fixture 4: wrong ref id — violation does NOT flag the heartbeat verify step',
    !violations.some(v => v.includes('"Verify heartbeat email delivery (Resend)"')),
    violations.join('; ')
  );
}

// ── Fixture 5: send-mail is last step in the job (no verify step follows) ────
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Do some work
        run: echo working
      - name: Send alert email
        id: send_alert
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
`;
  const { violations } = lint(content, 'fixture-send-mail-last');

  assert('Fixture 5: send-mail is last — exactly one violation', violations.length === 1, violations.join('; '));
  assert(
    'Fixture 5: send-mail is last — violation mentions "last step in the job"',
    violations.some(v => v.includes('last step in the job')),
    violations.join('; ')
  );
}

// ── Fixture 6: YAML-parse fallback with correct pair ─────────────────────────
// Include an unresolvable YAML alias (*missing_anchor) in a plain-scalar
// position.  js-yaml rejects this with "unidentified alias", triggering the
// line-based extractor fallback.  The send-mail / verify pair still passes.
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Post to Slack
        env:
          PAYLOAD: *missing_anchor
      - name: Send alert email
        id: send_fallback
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: steps.send_fallback.conclusion == 'success'
        run: echo ok
`;
  const { violations, usedFallback } = lint(content, 'fixture-yaml-fallback');

  assert('Fixture 6: YAML fallback — line-based extractor was used', usedFallback);
  assert('Fixture 6: YAML fallback correct pair — zero violations', violations.length === 0, violations.join('; '));
}

// ── Fixture 7: cross-job stale step id reference ─────────────────────────────
// Two-job workflow.  Job A (notify_a) has send_heartbeat_a as its send-mail
// step id.  Job B (notify_b) has send_alert_b as its send-mail step id, but
// its verify step's if: still references send_heartbeat_a — a stale copy-paste
// from job A.  The lint must flag job B's verify step.  Job A must pass clean.
{
  const content = `
on: push
jobs:
  notify_a:
    runs-on: ubuntu-latest
    steps:
      - name: Send heartbeat email
        id: send_heartbeat_a
        uses: dawidd6/action-send-mail@v3
        with:
          to: ops@example.com
      - name: Verify heartbeat email delivery (Resend)
        if: steps.send_heartbeat_a.conclusion == 'success'
        run: echo ok
  notify_b:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        id: send_alert_b
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: steps.send_heartbeat_a.conclusion == 'success'
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-cross-job-stale-ref');

  assert(
    'Fixture 7: cross-job stale ref — exactly one violation (job A is clean, job B fails)',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 7: cross-job stale ref — violation is in notify_b, not notify_a',
    violations.some(v => v.includes("job 'notify_b'")),
    violations.join('; ')
  );
  assert(
    'Fixture 7: cross-job stale ref — violation mentions the stale id send_heartbeat_a',
    violations.some(v => v.includes('send_heartbeat_a')),
    violations.join('; ')
  );
  assert(
    'Fixture 7: cross-job stale ref — job A (notify_a) produces no violation',
    !violations.some(v => v.includes("job 'notify_a'")),
    violations.join('; ')
  );
}

// ── Fixture 8: Check 4 isolated — stale id hidden in a compound if: ──────────
// The verify step's if: contains BOTH the correct send-mail step id (send_alert_b)
// AND a stale id from another job (phantom-from-job-a, note the hyphen to also
// exercise [\w-]+ charset handling).  Check 3 passes because send_alert_b is
// present.  Check 4 must catch phantom-from-job-a which is not a declared step
// in this job.
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        id: send_alert_b
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: steps.phantom-from-job-a.conclusion == 'success' && steps.send_alert_b.conclusion == 'success'
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-check4-isolated');

  assert(
    'Fixture 8: Check 4 isolated — exactly one violation (Check 3 passes, Check 4 fires)',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 8: Check 4 isolated — violation mentions stale id phantom-from-job-a',
    violations.some(v => v.includes('phantom-from-job-a')),
    violations.join('; ')
  );
  assert(
    'Fixture 8: Check 4 isolated — violation mentions "not a declared step id in this job"',
    violations.some(v => v.includes('not a declared step id in this job')),
    violations.join('; ')
  );
}

// ── Fixture 9: YAML fallback + multi-job cross-job stale ref ─────────────────
// A two-job workflow that breaks js-yaml (contains *missing_anchor) AND has a
// cross-job stale verify reference.  Job A (job_a) is clean.  Job B (job_b)
// has a send-mail step with id send_alert_b but its verify step's if: still
// references send_heartbeat_a from job A.
// The line-based extractor must track job boundaries and emit per-job step
// lists so that Check 4 can catch the stale reference in job B.
{
  const content = `
on: push
jobs:
  job_a:
    runs-on: ubuntu-latest
    steps:
      - name: Post to Slack
        env:
          PAYLOAD: *missing_anchor
      - name: Send heartbeat email
        id: send_heartbeat_a
        uses: dawidd6/action-send-mail@v3
        with:
          to: ops@example.com
      - name: Verify heartbeat email delivery (Resend)
        if: steps.send_heartbeat_a.conclusion == 'success'
        run: echo ok
  job_b:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        id: send_alert_b
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: steps.send_heartbeat_a.conclusion == 'success'
        run: echo ok
`;
  const { violations, usedFallback } = lint(content, 'fixture-fallback-cross-job');

  assert('Fixture 9: fallback + cross-job stale ref — line-based extractor was used', usedFallback);
  assert(
    'Fixture 9: fallback + cross-job stale ref — exactly one violation (job_a clean, job_b fails)',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 9: fallback + cross-job stale ref — violation is in job_b',
    violations.some(v => v.includes("job 'job_b'")),
    violations.join('; ')
  );
  assert(
    'Fixture 9: fallback + cross-job stale ref — violation mentions stale id send_heartbeat_a',
    violations.some(v => v.includes('send_heartbeat_a')),
    violations.join('; ')
  );
  assert(
    'Fixture 9: fallback + cross-job stale ref — job_a produces no violation',
    !violations.some(v => v.includes("job 'job_a'")),
    violations.join('; ')
  );
}

// ── Fixture 10: Check 5 — orphan verify step with pure phantom step id ────────
// A verify-name-matching step that does NOT follow any send-mail step.
// Its if: references a step id ('phantom_deleted_step') that does not exist
// anywhere in the job.  Check 5 must flag this as a phantom id.
// The other step in the job ('some_real_step') is intentionally given an id to
// confirm the phantom check is id-scoped (not a blanket false-positive).
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Some real step
        id: some_real_step
        run: echo working
      - name: Verify alert email delivery (Resend)
        if: steps.phantom_deleted_step.conclusion == 'success'
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-orphan-verify-phantom-id');

  assert(
    'Fixture 10: orphan verify phantom id — exactly one violation',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 10: orphan verify phantom id — violation mentions phantom_deleted_step',
    violations.some(v => v.includes('phantom_deleted_step')),
    violations.join('; ')
  );
  assert(
    'Fixture 10: orphan verify phantom id — violation mentions phantom id language',
    violations.some(v => v.includes('phantom id left over from a deleted step')),
    violations.join('; ')
  );
  assert(
    'Fixture 10: orphan verify phantom id — violation mentions not a declared step id',
    violations.some(v => v.includes('not a declared step id in this job')),
    violations.join('; ')
  );
}

// ── Fixture 11: 4-space indent + js-yaml failure + cross-job stale ref ───────
// A two-job workflow where:
//   (a) job names are indented with 4 spaces (non-standard), which breaks the
//       old hardcoded-2-space job boundary detector, and
//   (b) an unresolvable YAML alias (*missing_anchor) forces the line-based
//       fallback, and
//   (c) job_beta's verify step references a step id from job_alpha (stale
//       cross-job copy-paste).
// The auto-detected-indent logic must still identify both job boundaries and
// Check 4 must catch the stale reference in job_beta.  job_alpha must be clean.
{
  const content = `
on: push
jobs:
    job_alpha:
        runs-on: ubuntu-latest
        steps:
            - name: Post to Slack
              env:
                PAYLOAD: *missing_anchor
            - name: Send heartbeat email
              id: send_heartbeat_alpha
              uses: dawidd6/action-send-mail@v3
              with:
                to: ops@example.com
            - name: Verify heartbeat email delivery (Resend)
              if: steps.send_heartbeat_alpha.conclusion == 'success'
              run: echo ok
    job_beta:
        runs-on: ubuntu-latest
        steps:
            - name: Send alert email
              id: send_alert_beta
              uses: dawidd6/action-send-mail@v3
              with:
                to: admin@example.com
            - name: Verify alert email delivery (Resend)
              if: steps.send_heartbeat_alpha.conclusion == 'success'
              run: echo ok
`;
  const { violations, usedFallback, jobBoundaryDetected } = lint(content, 'fixture-4space-indent');

  assert('Fixture 11: 4-space indent — line-based extractor was used', usedFallback);
  assert('Fixture 11: 4-space indent — job boundaries were detected', jobBoundaryDetected);
  assert(
    'Fixture 11: 4-space indent — exactly one violation (job_alpha clean, job_beta fails)',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 11: 4-space indent — violation is in job_beta',
    violations.some(v => v.includes("job 'job_beta'")),
    violations.join('; ')
  );
  assert(
    'Fixture 11: 4-space indent — violation mentions stale id send_heartbeat_alpha',
    violations.some(v => v.includes('send_heartbeat_alpha')),
    violations.join('; ')
  );
  assert(
    'Fixture 11: 4-space indent — job_alpha produces no violation',
    !violations.some(v => v.includes("job 'job_alpha'")),
    violations.join('; ')
  );
}

// ── Fixture 12: Check 5a — orphan verify step with NO if: condition at all ────
// A verify-name-matching step that does NOT follow any send-mail step and has
// NO if: field whatsoever.  Check 5a must flag it as running unconditionally.
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Some real step
        id: some_real_step
        run: echo working
      - name: Verify alert email delivery (Resend)
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-orphan-verify-no-if');

  assert(
    'Fixture 12: orphan verify no if: — exactly one violation',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 12: orphan verify no if: — violation mentions missing if: condition',
    violations.some(v => v.includes('has no if: condition')),
    violations.join('; ')
  );
  assert(
    'Fixture 12: orphan verify no if: — violation mentions unconditionally',
    violations.some(v => v.includes('unconditionally')),
    violations.join('; ')
  );
}

// ── Fixture 13: Check 5b — orphan verify step with if: but no steps refs ─────
// A verify-name-matching step that does NOT follow any send-mail step.  Its
// if: is present but uses `always()` — containing zero steps.<id>.conclusion
// references.  Check 5b must flag it as not gated on any send-mail outcome.
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Some real step
        id: some_real_step
        run: echo working
      - name: Verify alert email delivery (Resend)
        if: always()
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-orphan-verify-no-steps-ref');

  assert(
    'Fixture 13: orphan verify if: always() — exactly one violation',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 13: orphan verify if: always() — violation mentions no steps.<id>.conclusion references',
    violations.some(v => v.includes('no steps.<id>.conclusion references')),
    violations.join('; ')
  );
  assert(
    'Fixture 13: orphan verify if: always() — violation shows the if: snippet',
    violations.some(v => v.includes('always()')),
    violations.join('; ')
  );
}

// ── Fixture 14: tab-indented job names + correct pairs ───────────────────────
// Two-job workflow where job names are indented with a single tab character
// (\t), which is illegal in YAML indentation and causes js-yaml to reject the
// file, triggering the line-based fallback.  Each job has a correct
// send-mail/verify pair so zero violations are expected.  The auto-detected
// indent logic must recognise the tab as the canonical job-name indent string
// and correctly detect both job boundaries (jobBoundaryDetected = true).
{
  const content = [
    'on: push',
    'jobs:',
    '\tjob_tab_a:',
    '\t  runs-on: ubuntu-latest',
    '\t  steps:',
    '\t    - name: Send heartbeat email',
    '\t      id: send_heartbeat_tab',
    '\t      uses: dawidd6/action-send-mail@v3',
    '\t      with:',
    '\t        to: ops@example.com',
    '\t    - name: Verify heartbeat email delivery (Resend)',
    "\t      if: steps.send_heartbeat_tab.conclusion == 'success'",
    '\t      run: echo ok',
    '\tjob_tab_b:',
    '\t  runs-on: ubuntu-latest',
    '\t  steps:',
    '\t    - name: Send alert email',
    '\t      id: send_alert_tab',
    '\t      uses: dawidd6/action-send-mail@v3',
    '\t      with:',
    '\t        to: admin@example.com',
    '\t    - name: Verify alert email delivery (Resend)',
    "\t      if: steps.send_alert_tab.conclusion == 'success'",
    '\t      run: echo ok',
  ].join('\n');
  const { violations, usedFallback, jobBoundaryDetected } = lint(content, 'fixture-tab-indent');

  assert('Fixture 14: tab-indent — line-based extractor was used', usedFallback);
  assert('Fixture 14: tab-indent — job boundaries were detected', jobBoundaryDetected);
  assert(
    'Fixture 14: tab-indent — zero violations (both jobs have correct pairs)',
    violations.length === 0,
    violations.join('; ')
  );
}

// ── Fixture 15: no jobs: section — reusable workflow pattern ─────────────────
// A workflow file that contains `dawidd6/action-send-mail` in a comment or
// template literal but defines no `jobs:` key (simulating a reusable workflow
// that only provides `on: workflow_call` and `inputs:`).  Both the YAML parser
// and the line-based extractor should produce zero step lists, and
// `noJobsSection` must be `true`.
{
  const content = `
on:
  workflow_call:
    inputs:
      recipient:
        required: true
        type: string
# This workflow is called by other workflows to send email via dawidd6/action-send-mail
# No jobs section is defined here — the caller provides the job context.
`;
  const { violations, noJobsSection } = lint(content, 'fixture-no-jobs-section');

  assert(
    'Fixture 15: no jobs: section — noJobsSection flag is true',
    noJobsSection === true,
    `noJobsSection = ${noJobsSection}`
  );
  assert(
    'Fixture 15: no jobs: section — zero violations (nothing to check)',
    violations.length === 0,
    violations.join('; ')
  );
}

// ── Fixture 16: Check 3a — paired verify step with NO if: condition at all ───
// A send-mail step followed immediately by a correctly-named verify step, but
// the verify step has NO if: field whatsoever.  Check 3a must emit a distinct
// "has no if: condition at all" message (not the generic "does NOT reference"
// message that Check 3c would emit).
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        id: send_alert
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-paired-verify-no-if');

  assert(
    'Fixture 16: paired verify no if: — exactly one violation',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 16: paired verify no if: — violation mentions "has no if: condition at all"',
    violations.some(v => v.includes('has no if: condition at all')),
    violations.join('; ')
  );
  assert(
    'Fixture 16: paired verify no if: — violation mentions the send-mail step id',
    violations.some(v => v.includes('send_alert')),
    violations.join('; ')
  );
  assert(
    'Fixture 16: paired verify no if: — violation mentions unconditionally',
    violations.some(v => v.includes('unconditionally')),
    violations.join('; ')
  );
}

// ── Fixture 17: Check 3b — paired verify step with if: but no steps refs ─────
// A send-mail step followed immediately by a correctly-named verify step, but
// the verify step's if: is `always()` — no steps.<id>.conclusion references.
// Check 3b must emit a distinct "contains no steps.<id>.conclusion references"
// message, not the generic "does NOT reference steps.X.conclusion" message.
{
  const content = `
on: push
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        id: send_alert
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: always()
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-paired-verify-if-always');

  assert(
    'Fixture 17: paired verify if: always() — exactly one violation',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 17: paired verify if: always() — violation mentions no steps.<id>.conclusion references',
    violations.some(v => v.includes('no steps.<id>.conclusion references')),
    violations.join('; ')
  );
  assert(
    'Fixture 17: paired verify if: always() — violation shows the if: snippet',
    violations.some(v => v.includes('always()')),
    violations.join('; ')
  );
  assert(
    'Fixture 17: paired verify if: always() — violation mentions the send-mail step id',
    violations.some(v => v.includes('send_alert')),
    violations.join('; ')
  );
}

// ── Fixture 18: Check 4 — paired verify in two-job workflow with stale cross-job id ──
// Job A (notify_a) has a correct send-mail/verify pair with id send_heartbeat_a.
// Job B (notify_b) has its own send-mail step with id send_alert_b AND a correctly-
// named verify step directly following it.  The verify step's if: contains BOTH the
// correct id for job B (send_alert_b) AND a stale id from job A (send_heartbeat_a).
// Check 3c passes because send_alert_b IS referenced.
// Check 4 must fire because send_heartbeat_a is not a declared step id in job B.
// Job A must produce no violation.
{
  const content = `
on: push
jobs:
  notify_a:
    runs-on: ubuntu-latest
    steps:
      - name: Send heartbeat email
        id: send_heartbeat_a
        uses: dawidd6/action-send-mail@v3
        with:
          to: ops@example.com
      - name: Verify heartbeat email delivery (Resend)
        if: steps.send_heartbeat_a.conclusion == 'success'
        run: echo ok
  notify_b:
    runs-on: ubuntu-latest
    steps:
      - name: Send alert email
        id: send_alert_b
        uses: dawidd6/action-send-mail@v3
        with:
          to: admin@example.com
      - name: Verify alert email delivery (Resend)
        if: steps.send_alert_b.conclusion == 'success' && steps.send_heartbeat_a.conclusion == 'success'
        run: echo ok
`;
  const { violations } = lint(content, 'fixture-check4-paired-cross-job');

  assert(
    'Fixture 18: Check 4 paired cross-job — exactly one violation (notify_a clean, notify_b fails)',
    violations.length === 1,
    violations.join('; ')
  );
  assert(
    'Fixture 18: Check 4 paired cross-job — violation is in notify_b',
    violations.some(v => v.includes("job 'notify_b'")),
    violations.join('; ')
  );
  assert(
    'Fixture 18: Check 4 paired cross-job — violation mentions stale id send_heartbeat_a',
    violations.some(v => v.includes('send_heartbeat_a')),
    violations.join('; ')
  );
  assert(
    'Fixture 18: Check 4 paired cross-job — violation mentions "not a declared step id in this job"',
    violations.some(v => v.includes('not a declared step id in this job')),
    violations.join('; ')
  );
  assert(
    'Fixture 18: Check 4 paired cross-job — job notify_a produces no violation',
    !violations.some(v => v.includes("job 'notify_a'")),
    violations.join('; ')
  );
}

// ── Fixture 19: mixed tab/space job-name indent (graceful degradation) ────────
// Two-job workflow where job A's name is tab-indented (\t) and job B's name
// is space-indented (2 spaces).  js-yaml rejects the file (tabs in YAML
// indentation), triggering the line-based fallback.  The auto-detected indent
// logic locks in the tab as the canonical job-name indent when it sees job A.
// Job B's name line uses spaces, so its indent string does NOT match the
// locked-in tab — job B is silently skipped as a boundary, and its steps
// accumulate under job A's job id rather than a separate bucket.
//
// Graceful-degradation invariant: even though job B is not recognised as a
// separate boundary, BOTH send-mail/verify pairs must be linted.  This is
// proved by checking sendMailCount === 2 (both send-mail steps were counted)
// in addition to zero violations.  Inspecting jobStepLists directly confirms
// all four steps were grouped under the single tab-indented job id.
{
  const content = [
    'on: push',
    'jobs:',
    '\tjob_mixed_tab:',
    '\t  runs-on: ubuntu-latest',
    '\t  steps:',
    '\t    - name: Send heartbeat email',
    '\t      id: send_heartbeat_mixed',
    '\t      uses: dawidd6/action-send-mail@v3',
    '\t      with:',
    '\t        to: ops@example.com',
    '\t    - name: Verify heartbeat email delivery (Resend)',
    "\t      if: steps.send_heartbeat_mixed.conclusion == 'success'",
    '\t      run: echo ok',
    '  job_mixed_space:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Send alert email',
    '        id: send_alert_mixed',
    '        uses: dawidd6/action-send-mail@v3',
    '        with:',
    '          to: admin@example.com',
    '      - name: Verify alert email delivery (Resend)',
    "        if: steps.send_alert_mixed.conclusion == 'success'",
    '        run: echo ok',
  ].join('\n');

  const { violations, sendMailCount, usedFallback, jobBoundaryDetected } = lint(content, 'fixture-mixed-indent');

  // Inspect jobStepLists directly to verify structural grouping.
  const { jobStepLists } = parseWorkflowContent(content, 'fixture-mixed-indent');
  const groupedJobIds = jobStepLists.map(j => j.jobId);
  const totalStepsAcrossGroups = jobStepLists.reduce((n, j) => n + j.steps.length, 0);

  assert('Fixture 19: mixed indent — line-based extractor was used', usedFallback);
  assert('Fixture 19: mixed indent — tab-indented job boundary was detected', jobBoundaryDetected);
  assert(
    'Fixture 19: mixed indent — both send-mail steps were linted (sendMailCount === 2)',
    sendMailCount === 2,
    `sendMailCount = ${sendMailCount}`
  );
  assert(
    'Fixture 19: mixed indent — exactly one job group produced (job B folded into tab job)',
    groupedJobIds.length === 1,
    `groupedJobIds = ${JSON.stringify(groupedJobIds)}`
  );
  assert(
    'Fixture 19: mixed indent — that group is job_mixed_tab (the locked-in tab indent)',
    groupedJobIds[0] === 'job_mixed_tab',
    `groupedJobIds[0] = ${groupedJobIds[0]}`
  );
  assert(
    'Fixture 19: mixed indent — all four steps (2 from each job) are present in the group',
    totalStepsAcrossGroups === 4,
    `totalStepsAcrossGroups = ${totalStepsAcrossGroups}`
  );
  assert(
    'Fixture 19: mixed indent — zero violations (both correct pairs linted; no false negatives)',
    violations.length === 0,
    violations.join('; ')
  );
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('');
if (failed > 0) {
  console.error(`[test-email-verify-steps] ${failed} test(s) failed, ${passed} passed.`);
  process.exit(1);
} else {
  console.log(`[test-email-verify-steps] All ${passed} tests passed ✓`);
  process.exit(0);
}
