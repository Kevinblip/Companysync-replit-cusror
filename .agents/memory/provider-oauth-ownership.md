---
name: Provider OAuth ownership
description: How subscriber-owned external accounts should connect through a CompanySync-owned OAuth application.
---

For OAuth providers such as HOVER, CompanySync owns the integration application's client ID and client secret. Each subscriber authorizes access to its own provider organization through the provider's consent screen; subscribers do not paste client secrets or tokens into CompanySync.

**Why:** Provider client credentials identify the CompanySync integration, while authorization and refresh tokens bind one subscriber's provider organization. Treating those as subscriber API keys creates the wrong trust boundary and makes secure revocation and rotation harder.

**How to apply:** Keep application credentials in server secrets, sign short-lived tenant-bound OAuth state, encrypt per-company access and refresh tokens, preserve refresh-token rotation, and authorize status/test/disconnect operations against the active company.

GoHighLevel must not use a shared agency/API key as a fallback for subscriber syncs. Companies without their own authorized GHL location should be blocked from syncing, even while the CompanySync OAuth application setup is pending.

**Why:** A shared provider credential can expose or import one subscriber's contacts into another company. The subscriber requested separate authorization beneath the Location ID setting rather than universal GHL access.

**How to apply:** Keep CompanySync's OAuth app credentials separate from subscriber authorization, and fail explicitly when a company has not connected its own location.