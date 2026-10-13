#!/usr/bin/env node
/**
 * check-email-verify-steps.cjs
 *
 * Enforcement lint: every `dawidd6/action-send-mail@` step in every workflow
 * under .github/workflows/ MUST be immediately followed by a
 * "Verify … email delivery (Resend)" step that references the send-mail
 * step's `id` in its `if:` condition.
 *
 * Checks performed (per workflow file, per job, per step)
 * ────────────────────────────────────────────────────────
 * 1. Every dawidd6/action-send-mail step has an `id:` field.
 *    Without an id the verify step cannot reference it.
 *
 * 2. The step immediately following each send-mail step exists and its
 *    `name:` matches /Verify\b.*email.*delivery.*Resend/i.
 *    Examples that pass:
 *      "Verify email heartbeat delivery (Resend)"
 *      "Verify production failure email delivery (Resend)"
 *      "Verify WARNING email delivery (Resend)"
 *
 * 3. The verify step's `if:` condition string is structurally sound and
 *    references the correct send-mail step id.  Three sub-checks are applied
 *    in order:
 *    3a. The verify step has no `if:` condition at all (or an empty one) —
 *        it will run unconditionally, flagged immediately with a clear message.
 *    3b. The verify step has an `if:` condition but it contains zero
 *        `steps.<id>.conclusion` references (e.g. `if: always()`) — not
 *        gated on any step outcome, flagged with a distinct message.
 *    3c. The `if:` has step-conclusion references but none of them point to
 *        the paired send-mail step's id — flagged as a wrong reference.
 *
 * 4. The step id referenced in the verify `if:` (`steps.<id>.conclusion`)
 *    must be a declared step id within the same job.  This catches stale
 *    cross-job copy-paste where a verify step was copied from another job
 *    and its `if:` still references a step id that only exists in that
 *    other job.
 *
 * 5. Every verify-name-matching step that is NOT immediately preceded by a
 *    send-mail step (i.e. an orphan verify step) is also scanned with three
 *    sub-checks:
 *    5a. If the verify step has no `if:` condition at all (or an empty one),
 *        it will run unconditionally — flagged immediately.
 *    5b. If the verify step has an `if:` condition but it contains zero
 *        `steps.<id>.conclusion` references (e.g. `if: always()`), it is
 *        not gated on any send-mail step outcome — flagged.
 *    5c. Any `steps.<id>.conclusion` reference whose id does not exist
 *        anywhere in the current job's declared step ids is flagged as a
 *        phantom id — likely a leftover from a deleted step.
 *
 * Parsing strategy
 * ────────────────
 * js-yaml is used as the primary parser.  Some workflow files embed Slack
 * payload text containing YAML anchor-syntax characters (e.g. `*Repo:*`
 * inside a bash heredoc).  js-yaml chokes on these.  When YAML parsing
 * fails, the script falls back to a line-based step extractor that handles
 * these files correctly.  The fallback emits a ::warning:: so the quirk is
 * visible in the Actions log.
 *
 * Exit codes
 * ──────────
 *  0 — all checks passed
 *  1 — one or more violations found (details printed to stderr)
 *
 * Usage
 * ─────
 *  node scripts/check-email-verify-steps.cjs
 *
 * How to fix a failure
 * ─────────────────────
 *  1. Give the dawidd6/action-send-mail step an `id:` (e.g. `id: send_alert`).
 *  2. Add a step immediately after it whose `name:` matches the pattern
 *     "Verify … email delivery (Resend)".
 *  3. Include `steps.<id>.conclusion` in that step's `if:`.
 *  See privacy-check-weekly-digest.yml or alerting-heartbeat.yml for
 *  canonical examples.
 *
 * Module exports (for unit tests)
 * ────────────────────────────────
 *  VERIFY_NAME_RE          — the verify-step name regex
 *  verifyIfRefersToStep()  — pure predicate for check 3
 *  applyStepProp()         — property applier used by line-based extractor
 *  extractStepsLineBased() — line-based step extractor fallback
 *  parseWorkflowContent()  — parse YAML/fallback → { jobStepLists, usedFallback,
 *                              parseError, jobBoundaryDetected }
 *  checkJobSteps()         — run all four checks on a flat steps array →
 *                            array of violation strings (pure, no side-effects)
 */

'use strict';

const yaml = require('js-yaml');

// Regex that the verify-step name must satisfy.
// Deliberately loose: allows arbitrary words between "email" and "delivery"
// (e.g. "email heartbeat delivery", "failure email delivery", etc.).
const VERIFY_NAME_RE = /verify\b.*email.*delivery.*resend/i;

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** Check that the verify step's `if:` references the send-mail step id. */
function verifyIfRefersToStep(ifStr, sendMailId) {
  if (typeof ifStr !== 'string') return false;
  const needle = `steps.${sendMailId}.conclusion`;
  return ifStr.includes(needle);
}

function applyStepProp(step, key, val) {
  if (key === 'name') step.name = val.trim().replace(/^["']|["']$/g, '');
  else if (key === 'id')   step.id   = val.trim().replace(/^["']|["']$/g, '');
  else if (key === 'uses') step.uses  = val.trim();
}

// ── Line-based step extractor (fallback for files that break js-yaml) ────────
//
// Detects step boundaries using indentation heuristics:
//   - A "step list item" line has the pattern /^(\s+)- / where the indent
//     is consistent across all steps within a job.
//   - Properties within a step are at a deeper indent (no leading `- `).
//
// Job boundary detection:
//   - The `jobs:` key at indent 0 marks the start of the jobs section.
//   - The indent of the first non-empty key line inside the jobs section is
//     auto-detected and used as the canonical job-name indent.  This handles
//     both the standard 2-space indent and non-standard 4-space or tab indent
//     produced by some editors or auto-generators.
//   - Any subsequent line at exactly that same indent (as a string) matching
//     /^<indent>([\w-]+):\s*$/ is treated as a job name boundary, enabling
//     per-job step grouping (required for cross-job stale-id detection via
//     Check 4).
//   - Steps that appear before any job boundary is detected are collected
//     under the default '(line-based)' job id as a safe fallback.
//
// Returns:
//   {
//     jobStepLists:    Array<{ jobId, steps }>,
//     jobBoundaryCount: number   // how many job-name boundaries were detected
//   }
// jobBoundaryCount === 0 signals that Check 4 is degraded (the caller should
// emit a warning so the operator is aware).
function extractStepsLineBased(content) {
  const lines = content.split('\n');

  // Per-job accumulator
  const jobStepLists = [];
  let inJobsSection = false;
  let currentJobId = '(line-based)'; // default before any job boundary is found
  let currentJobSteps = [];

  // Auto-detected job-name indent string (null until first job key is seen).
  let jobNameIndentStr = null;
  // Count of detected job-name boundaries (0 ⇒ Check 4 is degraded).
  let jobBoundaryCount = 0;

  let currentStep = null;
  let currentStepIndent = -1; // indent of the `- ` that started this step
  let inIfBlock = false;
  let ifAccum = '';

  // Flush the current open step into currentJobSteps.
  const flushStep = () => {
    if (currentStep) {
      if (inIfBlock) {
        currentStep.ifCondition = ifAccum.trim();
      }
      currentJobSteps.push(currentStep);
    }
    currentStep = null;
    currentStepIndent = -1;
    inIfBlock = false;
    ifAccum = '';
  };

  // Close the current job (saving it if it has any steps) and open a new one.
  const startNewJob = (newJobId) => {
    flushStep();
    if (currentJobSteps.length > 0) {
      jobStepLists.push({ jobId: currentJobId, steps: currentJobSteps });
    }
    currentJobId = newJobId;
    currentJobSteps = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // ── Top-level key detection (indent 0) ──────────────────────────────────
    // A line starting with a non-space, non-dash character is a top-level key.
    if (raw.length > 0 && raw[0] !== ' ' && raw[0] !== '\t' && raw[0] !== '-') {
      if (/^jobs:\s*(?:#.*)?$/.test(raw)) {
        // Entering the jobs section.
        flushStep();
        if (currentJobSteps.length > 0) {
          jobStepLists.push({ jobId: currentJobId, steps: currentJobSteps });
          currentJobSteps = [];
        }
        inJobsSection = true;
      } else if (inJobsSection) {
        // A different top-level key exits the jobs section.
        flushStep();
        if (currentJobSteps.length > 0) {
          jobStepLists.push({ jobId: currentJobId, steps: currentJobSteps });
          currentJobSteps = [];
        }
        inJobsSection = false;
      }
      continue;
    }

    // ── Job name detection (auto-detected indent, inside jobs section) ─────
    // The first indented non-dash key line encountered inside the jobs: section
    // sets the canonical job-name indent string (which may be 2 spaces, 4
    // spaces, a tab, etc.).  Every subsequent line at that exact same indent
    // that matches a bare key pattern is treated as a job boundary.
    // Comparing the raw indent *string* (not just its length) handles mixed
    // tab/space files without ambiguity.
    if (inJobsSection) {
      const jobNameMatch = raw.match(/^(\s+)([\w-]+):\s*(?:#.*)?$/);
      if (jobNameMatch) {
        const indentStr = jobNameMatch[1];
        if (jobNameIndentStr === null) {
          // First indented key in the jobs section — lock in the canonical indent.
          jobNameIndentStr = indentStr;
        }
        if (indentStr === jobNameIndentStr) {
          startNewJob(jobNameMatch[2]);
          jobBoundaryCount++;
          continue;
        }
      }
    }

    // ── Step list item detection ─────────────────────────────────────────────
    // Match a step list item: `      - ` followed by a key or the step itself.
    const stepItemMatch = raw.match(/^(\s+)- /);
    if (stepItemMatch) {
      const indent = stepItemMatch[1].length;
      // Only treat as a step item if it's deeply indented enough (steps are
      // inside jobs which are inside the top-level `jobs:` key — minimum
      // 4 spaces for job-level items, steps will be at least 6).
      if (indent >= 4) {
        // If we already have an open step at the SAME or HIGHER indent level
        // (i.e. this `- ` starts a new step or a new job), flush the previous.
        if (currentStep !== null && indent <= currentStepIndent) {
          flushStep();
        }
        // Start a new step
        const afterDash = raw.slice(indent + 2); // text after `- `
        const newStep = {
          name: '',
          id: '',
          uses: '',
          ifCondition: '',
          lineNumber: i + 1,
        };
        // The first property may be on the same line as the `- `
        const inlineProp = afterDash.match(/^(\w+):\s*(.*)/);
        if (inlineProp) {
          const [, key, val] = inlineProp;
          applyStepProp(newStep, key, val);
        }
        currentStep = newStep;
        currentStepIndent = indent;
        inIfBlock = false;
        ifAccum = '';
        continue;
      }
    }

    if (!currentStep) continue;

    // We're inside a step block.  Collect its properties.
    const propMatch = raw.match(/^(\s+)(\w[\w-]*):\s*(.*)/);
    if (propMatch) {
      const propIndent = propMatch[1].length;
      const key = propMatch[2];
      const val = propMatch[3];

      // If indentation is <= step indent, this line is outside the step.
      if (propIndent <= currentStepIndent) {
        flushStep();
        // Re-process this line (it may start a new outer block)
        i--;
        continue;
      }

      if (key === 'if') {
        // The `if:` value may be a multi-line block scalar (> or |) or inline.
        if (val === '>' || val === '|' || val === '') {
          inIfBlock = true;
          ifAccum = '';
        } else {
          // Inline value
          inIfBlock = false;
          currentStep.ifCondition = val.trim();
        }
      } else {
        if (inIfBlock) {
          // Any new property at same or shallower indent ends the if block.
          if (propIndent <= currentStepIndent + 4) {
            currentStep.ifCondition = ifAccum.trim();
            inIfBlock = false;
            ifAccum = '';
          }
        }
        applyStepProp(currentStep, key, val);
      }
      continue;
    }

    // Continuation line inside an `if:` block scalar
    if (inIfBlock && raw.match(/^\s/)) {
      ifAccum += ' ' + raw.trim();
      continue;
    }

    // A non-indented line or blank line ends any open block
    if (raw.trim() === '' || !raw.match(/^\s/)) {
      if (inIfBlock) {
        currentStep.ifCondition = ifAccum.trim();
        inIfBlock = false;
        ifAccum = '';
      }
    }
  }

  // Flush the last open step and job.
  flushStep();
  if (currentJobSteps.length > 0) {
    jobStepLists.push({ jobId: currentJobId, steps: currentJobSteps });
  }

  // Safety net: ensure we always return at least one entry.
  if (jobStepLists.length === 0) {
    jobStepLists.push({ jobId: '(line-based)', steps: [] });
  }

  return { jobStepLists, jobBoundaryCount };
}

// ── parseWorkflowContent ──────────────────────────────────────────────────────
//
// Parse a workflow YAML string into per-job step lists, using js-yaml as the
// primary parser and falling back to line-based extraction on parse failure.
//
// Returns:
//   {
//     jobStepLists:      Array<{ jobId: string, steps: Array<StepObject> }>,
//     usedFallback:      boolean,      // true when line-based extractor was used
//     parseError:        string|null,  // error message if YAML parse failed
//     jobBoundaryDetected: boolean,    // false only when fallback ran AND found
//                                     // zero job-name boundaries — signals that
//                                     // Check 4 (cross-job stale-ref) is degraded
//     noJobsSection:     boolean,      // true when both YAML and line-based paths
//                                     // produced zero total steps — the file has
//                                     // no jobs: key at all (e.g. a reusable
//                                     // workflow that only defines on:/inputs:)
//   }
//
// StepObject: { jobId, name, id, uses, ifCondition, lineNumber? }
function parseWorkflowContent(content, wfName) {
  let doc;
  let usedFallback = false;
  let parseError = null;

  try {
    doc = yaml.load(content);
  } catch (e) {
    parseError = e.message.split('\n')[0];
    doc = null;
    usedFallback = true;
  }

  const jobStepLists = [];
  let jobBoundaryDetected = true; // always true for the YAML-parsed path

  if (doc && typeof doc.jobs === 'object') {
    for (const [jobId, job] of Object.entries(doc.jobs)) {
      if (!job || !Array.isArray(job.steps)) continue;
      const steps = job.steps
        .filter(Boolean)
        .map(step => ({
          jobId,
          name:        typeof step.name === 'string' ? step.name : '',
          id:          typeof step.id   === 'string' ? step.id   : '',
          uses:        typeof step.uses === 'string' ? step.uses : '',
          ifCondition: typeof step.if   === 'string' ? step.if   : '',
        }));
      jobStepLists.push({ jobId, steps });
    }
  } else {
    // Line-based fallback — extractStepsLineBased now tracks job boundaries
    // and returns per-job step lists, matching the YAML-parsed structure so
    // that cross-job stale-id detection (Check 4) is enforced on both paths.
    const { jobStepLists: perJobLists, jobBoundaryCount } = extractStepsLineBased(content);
    jobBoundaryDetected = jobBoundaryCount > 0;
    for (const { jobId, steps: rawSteps } of perJobLists) {
      const steps = rawSteps.map(s => ({
        jobId,
        name:        s.name,
        id:          s.id,
        uses:        s.uses,
        ifCondition: s.ifCondition,
        lineNumber:  s.lineNumber,
      }));
      jobStepLists.push({ jobId, steps });
    }
  }

  const totalSteps = jobStepLists.reduce((sum, { steps }) => sum + steps.length, 0);
  const noJobsSection = totalSteps === 0;

  return { jobStepLists, usedFallback, parseError, jobBoundaryDetected, noJobsSection };
}

// ── checkJobSteps ─────────────────────────────────────────────────────────────
//
// Run the five send-mail verify checks against a single job's steps array.
// Pure function — no I/O, no global state mutation.
//
// Parameters:
//   steps    — flat array of StepObjects for one job (in document order)
//   context  — string prefix for violation messages (e.g. "my-workflow.yml → job 'build'")
//
// Returns:
//   { violations: string[], sendMailCount: number }
//   violations     — one entry per failing send-mail step (or orphan verify step)
//   sendMailCount  — how many dawidd6/action-send-mail@ steps were found
function checkJobSteps(steps, context) {
  const violations = [];
  let sendMailCount = 0;

  // Collect all declared step ids within this job for cross-job stale-ref detection.
  const jobStepIds = new Set(
    steps.map(s => (s.id || '').trim()).filter(Boolean)
  );

  // Track which step indices are "paired" verify steps (immediately following a
  // send-mail step).  These are covered by Checks 1-4; they are excluded from
  // the standalone Check 5 scan to avoid duplicate violation messages.
  const pairedVerifyIndices = new Set();
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].uses && steps[i].uses.startsWith('dawidd6/action-send-mail@')) {
      if (i + 1 < steps.length && VERIFY_NAME_RE.test(steps[i + 1].name)) {
        pairedVerifyIndices.add(i + 1);
      }
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.uses.startsWith('dawidd6/action-send-mail@')) continue;

    sendMailCount++;

    const locParts = [context];
    if (step.lineNumber) locParts.push(`line ${step.lineNumber}`);
    const location = locParts.join(' → ');
    const stepDisplay = step.name ? `"${step.name}"` : `(unnamed, uses: ${step.uses})`;

    // ── Check 1: step must have an id ──────────────────────────────────────
    const sendMailId = (step.id || '').trim();
    if (!sendMailId) {
      violations.push(
        `${location}: send-mail step ${stepDisplay} has no 'id:' field. ` +
        `The following verify step needs the id to reference it in its if: condition.`
      );
      continue;
    }

    // ── Check 2: immediately following step (within the same job) ──────────
    const nextStep = steps[i + 1]; // undefined when send-mail is last in job
    if (!nextStep) {
      violations.push(
        `${location}: send-mail step ${stepDisplay} (id: '${sendMailId}') ` +
        `is the last step in the job — no verify step follows it.`
      );
      continue;
    }

    if (!VERIFY_NAME_RE.test(nextStep.name)) {
      const nextDisplay = nextStep.name ? `"${nextStep.name}"` : '(unnamed)';
      violations.push(
        `${location}: send-mail step ${stepDisplay} (id: '${sendMailId}') ` +
        `is NOT immediately followed by a "Verify … email delivery (Resend)" step. ` +
        `Next step is: ${nextDisplay}.`
      );
      continue;
    }

    // ── Check 3: verify step's if: must reference THIS send-mail step id ───
    // Three sub-checks applied in order so each failure gets a distinct,
    // actionable message rather than a generic "does not reference" message.
    {
      const verifyIfStr = (nextStep.ifCondition || '').trim();

      // ── Check 3a: if: is missing or empty ─────────────────────────────
      if (!verifyIfStr) {
        violations.push(
          `${location}: verify step "${nextStep.name}" has no if: condition at all — ` +
          `it will run unconditionally regardless of whether the send-mail step ` +
          `'${sendMailId}' succeeded. Add: if: steps.${sendMailId}.conclusion == 'success'`
        );
        continue;
      }

      // ── Check 3b: if: present but no steps.<id>.conclusion references ─
      const refIdRe3b = /steps\.([\w-]+)\.conclusion/g;
      const refIds3b = [];
      let m3b;
      while ((m3b = refIdRe3b.exec(verifyIfStr)) !== null) refIds3b.push(m3b[1]);

      if (refIds3b.length === 0) {
        const ifSnippet = verifyIfStr.slice(0, 120).replace(/\n/g, ' ');
        violations.push(
          `${location}: verify step "${nextStep.name}" has an if: condition that ` +
          `contains no steps.<id>.conclusion references — it is not gated on any ` +
          `step outcome (e.g. if: always()). ` +
          `Expected a reference to steps.${sendMailId}.conclusion. ` +
          `if: = "${ifSnippet}"`
        );
        continue;
      }

      // ── Check 3c: if: has refs but none point to THIS send-mail step ──
      if (!verifyIfRefersToStep(nextStep.ifCondition, sendMailId)) {
        const ifSnippet = verifyIfStr.slice(0, 120).replace(/\n/g, ' ');
        violations.push(
          `${location}: verify step "${nextStep.name}" does NOT reference ` +
          `'steps.${sendMailId}.conclusion' in its if: condition. ` +
          `if: = "${ifSnippet}"`
        );
        continue;
      }
    }

    // ── Check 4: every id referenced via steps.<id>.conclusion in the verify
    //             if: must be a declared step id within this same job.
    //             Uses [\w-]+ to cover GitHub's full step-id charset (letters,
    //             digits, underscores, hyphens).  Scans ALL occurrences so a
    //             stale cross-job id is caught even when the correct id also
    //             appears in the same condition. ─────────────────────────────
    {
      const ifStr = nextStep.ifCondition || '';
      const refIdRe = /steps\.([\w-]+)\.conclusion/g;
      let match;
      let check4Passed = true;
      while ((match = refIdRe.exec(ifStr)) !== null) {
        const referencedId = match[1];
        if (!jobStepIds.has(referencedId)) {
          const ifSnippet = ifStr.trim().slice(0, 120).replace(/\n/g, ' ');
          violations.push(
            `${location}: verify step "${nextStep.name}" references ` +
            `'steps.${referencedId}.conclusion' in its if: condition, but ` +
            `'${referencedId}' is not a declared step id in this job — ` +
            `it may be a stale copy-paste from a different job. ` +
            `if: = "${ifSnippet}"`
          );
          check4Passed = false;
          break; // one violation per send-mail/verify pair is enough
        }
      }
      if (!check4Passed) continue;
    }
  }

  // ── Check 5: orphan verify steps — missing/invalid if: conditions ───────────
  // Scan every verify-name-matching step that is NOT paired with a preceding
  // send-mail step.  Three sub-checks are applied in order:
  //   5a. No if: condition at all (or empty) → runs unconditionally.
  //   5b. if: present but contains zero steps.<id>.conclusion references
  //       (e.g. `if: always()`) → not gated on any send-mail outcome.
  //   5c. A steps.<id>.conclusion reference whose id is not declared in this
  //       job → phantom id left over from a deleted step.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!VERIFY_NAME_RE.test(step.name)) continue;
    if (pairedVerifyIndices.has(i)) continue; // already covered by Checks 1-4

    const ifStr = step.ifCondition || '';
    const locParts = [context];
    if (step.lineNumber) locParts.push(`line ${step.lineNumber}`);
    const location = locParts.join(' → ');

    // ── Check 5a: if: is missing or empty ─────────────────────────────────
    if (!ifStr.trim()) {
      violations.push(
        `${location}: verify step "${step.name}" has no if: condition — ` +
        `it will run unconditionally regardless of whether any send-mail step ` +
        `succeeded. Add an if: referencing the send-mail step's ` +
        `steps.<id>.conclusion.`
      );
      continue; // no further checks needed for this step
    }

    // Collect all steps.<id>.conclusion references in the if: string.
    const refIdRe = /steps\.([\w-]+)\.conclusion/g;
    const refIds = [];
    let match;
    while ((match = refIdRe.exec(ifStr)) !== null) {
      refIds.push(match[1]);
    }

    // ── Check 5b: if: present but no steps.<id>.conclusion references ─────
    if (refIds.length === 0) {
      const ifSnippet = ifStr.trim().slice(0, 120).replace(/\n/g, ' ');
      violations.push(
        `${location}: verify step "${step.name}" has an if: condition that ` +
        `contains no steps.<id>.conclusion references — it will not be gated ` +
        `on any send-mail step's outcome. if: = "${ifSnippet}"`
      );
      continue; // no further checks needed for this step
    }

    // ── Check 5c: phantom step id references ──────────────────────────────
    for (const referencedId of refIds) {
      if (!jobStepIds.has(referencedId)) {
        const ifSnippet = ifStr.trim().slice(0, 120).replace(/\n/g, ' ');
        violations.push(
          `${location}: verify step "${step.name}" references ` +
          `'steps.${referencedId}.conclusion' in its if: condition, but ` +
          `'${referencedId}' is not a declared step id in this job — ` +
          `it may be a phantom id left over from a deleted step. ` +
          `if: = "${ifSnippet}"`
        );
        break; // one violation per orphan verify step is enough
      }
    }
  }

  return { violations, sendMailCount };
}

// ── Module exports (consumed by test-email-verify-steps.cjs) ─────────────────
module.exports = {
  VERIFY_NAME_RE,
  verifyIfRefersToStep,
  applyStepProp,
  extractStepsLineBased,
  parseWorkflowContent,
  checkJobSteps,
};

// ── CLI entry-point ───────────────────────────────────────────────────────────
// Only runs when executed directly (not when required by unit tests).
if (require.main === module) {
  const fs   = require('fs');
  const path = require('path');

  const WORKFLOWS_DIR = path.resolve(__dirname, '../.github/workflows');

  let workflowFiles;
  try {
    workflowFiles = fs.readdirSync(WORKFLOWS_DIR)
      .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map(f => path.join(WORKFLOWS_DIR, f));
  } catch (e) {
    console.error(`FAIL: Cannot read workflows directory — ${e.message}`);
    process.exit(1);
  }

  if (workflowFiles.length === 0) {
    console.error('FAIL: No workflow files found under .github/workflows/');
    process.exit(1);
  }

  console.log(
    `\n[check-email-verify-steps] Scanning ${workflowFiles.length} workflow file(s)` +
    ` under .github/workflows/\n`
  );

  let totalViolations = 0;
  let totalSendMailSteps = 0;
  let filesChecked = 0;

  for (const wfPath of workflowFiles) {
    const wfName = path.basename(wfPath);

    let raw;
    try {
      raw = fs.readFileSync(wfPath, 'utf8');
    } catch (e) {
      console.error(`  FAIL [${wfName}]: Cannot read file — ${e.message}`);
      totalViolations++;
      continue;
    }

    // Skip files that don't reference action-send-mail at all (fast path).
    if (!raw.includes('dawidd6/action-send-mail')) {
      continue;
    }

    filesChecked++;

    const { jobStepLists, usedFallback, parseError, jobBoundaryDetected, noJobsSection } =
      parseWorkflowContent(raw, wfName);

    if (usedFallback) {
      console.warn(
        `  warning [${wfName}]: YAML parse failed (${parseError}). ` +
        `Falling back to line-based step extraction.`
      );
    }

    if (noJobsSection) {
      console.warn(
        `  ::warning:: [${wfName}]: no jobs: section was found (or it contains no ` +
        `steps). This file references dawidd6/action-send-mail but could not be ` +
        `parsed into any job step lists — it may be a reusable workflow that only ` +
        `defines on:/inputs:, or it may be misconfigured. Investigate this file.`
      );
      continue;
    }

    if (!jobBoundaryDetected) {
      console.warn(
        `  ::warning:: [${wfName}]: line-based extractor could not detect any job ` +
        `boundaries — cross-job stale-id detection (Check 4) may be degraded. ` +
        `Ensure job names are indented consistently (2 or 4 spaces) inside the jobs: section.`
      );
    }

    const fileViolations = [];

    for (const { jobId, steps } of jobStepLists) {
      const context = `${wfName} → job '${jobId}'`;
      const { violations, sendMailCount } = checkJobSteps(steps, context);

      totalSendMailSteps += sendMailCount;

      for (const v of violations) {
        fileViolations.push(v);
      }

      // Log ok steps (those that passed all four checks).
      const allStepIdsForLog = new Set(
        steps.map(s => (s.id || '').trim()).filter(Boolean)
      );
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!step.uses.startsWith('dawidd6/action-send-mail@')) continue;
        const sendMailId = (step.id || '').trim();
        if (!sendMailId) continue;
        const nextStep = steps[i + 1];
        if (!nextStep || !VERIFY_NAME_RE.test(nextStep.name)) continue;
        if (!verifyIfRefersToStep(nextStep.ifCondition, sendMailId)) continue;
        // Check 4: all steps.<id>.conclusion refs must be declared in this job.
        const refIdRe = /steps\.([\w-]+)\.conclusion/g;
        let check4Ok = true;
        let m;
        while ((m = refIdRe.exec(nextStep.ifCondition || '')) !== null) {
          if (!allStepIdsForLog.has(m[1])) { check4Ok = false; break; }
        }
        if (!check4Ok) continue;
        console.log(
          `  ok  [${wfName}] job '${jobId}': ` +
          `'${sendMailId}' → "${nextStep.name}"`
        );
      }
    }

    if (fileViolations.length > 0) {
      for (const v of fileViolations) {
        console.error(`  FAIL: ${v}`);
      }
      totalViolations += fileViolations.length;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('');
  console.log(
    `Scanned ${filesChecked} workflow file(s) containing dawidd6/action-send-mail steps.`
  );
  console.log(`Found ${totalSendMailSteps} send-mail step(s) total.`);

  if (totalViolations > 0) {
    console.error('');
    console.error(
      `FAIL: ${totalViolations} violation(s) found. ` +
      `Every dawidd6/action-send-mail step must have an id: and be immediately ` +
      `followed by a "Verify … email delivery (Resend)" step that references ` +
      `steps.<id>.conclusion in its if: condition. ` +
      `See privacy-check-weekly-digest.yml for a canonical example.`
    );
    process.exit(1);
  }

  console.log('All send-mail steps have a matching verify step. ✓');
  process.exit(0);
}
