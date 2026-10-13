---
name: Lexi production schema portability
description: Rules for writing Lexi's server-side ownership filters against divergent development and production schemas.
---

Lexi authorization filters must only reference columns that exist in the production database, not just development. If an ownership field is unavailable, use the remaining verified ownership fields and fail closed rather than throwing or widening access.

**Why:** A non-admin Lexi policy referenced `customers.created_by`, which existed in development assumptions but not production. Every non-admin chat then failed before Lexi could respond.

**How to apply:** When changing shared Lexi access policy or SQL scopes, inspect the production information schema for every table/column combination and add a regression test for schema-sensitive conditions.