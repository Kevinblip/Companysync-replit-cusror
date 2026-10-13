---
name: Workflow automation recipient resolution
description: Why automated workflow emails/SMS silently never reached leads/customers, and the rule for resolving a workflow action's recipient.
---

# Workflow recipient resolution (why automations never "fire off")

Workflow email/SMS actions almost always store their recipient as an **intent token**, not an
address: `"customer"`, `"lead"`, `"{{customer_email}}"`, `"{{lead_email}}"`, or a staff token
like `"{assigned_to_email}"` / `"owner"` / `"{created_by}"`. The variable replacer only rewrites
`{{x}}`/`{x}` placeholders — a bare word like `"customer"` passes through unchanged.

**The classic bug:** the executor did `toEmail = resolvedRecipient || ...` so `toEmail` became the
literal string `"customer"` → an invalid address → Resend/Twilio reject it → the error is swallowed
by `console.warn`. Result: **nothing is ever delivered**, yet the optimistic execution log still says
success. Contributing factors: `{{customer_email}}` doesn't exist on Lead records (leads store
`email`, not `customer_email`), and some records store the literal string `"null"` for email/phone
(truthy, so it looks like a real value).

## The rule for resolving a recipient
1. Build the real contact (email/phone/name) from the entity, treating `""`/`"null"`/`"undefined"`
   as empty. Trigger payloads (and delayed-step snapshots) frequently OMIT contact info — **re-fetch
   from the source table** by entityType+entityId (leads/customers use name/email/phone; estimates/
   invoices use customer_name/customer_email/customer_phone).
2. Normalize the common template vars (customer_email/lead_email/email, customer_phone/…, customer_name/…)
   so `{{...}}` in subject/body resolve.
3. **send_email:** use the configured recipient only if it is a real email; otherwise fall back to the
   contact's email **only when the recipient is empty or a customer/lead-intent token** (matches
   `customer|lead|client|homeowner`). An unresolved **staff-intent** token must be **skipped**, never
   redirected to the customer — otherwise an internal "new lead assigned to you" alert leaks to the client.
4. **send_sms:** same shape — real phone (≥7 digits, no `@`) → use it; else contact phone for
   customer/lead intent; else skip.

## Contact names are a send requirement

Customer-facing automation must resolve one real name and publish it under every supported alias:
`contact_name`, `customer_name`, `lead_name`, and `name`. Older templates commonly use
`{contact_name}` while newer templates use `{{customer_name}}`; populating only one family leaves
the other placeholder intact.

Reject blank names, null-like strings, generic labels such as "Customer"/"Unknown"/"there",
phone-number stand-ins, and unresolved name tokens. Automated email, SMS, campaigns, and AI calls
must skip before reaching a provider when the name is unusable. Manual one-off communication and
staff-only notifications are separate and should not be blocked by this customer-name rule.

**Why:** providers will happily deliver literal placeholders and generic greetings, making a broken
automation look successful while damaging customer trust.

**How to apply:** re-fetch the source record at execution time (including delayed jobs), normalize
entity-type casing, render the content, then enforce the name guard immediately before the provider
call. Persist the skipped outcome and never increment sent counts for it.

**Why the staff-token guard matters:** before the fix these staff-token sends silently no-op'd. A naive
"fall back to contact for anything that isn't an email" turns that silent no-op into active misdelivery
of internal content to homeowners.

## Resolving the assignee (making staff alerts actually deliver)
To deliver internal "assigned to you" alerts (not just skip them), resolve the assignee the same way as
the contact: derive an assignee ref from `assigned_to`/`assigned_to_email`, re-fetch `assigned_to` from
the source table **only for tables that have that column** (leads/customers/projects — estimates/invoices
do NOT), then look up `staff_profiles` (company-scoped) by `user_email`/`email` if the ref looks like an
email, else by `full_name`/`name` ILIKE. Populate `assigned_to`(=email), `assigned_to_email`,
`assigned_to_phone` (prefer `cell_phone`), `assigned_to_name`. Unassigned records stay empty → the
staff-token guard still skips them (never sent to the customer). This lives in the shared
`executeWorkflowAction`, so one change covers all 4 trigger paths.

## Don't double-fire triggers
Entity create/update through the entity API **already** fires workflows automatically
(`autoTriggerWorkflowsFromMutation` in dev's vite-db-plugin, `fireWorkflowTriggersAsync` in prod). Any
page that ALSO calls `triggerWorkflow`/`autoTriggerWorkflowsFromMutation` after `Entity.create()` fires
the same trigger twice (~0.5s apart; the two show different entityType casing — e.g. `Estimate` from the
API path + `estimate` from the explicit call) → duplicate customer emails/SMS. Fix = drop the explicit
frontend call and let the entity API be the single source. This has been swept across the app: the
Customers/Leads/Invoices create paths + a stray `autoTriggerWorkflowsFromMutation` in each onSuccess were
removed. Two subtleties worth keeping: (a) the CREATE auto-fire only ever fires `createTriggerMap[type_create]`
(exactly one trigger), so a genuinely DISTINCT event like Tasks' `task_assigned` must be KEPT — it never
fires on the create path; (b) the same duplicate can hide behind a different event name — the invoice SEND
flow explicitly fired `invoice_created` (wrong event; the status→'sent' update already auto-fires
`invoice_sent`), and the "Test with Kevin Stone" button in Workflows.jsx re-fired `lead_created` right after
`Lead.create()`. Both removed.

The built-in entity notification is also the single source for a new estimate
or customer alert. The AI Estimator and Customers pages must not call
`universalNotificationDispatcher` again after `Entity.create()`. A legacy
platform-owned `New Estimate Follow-up` workflow is redundant with that alert
and must be skipped in both dev and prod runners; delayed customer follow-up
workflows remain valid.

**Why:** one estimate could produce a server alert, a page-level dispatcher
email/SMS, and an immediate platform workflow email. The result looked like
several independent notices even though the same create event caused them.

**How to apply:** let the entity API own create notifications, keep
`universalNotificationDispatcher` for status-specific flows, and identify the
legacy platform workflow by both its name and platform ownership so a
customer-created workflow with the same name is not suppressed.

**Blank `{{amount}}` in templates (fixed):** estimate/invoice rows store `total_amount`, but the platform
`estimate_sent`/`estimate_accepted`/invoice email templates use `${{amount}}`, which the entity-API payload
doesn't carry → rendered a blank total. Fixed in the shared `executeWorkflowAction`: when `amount` is empty,
set it from `total_amount ?? total ?? grand_total ?? amount_due`, formatted as a plain number (no `$`, since
templates already prepend one). Payment rows carry a real `amount` (a legit `0` stringifies to "0", which is
non-empty) so `payment_received` stays untouched.

## Architecture / lockstep (4 trigger paths, 2 implementations)
- **dev-immediate** (`triggerWorkflow`), **dev-delayed** (`processWorkflowQueue`), and **prod-delayed**
  (`executeProdWorkflowAction`, which dynamically imports the plugin) all call the **same**
  `executeWorkflowAction` in `vite-functions-plugin.js`. Fixing that one function fixes 3 of 4 paths.
- **prod-immediate** is the odd one out: `fireWorkflowTriggersAsync` in `db/prod-db.cjs`. It must run
  leading immediate steps via `executeProdWorkflowAction` (to reuse the shared executor) AND insert a
  `WorkflowExecution` generic_entity for the first delayed/wait step so the prod cron continues it. The
  old version required `action.config.to` (never set → no emails) and never queued delayed steps.

## How to verify
Data reality check: many test leads/customers have NO email on file, so a workflow legitimately can't
email them. To prove delivery, create a lead/customer **with a real email** and watch for
`[Workflows] Email sent to <addr>` in logs. The execution-log `success:true` is optimistic and is NOT
proof of delivery.
