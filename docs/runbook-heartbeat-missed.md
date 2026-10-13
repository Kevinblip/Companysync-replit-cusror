# Runbook: Missed Heartbeat Alert

**Trigger**: You received an alert from Healthchecks.io, Cronitor, BetterUptime, or similar — indicating the weekly heartbeat did not check in within the expected window.

**What this means**: The `alerting-heartbeat.yml` GitHub Actions workflow may have failed silently, stopped running entirely, or its ping to the dead-man's switch did not complete. This does **not** necessarily mean a production incident is active, but it does mean your alerting pipeline may be dark.

---

## Step 1 — Check the GitHub Actions tab

1. Go to the repository on GitHub.
2. Click **Actions** in the top navigation bar.
3. In the left sidebar, select the **Alerting Heartbeat** workflow.
4. Look at the most recent runs (expected weekly on Mondays at 09:00 UTC).

| What you see | What it means |
|---|---|
| Last run succeeded (green), `Ping dead-man's switch` step is green | Transient network hiccup between GitHub and the monitoring service — see [Step 2](#step-2--confirm-the-ping-url-is-still-valid). |
| Last run succeeded (green), `Ping dead-man's switch` step was skipped | `HEARTBEAT_CHECKIN_URL` secret is missing — see [Step 4](#step-4--check-and-restore-secrets). |
| Last run failed (red) | Inspect the failing step — see [Step 3](#step-3--investigate-a-failed-run). |
| No runs in the last 8 days | Workflow is not firing — see [Step 5](#step-5--workflow-not-firing-at-all). |

---

## Step 2 — Confirm the ping URL is still valid

1. Log in to your monitoring service (Healthchecks.io / Cronitor / BetterUptime).
2. Find the check named **Alerting Heartbeat** (or equivalent).
3. Check when the last ping was received. If the service shows a ping arrived close to the expected time, the alert was a false positive (network delay, clock skew). Monitor for next week.
4. If the check URL itself was deleted or regenerated in the monitoring service, the old `HEARTBEAT_CHECKIN_URL` secret is now stale — follow [Step 4](#step-4--check-and-restore-secrets) to update it.

---

## Step 3 — Investigate a failed run

Open the failing workflow run in the Actions tab and expand each step:

**`Send Slack heartbeat`**
- A non-2xx response means `SLACK_WEBHOOK_URL` is invalid or the Slack app was removed. Rotate the webhook in Slack and update the secret.
- `curl: (6) Could not resolve host` — transient DNS failure; re-run the workflow manually once before escalating.

**`Send email heartbeat`**
- SMTP auth failure → password rotated or app-password revoked. Regenerate (see worked examples in `docs/post-deploy-privacy-alerts.md` §3).
- `ONCALL_EMAIL` or `SMTP_SERVER` missing → step was supposed to be skipped; check that both secrets are present.

**`Ping dead-man's switch`**
- Non-2xx from the ping URL → the check was paused, deleted, or the URL changed in the monitoring service. Update `HEARTBEAT_CHECKIN_URL`.

After fixing the root cause, trigger a manual run (**Actions → Alerting Heartbeat → Run workflow**) and confirm all steps are green before closing the incident.

---

## Step 4 — Check and restore secrets

1. Go to **Settings → Secrets and variables → Actions** in the repository.
2. Verify the following secrets exist and are non-empty:

   | Secret | Purpose |
   |---|---|
   | `SLACK_WEBHOOK_URL` | Slack incoming webhook for heartbeat and failure alerts |
   | `ONCALL_EMAIL` | Comma-separated email recipients |
   | `SMTP_SERVER` | SMTP host (GitHub Actions path) |
   | `SMTP_PORT` | SMTP port — `465` or `587` |
   | `SMTP_USERNAME` | SMTP auth username |
   | `SMTP_PASSWORD` | SMTP auth password / app password / API key |
   | `SMTP_FROM` | Sender address (optional; defaults to `SMTP_USERNAME`) |
   | `HEARTBEAT_CHECKIN_URL` | Dead-man's switch ping URL |

3. If a secret is missing or stale, recreate it (**New repository secret** or click the secret to update it).
4. After restoring secrets, trigger the heartbeat manually and confirm all steps pass.

---

## Step 5 — Workflow not firing at all

If the **Actions** tab shows no runs of `alerting-heartbeat.yml` in the past 8 days, work through these causes in order:

### A. Repository is archived

Archived repositories cannot run GitHub Actions. If the repo was accidentally archived:
1. Go to **Settings → General → Danger Zone**.
2. Click **Unarchive this repository** and confirm.
3. Trigger the heartbeat manually to verify it fires.

### B. GitHub Actions minutes exhausted

1. Go to the GitHub organization (or personal account) **Settings → Billing and plans → Plans and usage**.
2. Check the **GitHub Actions** minutes usage for the current billing cycle.
3. If minutes are at or near the limit:
   - Upgrade the plan, or
   - Wait for the billing cycle to reset, or
   - Enable a self-hosted runner for the alerting workflow.

### C. Cron scheduler silently dropped the job

GitHub's cron scheduler occasionally delays or skips jobs on repositories with low activity. The official workaround is:
1. Trigger the workflow manually now (**Actions → Alerting Heartbeat → Run workflow**) to confirm the workflow itself is healthy.
2. If manual runs succeed but scheduled runs are still missing, add a trivial commit (e.g. touch a file, amend a comment) to signal activity to GitHub's scheduler.

### D. Workflow file was modified or deleted

Check that `.github/workflows/alerting-heartbeat.yml` still exists on the default branch and that the `schedule` trigger is intact:

```yaml
on:
  schedule:
    - cron: '0 9 * * 1'   # Every Monday at 09:00 UTC
  workflow_dispatch:       # Manual trigger
```

If the file was deleted or the cron removed, restore it from git history (`git log --diff-filter=D -- .github/workflows/alerting-heartbeat.yml`) and push the fix.

---

## Recovery verification checklist

Before closing the incident, confirm all of the following:

- [ ] A manual run of **Alerting Heartbeat** completed with **all steps green**.
- [ ] The monitoring service dashboard shows a **"ping received"** event timestamped within the last 30 minutes.
- [ ] The Slack channel received the `[HEARTBEAT]` message.
- [ ] The `ONCALL_EMAIL` inbox received the `[HEARTBEAT]` email.
- [ ] The root cause is documented (update this runbook if a new failure mode was discovered).

---

## Escalation

If you cannot restore the heartbeat within 30 minutes:

1. Disable the dead-man's switch check in the monitoring service temporarily (to stop repeat pages while you work).
2. Escalate to the on-call engineering lead.
3. Manually run `scripts/post-deploy-privacy-check.sh` locally against production to verify privacy guards are still active while the automated pipeline is down.
4. Re-enable the monitoring check once the workflow is healthy again.
