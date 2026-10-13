# Runbook: Privacy-Check or Body-Limit Alert Fired

**Trigger**: You received a Slack `:rotating_light:` or email alert with a subject
like `Portal Privacy Check FAILED` or `Body-Limit Check FAILED` from either
`post-deploy-privacy-check.yml` or `post-deploy-body-limit-check.yml`.

**What this means**: The post-deploy smoke test ran against the live server
(production or staging) and one or more assertions failed. Unlike a missed heartbeat
(which means the alerting pipeline itself is dark), this alert means the pipeline
is working correctly — it detected a real test failure that you need to triage.

---

## Alert quick-reference

| Alert subject | Workflow | Environment | Severity |
|---|---|---|---|
| `🚨 Portal Privacy Check FAILED on production` | `post-deploy-privacy-check.yml` | production | **Critical** — potential data leak in prod |
| `⚠️ Portal Privacy Check FAILED on staging` | `post-deploy-privacy-check.yml` | staging | High — block promotion, fix before prod |
| `🚨 Body-Limit Check FAILED on production` | `post-deploy-body-limit-check.yml` | production | **Critical** — oversized payloads accepted |
| `⚠️ Body-Limit Check FAILED on staging` | `post-deploy-body-limit-check.yml` | staging | High — block promotion, fix before prod |

---

## Step 1 — Read the failing run's logs

1. Click the **Run** link in the Slack message or email alert.
2. In GitHub Actions, expand the **HTTP smoke test** (or **Body-limit smoke test**) step.
3. Every assertion is printed with `✓` (pass) or `✗` (fail) and a short label.
   Copy the failing labels — they tell you exactly which assertion broke.

---

## Step 2 — Understand what each assertion tests

### Privacy-check assertions (`scripts/test-portal-privacy.cjs`)

The script runs in **full mode** (requires `DATABASE_URL` + `SESSION_SECRET`) for
the CI workflow. It seeds isolated `smoke_test_*` fixtures, hits the live server
over HTTP, and checks that the public homeowner portal enforces `is_public` filtering.

#### Schema preflight (runs first, before any HTTP calls)

| Assertion | What it proves |
|---|---|
| Required columns exist: `customers.portal_token`, `project_logs.is_public`, `project_photos.is_public`, `projects.project_type`, `projects.current_milestone` | Schema was not rolled back and no migration was skipped |
| `project_logs.is_public` column DEFAULT is `false` at the DB level | A raw `INSERT` omitting `is_public` will not silently expose internal notes publicly |
| `project_photos.is_public` column DEFAULT is `false` at the DB level | A raw `INSERT` omitting `is_public` will not silently expose photos publicly |

#### Test A — Privacy filter on GET `/api/public/portal`

Seeds one public and one private log, and one public and one private photo, then
fetches the portal endpoint with a valid token.

| Assertion | What it proves |
|---|---|
| Response status is 200 | Endpoint is reachable with a valid token |
| Response has `success:true` | API contract is intact |
| Private log (`is_public=false`) does NOT appear | Logs are filtered server-side before being sent to homeowners |
| Public log (`is_public=true`) DOES appear | The filter is not over-eager (doesn't hide everything) |
| Private photo (`is_public=false`) does NOT appear | Photo filtering works the same way |
| Public photo (`is_public=true`) DOES appear | Photo filter is not over-eager |
| `projects.data` is NOT present on any project in the response | The raw CRM JSONB blob is stripped from the portal response |

#### Test B — Toggle `is_public` on/off round-trips

| Assertion | What it proves |
|---|---|
| After DB-toggling private log to `is_public=true`, it appears in portal | Filter reacts to changes in real time |
| After DB-toggling log back to `is_public=false`, it disappears from portal | The filter re-applies on each request |
| Same toggle sequence repeated for a photo | Photo filtering is consistent |

#### Test C — Homeowner note submission via `POST /api/public/portal/note`

| Assertion | What it proves |
|---|---|
| Response status is **200** | Write endpoint is reachable and succeeded |
| Response has `success:true` | API contract is intact |
| Response includes the inserted log object (`log` key present) | Response shape is correct |
| `log.is_public === false` in the response payload | The server reports the note as private |
| DB confirms `is_public=false` for the inserted row | The privacy flag is persisted, not just returned |
| Homeowner note does NOT appear in a subsequent `GET /portal` | Private notes are filtered on read too |

#### Test D — Negative-path token probes (also runs in read-only CI mode)

| Assertion | What it proves |
|---|---|
| Invalid token → HTTP 404 | Endpoint does not leak data on a bad token |
| Missing token → HTTP 400 | Endpoint rejects requests with no token at all |

#### Test E — Admin log route (`POST /api/projects/:id/log`) — `is_public` privacy correctness

Injects a signed staff session and posts logs with different `is_public` values,
verifying that the server correctly persists and filters the flag.

| Sub-test | Assertion | What it proves |
|---|---|---|
| E1 | POST with `is_public: false` returns HTTP 200; `log.is_public` is false in response; log is NOT visible in portal; DB confirms `is_public=false` | Private flag is respected end-to-end |
| E2 | POST with `is_public: true` returns HTTP 200; `log.is_public` is true in response; log IS visible in portal; DB confirms `is_public=true` | Public flag works end-to-end |
| E3 | POST with `is_public` omitted returns HTTP 200; `log.is_public` is false in response; log is NOT visible in portal; DB confirms `is_public=false` | Safe default: omitting the flag never accidentally exposes a log |

#### Test F — Admin photo routes (`POST`/`PATCH /api/projects/:id/photos`) — `is_public` privacy correctness

Same structure as Test E but for photos. Uses a signed staff session.

| Sub-test | Assertion | What it proves |
|---|---|---|
| F1 | POST with `is_public: false` → photo NOT visible in portal; DB confirms false | Private flag persisted on upload |
| F2 | POST with `is_public: true` → photo IS visible in portal; DB confirms true | Public flag persisted on upload |
| F3 | PATCH to `is_public: false` on a previously-public photo → photo disappears from portal; DB confirms false | Toggle-to-private works in real time |
| F4 | POST with `is_public` omitted → photo NOT visible in portal; DB confirms `is_public=false` | Safe default: omitting the flag never accidentally exposes a photo |

#### Test G — Homeowner photo upload (`POST /api/public/portal/photo`) — privacy and cross-customer isolation

Posts a real 1×1 PNG as a base64 payload using Customer 1's portal token, then
checks visibility from both Customer 1's and Customer 2's portals.

| Assertion ID | Assertion | What it proves |
|---|---|---|
| G1 | POST returns HTTP 200; `success:true`; response includes a non-empty `id` | Upload endpoint is functional |
| G2 | Photo row exists in the database | The photo was actually persisted |
| G3 | DB confirms `is_public=false` for the uploaded photo | Homeowner uploads are private by default |
| G4 | DB confirms `uploaded_by` starts with `"homeowner:"` | Upload is attributed to the homeowner, not staff |
| G5 | Photo DOES appear in the uploading customer's own portal (via `uploaded_by` filter) | Homeowners can see their own uploads |
| G6 | Photo does NOT appear in a different customer's portal | Cross-customer isolation is enforced |

---

### Body-limit assertions (`scripts/test-body-limit.cjs`)

Each assertion sends an oversized POST body to a specific route and checks that:
1. The server returns **HTTP 413** (not 500, not 200).
2. The JSON response body contains an `error` field matching `/too large/i`.

| Assertion | Route | Body size sent | Cap enforced |
|---|---|---|---|
| Portal note oversized | `POST /api/public/portal/note` | 1.5 MB | 1 MB |
| Portal photo oversized | `POST /api/public/portal/photo` | 31 MB | 30 MB |
| Functions invoke oversized | `POST /api/functions/invoke` | 31 MB | 30 MB |
| Twilio cache update oversized | `POST /api/twilio/update-cache` | 1.5 MB | 1 MB |

A failure on any of these routes means the middleware that enforces the body-size
limit was removed, bypassed, or misconfigured on that route.

---

## Step 3 — Distinguish a real regression from a flaky test

The tests are designed to be deterministic, but a handful of conditions can make
them fail spuriously. Work through the checklist below before assuming the worst.

### Flakiness indicators (transient — re-run first)

- The failure is during the **server reachability wait** step, not an assertion
  label. The deploy may still have been rolling out when the smoke test fired.
- Only a **single run** failed; all previous and subsequent runs for the same
  commit are green.
- The GitHub Actions logs show a **connection error** (`ECONNREFUSED`,
  `ETIMEDOUT`, `ENOTFOUND`) rather than an assertion failure label with `✗`.
- The failing assertion is about HTTP status codes (e.g. `Invalid token → HTTP 404`)
  but server logs show a cold-start spike in 5xx responses right after the deploy.

**Action**: Trigger a manual re-run:
**Actions → (workflow name) → Re-run failed jobs**

If it passes on the second run, file a low-priority ticket to investigate
intermittent server startup timing. Do not close the incident without a note.

### Real regression indicators (investigate immediately)

- The same assertion label failed on **two or more consecutive runs** against the
  same commit or branch.
- The failure is a **content assertion** (e.g. `Private log does NOT appear in
  portal response` or `status 413, got 200`) rather than a connectivity error.
- The failure appeared **right after a specific deploy** and was absent in the
  previous run on main.
- A **schema preflight** assertion failed — a column is missing or its default
  was changed.

---

## Step 4 — Reproduce locally

### Privacy-check (full mode)

```bash
# Requires a running local server and matching DATABASE_URL + SESSION_SECRET
DATABASE_URL=postgres://localhost:5432/your_db \
SESSION_SECRET=your_secret \
node scripts/test-portal-privacy.cjs
```

To also start the local dev server first:

```bash
npm run dev &
npm run test:portal-privacy
```

For a quick read-only probe against any running URL (no DB credentials needed):

```bash
SMOKE_READ_ONLY=1 BASE_URL=https://your-app.up.railway.app \
node scripts/test-portal-privacy.cjs
```

Add `SMOKE_PORTAL_TOKEN=<a real long-lived portal token>` to also run the
positive-path (Test A-ro) and `projects.data` leak check in read-only mode.

### Body-limit check

```bash
# Against the local dev server (defaults to http://localhost:5000)
# Waits up to 30 s for the server to accept connections before running.
node scripts/test-body-limit.cjs

# Against a remote URL (no port-wait — server must already be reachable)
BASE_URL=https://your-app.up.railway.app node scripts/test-body-limit.cjs
```

#### Read-only probe mode — no local server required

Use `BODY_LIMIT_READ_ONLY=1` to skip the port-wait entirely and fire HTTP
assertions directly against a running deployment.  This is the mode used by
the `post-deploy-body-limit-check.yml` CI workflow.

```bash
# Probe an already-deployed URL — no local server needed
BODY_LIMIT_READ_ONLY=1 \
BASE_URL=https://your-app.up.railway.app \
node scripts/test-body-limit.cjs
```

In read-only probe mode:
- The port-wait step is skipped; assertions fire immediately against `BASE_URL`.
- **Connection errors** on individual routes are logged as `- skipped` rather
  than `✗ failed`, so partial results are surfaced when only some routes are
  reachable.  The run exits non-zero only when a route **responds** with the
  wrong status or body.
- Routes that were skipped are shown in the summary line:
  `Results: 3 passed, 0 failed, 1 skipped`

#### Skipping specific routes

Use `SKIP_ROUTES` (comma-separated path substrings) to exclude routes that are
intentionally unavailable in your test environment.  This is also a repository
variable (`BODY_LIMIT_SKIP_ROUTES`) consumed by the CI workflow.

```bash
# Skip the Twilio route (e.g. when BRIDGE_SECRET is not available in the env)
BODY_LIMIT_READ_ONLY=1 \
BASE_URL=https://your-app.up.railway.app \
SKIP_ROUTES=/api/twilio/update-cache \
node scripts/test-body-limit.cjs

# Skip multiple routes
SKIP_ROUTES=/api/twilio/update-cache,/api/functions/invoke \
BODY_LIMIT_READ_ONLY=1 \
BASE_URL=https://your-app.up.railway.app \
node scripts/test-body-limit.cjs
```

---

## Step 5 — Recovery steps by failure type

### Schema preflight failures

**Missing column**

```
Schema preflight FAILED: column "is_public" is missing from table "project_logs"
```

A migration was not applied to the target database. Apply it:

```sql
ALTER TABLE project_logs   ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE project_photos ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false;
```

If this happened in production, treat it as P0 — the portal may already be
leaking data. Follow the escalation steps at the bottom of this document.

**Wrong `DEFAULT` value**

```
Schema preflight FAILED: project_logs.is_public has DEFAULT "true" — expected "false"
```

A migration accidentally flipped the column default. Fix it immediately:

```sql
ALTER TABLE project_logs   ALTER COLUMN is_public SET DEFAULT false;
ALTER TABLE project_photos ALTER COLUMN is_public SET DEFAULT false;
```

Then audit rows inserted since the bad migration for unintentional `is_public=true`
values and correct them:

```sql
-- Review before correcting:
SELECT id, project_id, created_at FROM project_logs
WHERE is_public = true
  AND created_at >= '<timestamp of bad migration>';
```

---

### Privacy filter failures (Test A / Test B)

**Private log or photo appears in the portal response**

The `GET /api/public/portal` handler is no longer filtering by `is_public`.
Common causes:

- A refactor replaced the filtered query with a broader one (e.g. removed a
  `WHERE is_public = true` clause or an ORM scope).
- A new eager-load or join pulls all rows without the flag.
- A database view or function was modified to omit the filter.

**How to find the regression**: `git log --oneline -20` and diff the query that
fetches `project_logs` and `project_photos` for the portal endpoint before and
after the failing deploy. Restore the `is_public = true` filter.

**`projects.data` blob is exposed**

The response serializer stopped stripping the raw `data` JSONB column before
sending the projects array to homeowners. Find the portal response serialization
code and ensure `data` is excluded from the object returned to clients.

---

### Test C failures — homeowner note submission

- **Status not 200**: The `POST /api/public/portal/note` endpoint returned a
  non-200 status. Check server logs for the specific error. Common causes:
  missing `token` or `project_id` validation, or the route was moved behind
  an auth guard.
- **`log.is_public` is true in response or DB**: The endpoint is not setting
  `is_public = false` when inserting homeowner notes. Locate the insert logic
  for `POST /portal/note` and add or restore `is_public: false` explicitly.
- **Homeowner note appears in GET /portal**: The portal read query is not
  filtering by `is_public=true`, so all notes (including `is_public=false`) are
  being returned.

---

### Test E / F failures — admin route `is_public` handling

These tests verify that the `POST /api/projects/:id/log` and
`POST/PATCH /api/projects/:id/photos` routes correctly persist whatever
`is_public` value they receive, and that omitting `is_public` safely defaults
to `false`.

- **`is_public` value not persisted correctly**: The insert/update handler is
  ignoring the `is_public` field from the request body, or always overriding it
  to a fixed value. Locate the route handler and ensure `is_public` is read from
  the request body and passed to the query.
- **Omitting `is_public` does not default to `false`** (E3 / F4): The column
  default may have been changed (caught by schema preflight) or the application
  code is defaulting to `true`. The application-layer default must be `false`.

---

### Test G failures — homeowner photo upload

- **G1: Status not 200 or missing `id`**: The `POST /api/public/portal/photo`
  endpoint failed. Check server logs — common causes are an invalid base64
  payload handling error or a missing `project_id` validation step.
- **G3: `is_public` is true in DB**: Homeowner uploads are being stored with
  `is_public=true`. Locate the insert for `/portal/photo` and set
  `is_public: false` explicitly.
- **G4: `uploaded_by` does not start with `"homeowner:"`**: The upload handler
  is not correctly attributing the row to the homeowner. Restore the
  `uploaded_by = 'homeowner:' + customer_id` assignment.
- **G5: Photo does not appear in uploading customer's own portal**: The portal
  read query is not including homeowner-uploaded photos (those with
  `is_public=false` but `uploaded_by` matching the requesting customer).
  Check the `uploaded_by` filter clause in the portal endpoint.
- **G6: Photo appears in a different customer's portal**: Cross-customer
  isolation is broken. The portal query is not scoping results to the
  token-resolved customer's projects. Verify the join condition between
  `customers` → `projects` → `project_photos` uses the correct `customer_id`.

---

### Body-limit failures

**Got 200 or 500 instead of 413 on a route**

The body-size limit middleware was removed or is not applied to that route.
Check the Express middleware stack for the failing endpoint:

| Route | Expected cap | Middleware to look for |
|---|---|---|
| `POST /api/public/portal/note` | 1 MB | `express.json({ limit: '1mb' })` |
| `POST /api/public/portal/photo` | 30 MB | `express.json({ limit: '30mb' })` |
| `POST /api/functions/invoke` | 30 MB | `express.json({ limit: '30mb' })` |
| `POST /api/twilio/update-cache` | 1 MB | `express.json({ limit: '1mb' })` |

A common cause is a refactor that moved a route to before the per-route
size-limiting middleware, or replaced `express.json({ limit })` with a version
that omits the `limit` option (which silently falls back to Node's default of
100 kb, causing 413 for smaller payloads but not the ones the test sends).

**Got 413 but the error body does not match `/too large/i`**

The custom error handler that catches `PayloadTooLargeError` (Express sets
`err.type === 'entity.too.large'`) and serializes it as JSON was removed or
is not registered after the affected route. Verify the global error handler
catches this error type and responds with a body like:

```json
{ "error": "Request body too large" }
```

---

### Alert channel problems (you never received the alert)

If a colleague tells you the check failed but you never got the Slack message or
email, the alert channels themselves may need attention:

- Verify `SLACK_WEBHOOK_URL`, `ONCALL_EMAIL`, and `SMTP_*` secrets are set:
  **Settings → Secrets and variables → Actions**.
- Both channels are skipped silently when their secrets are absent. See the
  full setup guide in
  [`docs/post-deploy-privacy-alerts.md`](post-deploy-privacy-alerts.md) §1–3.
- To confirm channels work independently of a real failure, trigger the weekly
  heartbeat manually: **Actions → Alerting Heartbeat → Run workflow**.

---

## Recovery verification checklist

Before closing the incident, confirm all of the following:

- [ ] The root cause of the failure is identified and documented.
- [ ] A fix has been merged and deployed (or a rollback has been executed).
- [ ] A manual re-run of the **failing workflow** against production completed
      with **all assertions green**:
      **Actions → (workflow name) → Run workflow → production**.
- [ ] If the failure was a real privacy regression: audited recent portal
      traffic/logs to confirm no private data was served to homeowners.
- [ ] If the failure was on staging only: confirmed the fix is deployed to
      staging and the smoke test is green **before** promoting to production.
- [ ] If a new failure mode was discovered: update this runbook with the new
      symptom, cause, and fix.

---

## Escalation

If you cannot identify the root cause within 30 minutes:

1. **Privacy-check failure in production**: Immediately disable or rate-limit the
   homeowner portal endpoint (`/api/public/portal`) until the regression is
   identified. Preventing continued data exposure takes priority over portal
   availability.
2. **Body-limit failure in production**: Consider blocking large-body requests
   at the reverse-proxy or CDN level (e.g. Nginx `client_max_body_size 1m;`) as
   a temporary guard while investigating the middleware issue.
3. Escalate to the on-call engineering lead with:
   - The exact failing assertion label(s) from the GitHub Actions log.
   - The commit SHA that triggered the deploy (`github.event.workflow_run.head_sha`
     from the run log).
   - Whether you have confirmed it is a real regression vs. a transient failure.
