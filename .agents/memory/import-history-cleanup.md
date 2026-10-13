---
name: Import history and cleanup semantics
description: Import history must distinguish skipped rows from processing errors, and cleanup must require evidence before changing lead or estimate status.
---

Import history is a partial-success record: skipped rows are not processing failures and must be displayed separately from actual errors.

Cleanup actions must fail closed:
- a blank lead email must never match a blank customer email;
- an estimate job link alone is not evidence of acceptance;
- accepted dates take precedence over sent dates because accepted is the later state.

**Why:** Large CRM exports commonly contain blank rows, incomplete records, and duplicate/grouped estimate lines. Treating those as errors obscures the real failures, while permissive matching can silently change unrelated records.

**How to apply:** Preserve separate imported/skipped/error counts in import logs and require non-empty normalized identifiers or explicit status evidence before auto-fixing records.