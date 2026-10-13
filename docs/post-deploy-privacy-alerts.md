# Post-Deploy Privacy Check — On-Call Alerts

The post-deploy portal privacy check runs the full smoke test
(`scripts/test-portal-privacy.cjs`) against the live production (and staging)
URL after every successful deploy. When an assertion fails, on-call can be
notified through two independent channels:

1. **Slack** — via an Incoming Webhook (`SLACK_WEBHOOK_URL`).
2. **Email** — via SMTP (added on top of Slack — see below).

Slack and email alerts are **additive**: configuring email does not disable
Slack, and vice versa. Configure either, both, or neither. If a channel's
secrets are missing, that channel is silently skipped — the test itself still
fails the build.

There are two places the check runs from, each with its own way of reading
SMTP config:

- The **GitHub Actions workflow** (`.github/workflows/post-deploy-privacy-check.yml`)
  uses the [`dawidd6/action-send-mail`](https://github.com/dawidd6/action-send-mail)
  action and reads discrete `SMTP_SERVER` / `SMTP_PORT` secrets.
- The **standalone shell script** (`scripts/post-deploy-privacy-check.sh`)
  uses `curl`'s SMTP support and reads a single `SMTP_URL`.

Both flows share `ONCALL_EMAIL`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and
`SMTP_FROM`.

---

## 1. Enabling email alerts in GitHub Actions

Add the following repository secrets (Settings → Secrets and variables →
Actions → New repository secret). Email alerts only fire when **both**
`ONCALL_EMAIL` and `SMTP_SERVER` are set; if either is missing, the email
step is skipped and Slack alerts (if configured) still fire.

| Secret          | Required | Description                                                                      |
| --------------- | -------- | -------------------------------------------------------------------------------- |
| `ONCALL_EMAIL`  | yes      | Comma-separated recipient list, e.g. `oncall@example.com,backup@example.com`.    |
| `SMTP_SERVER`   | yes      | SMTP host, e.g. `smtp.gmail.com` or `smtp.sendgrid.net`.                         |
| `SMTP_PORT`     | yes      | SMTP port — `465` for implicit SSL, `587` for STARTTLS.                          |
| `SMTP_USERNAME` | yes      | SMTP auth username (often the full email address, or `apikey` for SendGrid).     |
| `SMTP_PASSWORD` | yes      | SMTP auth password or app-password / API key.                                    |
| `SMTP_FROM`     | no       | `From:` address. Defaults to `SMTP_USERNAME` if unset.                           |

The workflow already wires these into the `Notify on-call by email on failure`
step for both the production and staging jobs — no YAML changes are needed
once the secrets are present.

## 2. Enabling email alerts from the shell script

When invoking `scripts/post-deploy-privacy-check.sh` directly (cron, a deploy
hook, a different CI), export these variables. All four required variables
(`ONCALL_EMAIL`, `SMTP_URL`, `SMTP_USERNAME`, `SMTP_PASSWORD`) must be set
for the email step to fire; otherwise it is silently skipped. `SMTP_FROM`
is optional and defaults to `SMTP_USERNAME`.

| Variable        | Required | Description                                                                      |
| --------------- | -------- | -------------------------------------------------------------------------------- |
| `ONCALL_EMAIL`  | yes      | Comma-separated recipient list.                                                  |
| `SMTP_URL`      | yes      | Full SMTP URL, e.g. `smtps://smtp.gmail.com:465` or `smtp://smtp.sendgrid.net:587`. |
| `SMTP_USERNAME` | yes      | SMTP auth username.                                                              |
| `SMTP_PASSWORD` | yes      | SMTP auth password / app password / API key.                                     |
| `SMTP_FROM`     | no       | `From:` address. Defaults to `SMTP_USERNAME`.                                    |

Example:

```bash
export BASE_URL=https://your-app.up.railway.app
export DATABASE_URL=postgres://...
export SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T000/B000/XXXX

export ONCALL_EMAIL="oncall@example.com,backup@example.com"
export SMTP_URL="smtps://smtp.gmail.com:465"
export SMTP_USERNAME="alerts@example.com"
export SMTP_PASSWORD="abcd efgh ijkl mnop"   # Gmail app password
export SMTP_FROM="alerts@example.com"

bash scripts/post-deploy-privacy-check.sh
```

---

## 3. Worked examples

### Gmail (app password)

Gmail blocks plain-password SMTP for accounts with 2-step verification, so
you must generate an **app password** first
(<https://myaccount.google.com/apppasswords>). Use the 16-character app
password — not your real Google password — for `SMTP_PASSWORD`.

GitHub Actions secrets:

```
ONCALL_EMAIL  = oncall@example.com
SMTP_SERVER   = smtp.gmail.com
SMTP_PORT     = 465
SMTP_USERNAME = alerts@example.com
SMTP_PASSWORD = abcdefghijklmnop          # 16-char app password, no spaces
SMTP_FROM     = alerts@example.com
```

Shell-script env vars:

```bash
ONCALL_EMAIL="oncall@example.com"
SMTP_URL="smtps://smtp.gmail.com:465"
SMTP_USERNAME="alerts@example.com"
SMTP_PASSWORD="abcdefghijklmnop"
SMTP_FROM="alerts@example.com"
```

Notes:

- Port `465` uses implicit SSL (`smtps://` in `SMTP_URL`). Port `587` works
  too — use `smtp://smtp.gmail.com:587` for STARTTLS.
- The `From:` address must match the authenticated Gmail account, otherwise
  Gmail rewrites or rejects the message.

### SendGrid (SMTP relay)

Generate an API key with at least **Mail Send** permission
(<https://app.sendgrid.com/settings/api_keys>). The username is literally the
string `apikey`; the password is the generated key.

GitHub Actions secrets:

```
ONCALL_EMAIL  = oncall@example.com,backup@example.com
SMTP_SERVER   = smtp.sendgrid.net
SMTP_PORT     = 587
SMTP_USERNAME = apikey
SMTP_PASSWORD = SG.xxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
SMTP_FROM     = alerts@your-verified-domain.com
```

Shell-script env vars:

```bash
ONCALL_EMAIL="oncall@example.com,backup@example.com"
SMTP_URL="smtp://smtp.sendgrid.net:587"
SMTP_USERNAME="apikey"
SMTP_PASSWORD="SG.xxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy"
SMTP_FROM="alerts@your-verified-domain.com"
```

Notes:

- `SMTP_FROM` must use a domain or single-sender address that has been
  verified in SendGrid, otherwise the message is rejected.
- `587` (STARTTLS) is the recommended SendGrid port. `465` (implicit TLS)
  also works — use `smtps://smtp.sendgrid.net:465` in `SMTP_URL`.

---

## 4. Weekly digest with assertion failure history

The weekly digest workflow (`.github/workflows/privacy-check-weekly-digest.yml`)
runs every **Monday at 09:00 UTC** and now includes a **7-day assertion failure
history** section in every email it sends — both the WARNING (stale workflow)
and the normal DIGEST (opt-in healthy confirmation).

### What the history section shows

For each of the two monitored post-deploy check workflows the history block
reports:

| Field | Description |
|---|---|
| Total runs | Number of completed runs in the past 7 days |
| Passed | Runs that concluded `success` |
| Failed | Runs that concluded anything other than `success` |
| Pass rate | `passed / total × 100` (integer %) |
| Failed assertions | Ranked list of every assertion that failed at least once, with occurrence count |

Example section in the email:

```
7-day run history (since 29 Apr 2026)
─────────────────────────────────────────
post-deploy-privacy-check.yml
  Total runs : 4
  Passed     : 3
  Failed     : 1
  Pass rate  : 75%

  Failed assertions (ranked by frequency):
    [2x] Private log (is_public=false) does NOT appear in portal response
    [1x] Response status is 200 (got 503)

post-deploy-body-limit-check.yml
  Total runs : 4
  Passed     : 4
  Failed     : 0
  Pass rate  : 100%

  No assertion failures recorded.
```

### How assertion names are extracted

When a run fails, the workflow fetches the raw log text for every job in that
run using the GitHub Actions API. Both test scripts emit failure lines in the
format:

```
  ✗  <assertion description>
```

The digest strips the timestamp prefix and `✗` marker, collects every such
line across all failed runs, then uses `sort | uniq -c | sort -rn` to rank
them by frequency. Up to 20 failed runs are inspected per workflow per week
to stay within API rate limits; this cap is generous enough to cover any
realistic failure rate.

### What "no assertion-level data available" means

If GitHub's log API returns empty or inaccessible content for a failed run
(e.g., logs have been deleted after the default 90-day retention window, or
the failure was a setup error before the test script ran), the digest prints
`(no assertion-level data available)` rather than a ranked list. The run
counts (total / passed / failed / pass rate) are always accurate regardless.

### Triggering the digest manually

To preview the history output without waiting for Monday:
**Actions → Privacy Check Weekly Digest → Run workflow.**

No configuration changes are required — the same `ONCALL_EMAIL` and `SMTP_*`
secrets used by the failure alerts are reused here.

---

## 5. Monitored workflows — alert channel inventory

The table below maps every post-deploy workflow to the alert channels it uses
and indicates whether each channel is exercised by the weekly heartbeat.

| Workflow file | Slack (`SLACK_WEBHOOK_URL`) | Email (SMTP) | Heartbeat coverage |
|---|---|---|---|
| `post-deploy-privacy-check.yml` | ✅ on failure | ✅ on failure | ✅ Slack + email heartbeat |
| `post-deploy-body-limit-check.yml` | ✅ on failure | ✅ on failure | ✅ Slack + email heartbeat (same secrets) |
| `portal-privacy.yml` | ❌ none | ❌ none | n/a — no dedicated alert channels; relies on GitHub's native job-failure notification |

`post-deploy-privacy-check.yml` and `post-deploy-body-limit-check.yml` share
the exact same set of secrets (`SLACK_WEBHOOK_URL`, `ONCALL_EMAIL`,
`SMTP_SERVER`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`).
One heartbeat ping through those channels validates both workflows' alerting
paths simultaneously.

`portal-privacy.yml` is a pure CI workflow: it runs a static SQL guard and an
HTTP smoke test but sends no Slack messages or emails of its own. Failure
notifications for that workflow come from GitHub's built-in email to
repository collaborators. There are no additional secrets or webhook URLs to
heartbeat.

---

## 6. Weekly alerting heartbeat

A separate workflow (`.github/workflows/alerting-heartbeat.yml`) sends a
quiet "heartbeat OK" ping through the Slack webhook and SMTP path shared by
the post-deploy alerting workflows every **Monday at 09:00 UTC**. Its purpose
is to surface broken alerting credentials before a real incident occurs — if
SMTP credentials silently expire (rotated app password, revoked SendGrid key,
changed sender domain), on-call hears about it on Monday morning rather than
during an actual outage.

**Workflows covered by the heartbeat:**

- `post-deploy-privacy-check.yml` — Slack + SMTP
- `post-deploy-body-limit-check.yml` — Slack + SMTP (identical secrets; one
  ping exercises both)

**Not covered (no dedicated alert channels):**

- `portal-privacy.yml` — relies on GitHub's native job-failure notification;
  no `SLACK_WEBHOOK_URL` or SMTP steps to exercise.

The heartbeat clearly identifies itself so it is never confused with a real
alert:

- **Slack** — message text starts with `:white_check_mark: *[HEARTBEAT]*`
- **Email** — subject starts with `[HEARTBEAT]`

Both channels use exactly the same secrets as the privacy-check and body-limit
failure alerts (`SLACK_WEBHOOK_URL`, `ONCALL_EMAIL`, `SMTP_SERVER`,
`SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`). No additional
configuration is required. If a channel's secrets are not set, that channel
is silently skipped by the heartbeat (same behaviour as the failure alerts).

Failure of the heartbeat job itself is visible in the **Actions** tab under
the "Alerting Heartbeat" workflow. The Slack step uses `curl --fail` so any
non-2xx HTTP response from the webhook fails the step and marks the run red.

You can also trigger the heartbeat manually at any time:
**Actions → Alerting Heartbeat → Run workflow.**

### 5a. Dead-man's switch — alerting when the heartbeat itself stops

The Slack + email heartbeat only detects broken credentials. It cannot detect
the case where the workflow **itself** stops firing — for example because the
repository is archived, GitHub Actions minutes are exhausted, or the cron
scheduler silently drops the job.

A dead-man's switch closes this gap: the heartbeat pings an **external**
uptime-monitoring service at the end of every run. If the service does not
receive a ping within its configured grace period (~24 hours is recommended
for a weekly job), it alerts on-call through its own independent channel.

#### Setting up the dead-man's switch

1. **Choose a monitoring service.** Any service that supports scheduled
   check-in pings works. Recommended free options:
   - [Healthchecks.io](https://healthchecks.io) — free tier supports up to
     20 checks; no credit card required.
   - [Cronitor](https://cronitor.io) — free tier for up to 5 monitors.
   - [BetterUptime](https://betteruptime.com) — free heartbeat monitors
     included.

2. **Create a new check** in the service:
   - **Period / schedule**: `1 week` (or `weekly`).
   - **Grace period**: `24 hours` — this is the window after the expected
     run time before the service fires an alert.

3. **Copy the unique ping URL** the service provides (e.g.,
   `https://hc-ping.com/<uuid>` for Healthchecks.io).

4. **Save the URL as a GitHub Actions secret** named
   `HEARTBEAT_CHECKIN_URL`:
   - Go to **Settings → Secrets and variables → Actions → New repository
     secret**.
   - Name: `HEARTBEAT_CHECKIN_URL`
   - Value: the ping URL from step 3.

5. The workflow's final step (`Ping dead-man's switch`) will now `curl` that
   URL after every successful run. The step is silently skipped when the
   secret is absent, so existing setups without a dead-man's switch are
   unaffected.

#### How it works end-to-end

```
Every Monday 09:00 UTC
  → GitHub Actions runs alerting-heartbeat.yml
      → Slack heartbeat sent
      → Email heartbeat sent
      → curl $HEARTBEAT_CHECKIN_URL   ← tells the monitor "still alive"

If the workflow stops running (any reason):
  → Monitor receives no ping within grace period (24 h after expected time)
  → Monitor sends its own alert to on-call (email / SMS / PagerDuty / etc.)
```

#### Verifying the dead-man's switch

After adding the secret, trigger the workflow manually
(**Actions → Alerting Heartbeat → Run workflow**) and confirm the
`Ping dead-man's switch` step succeeds in the run log. Then check the
monitoring service's dashboard to confirm a "ping received" event was
recorded.

To test the alert path, temporarily pause or delete the check in the
monitoring service, wait for the grace period, and confirm you receive
an alert. Restore the check afterwards.

#### Responding to a missed heartbeat alert

When the monitoring service fires a "heartbeat missed" alert, follow the
step-by-step triage checklist in
**[`docs/runbook-heartbeat-missed.md`](runbook-heartbeat-missed.md)**.
It covers: checking the Actions tab, investigating failed steps, auditing
and restoring secrets, handling exhausted minutes, archived repos, and
cron scheduler issues, plus a recovery verification checklist before
closing the incident.

---

## 7. Verifying the alerts

> **On-call triage**: When an alert fires because a smoke-test assertion actually
> failed (not because the heartbeat stopped), follow the step-by-step triage
> checklist in
> **[`docs/runbook-privacy-check-failure.md`](runbook-privacy-check-failure.md)**.
> It covers what each assertion tests, how to reproduce locally, how to
> distinguish a real regression from a transient failure, and recovery steps for
> every failure type.

The cleanest way to confirm both channels work end-to-end is to manually
trigger a known failure:

1. Go to **Actions → Post-Deploy Portal Privacy Check → Run workflow** in
   GitHub.
2. Pick the `staging` environment and provide a `staging_url` that does not
   exist (or temporarily point at a URL you know returns 5xx).
3. The smoke test will fail; both the Slack and email notify-steps should
   fire.

Confirm the recipient inbox(es) in `ONCALL_EMAIL` received the message and
the Slack channel saw the webhook post. Once verified, re-run the workflow
against the real URL to make sure the green path still works.

If the email never arrives:

- Check the `Notify on-call by email on failure` step's logs in GitHub
  Actions for SMTP errors (auth failure, relay denied, sender not verified).
- Confirm `ONCALL_EMAIL` and `SMTP_SERVER` are both set — the step's `if:`
  guard skips silently when either is empty.
- For Gmail, double-check that 2-step verification is on and the password
  used is an **app password**, not the account password.
- For SendGrid, confirm the sender identity / domain is verified and the API
  key still has Mail Send permission.
