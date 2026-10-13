---
name: Shared workflow catalog
description: Rules for safely sharing CompanySync workflow templates across tenant and environment boundaries.
---

Shared workflow templates are code-owned rather than database-distributed. Catalog entries must be inert, globally readable by subscribers, sanitized of tenant-specific recipients and branding, and copied into a company's private workflow records only after an administrator explicitly activates one. Existing company workflows and custom edits remain authoritative.

**Why:** Development and production use separate databases, while the old distribution model produced hundreds of duplicated tenant rows and leaked one company's contact details into other companies' automations. Global execution fallback also made merely storing a template equivalent to activating it.

**How to apply:** Give each catalog definition a stable key/version; use a deterministic company-plus-template identity for idempotent activation; never execute the catalog tenant; preserve activated-copy edits on pause/resume; and do not auto-activate workflows during signup.