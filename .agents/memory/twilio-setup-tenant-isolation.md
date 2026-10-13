---
name: Twilio setup tenant isolation
description: Security boundaries for subscriber Twilio setup, cache writes, and provisioning.
---

Twilio setup, webhook provisioning, and routing-cache writes must resolve the target company from an active StaffProfile membership. Never authorize these actions from a client-supplied company ID, list order, or a company found only by `created_by`.

Protected platform/YICN tenants must be fail-closed in subscriber setup flows. A Twilio Account SID or phone number already assigned to another company must also be rejected before any Twilio API, entity, or cache mutation.

**Why:** A signup/setup flow previously selected the first or email-owned company and could copy platform credentials into a new tenant or overwrite a protected tenant.

**How to apply:** Keep development, production, and hosted-function guards aligned. Validate before saving settings, configuring webhooks, or writing routing caches; UI filtering is not an authorization boundary.

Quick Setup Twilio credential fields must use non-login field names and explicit autofill controls (`off` for SID/phone and `new-password` for the token). Treat any stored SID not beginning with `AC` as junk and leave all credential inputs blank for a company without its own valid row.

**Why:** Browsers can interpret Account SID plus Auth Token as a username/password pair and inject the user's saved site login, making an unconnected tenant appear to contain credentials even when React initialized empty state.

**How to apply:** Scope the read through the authenticated user's active staff membership, never fall back to platform environment credentials, and require a valid `AC…` SID plus phone before showing connected.

For an existing Twilio connection, feature preferences may be updated separately only when the account SID, auth token, main/additional numbers, API key, and TwiML App remain unchanged. Send only the allow-listed preference fields on that path; any connection-identity change must use the normal tenant-validation flow.

**Why:** Connection validation intentionally blocks protected platform tenants, but that should not prevent a member from saving non-credential preferences such as call recording or SMS enablement.

**How to apply:** Compare the current connection identity to the submitted values before saving; never let this preference-only path create a connection, change routing numbers, or alter credentials.