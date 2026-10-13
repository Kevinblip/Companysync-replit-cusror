---
name: Startup YICN tenant breach
description: One-time data-fix code baked into prod-server.cjs startup caused cross-tenant data exposure on every server restart.
---

# Startup YICN tenant breach

## The rule
Never bake tenant-specific one-time data migrations into server startup code. They must be one-shot admin scripts, not recurring hooks.

**Why:** `prod-server.cjs` had two blocks that ran on EVERY restart:
1. Moved `stonekevin866@gmail.com`'s staff profile from `company_1773143175492_bwwge66gf` (Virgil Roofing — a real subscriber) into YICN and marked Virgil Roofing as `is_deleted=true`.
2. Created/updated a "Call Assistant" StaffRole specifically for YICN.

Every restart would undo any legitimate multi-tenant state for that user. The subscriber (who signed up as Virgil Roofing) would land in YICN's account after any server restart because their only active staff profile had been silently moved.

**How to apply:** If you ever need to fix a specific tenant's data, write it as a one-shot admin endpoint (gated behind `ADMIN_FIX_KEY`) — NOT as startup code that fires every time the process boots.

## What was removed
- `prod-server.cjs` startup block "Auto-fix YICN staff permissions..." (moved profiles, deactivated companies, moved leads) — DELETED
- `prod-server.cjs` startup block "Create Call Assistant role for YICN..." — DELETED
- Hardcoded `"YICN Roofing"` in SMS/email notification footer and body sent to ALL tenants — fixed to generic text
- `createCallAssistantRole` handler YICN_ID fallback (`|| YICN_ID`) — now requires explicit `company_id` or returns error

## Grep to detect recurrence
```
grep -n "YICNFix\|YICN_ID.*||" prod-server.cjs
```
If this grep returns anything in the startup `.catch()` block, it's a regression.
