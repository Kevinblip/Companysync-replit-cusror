---
name: AssistantSettings duplicate rows
description: How/why companies get >1 AssistantSettings row, the canonical selection rule, and why lexi rows must never be hijacked.
---

# AssistantSettings duplicate rows

## Two rows is NORMAL for many companies
`QuickSetup.jsx` intentionally creates TWO rows per company: one with `assistant_name = 'lexi'`
and one with `assistant_name = 'sarah'`. These are NOT duplicates — they are distinct assistants.
Sarah pages must never select, overwrite, or delete the Lexi row.

## The accidental-duplicate pattern
`SarahWorkspace.jsx` and `SarahSettings.jsx` load settings in a `useQuery` and separately call
`AssistantSettings.create()` in `saveMutation`. If the user saves before the load query returns
a `recordId`, the save creates a SECOND sarah-flavored row with the form defaults, including the
hardcoded `brand_short_name: "Companysync"` that existed in the form prior to July 2026.
That default row is timestamped AFTER the real tuned row, so `ORDER BY updated_date DESC LIMIT 1`
silently promoted it and calls introduced the company with the wrong name.

## Canonical selection rule (must stay in lockstep across 3 SQL loaders + the JS util)

**SQL order clause:**
```sql
ORDER BY
  (COALESCE(data->>'assistant_name','') <> 'lexi') DESC,   -- skip lexi rows
  COALESCE(updated_date > created_date + interval '5 seconds', false) DESC,  -- prefer edited rows
  updated_date DESC NULLS LAST
LIMIT 1
```

**JS util:** `src/utils/assistantSettingsRecord.js` — `pickCanonicalSettings(rows)` mirrors
this rule for the frontend. Also exports `healDuplicateSettings` which removes ONLY:
- non-lexi rows
- that were never edited after creation (the accidental-default signature)
Any row a human ever touched is kept.

## 3 SQL loaders must stay in lockstep
- `prod-server.cjs` ~line 887 (phone path + `localGetSettings`)
- `vite-twilio-ws-plugin.js` ~line 367 (dev phone path)
- `db/prod-integrations.cjs` ~line 1675 (outbound call initiator)

**Why:** they all pick the settings row that governs what the AI says on a live call; a parity
gap causes dev and prod to behave differently for the same company.

## Find-before-create guard (save paths)
Both pages now do a re-query when `recordId` is null at save time, picking the canonical row
before creating a new one. This prevents a concurrent or race-triggered double-create.
The row filter used is `filter({ company_id }, '-updated_date', 10)` + `pickCanonicalSettings`.
