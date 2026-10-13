---
name: JobMedia → InspectionJob linking field
description: The correct field for linking a JobMedia (photo) record to its InspectionJob, and where this has been gotten wrong before.
---

JobMedia records link to their parent InspectionJob via `related_entity_id` + `related_entity_type: 'InspectionJob'`. There is no live `inspection_job_id` field on JobMedia — it's a legacy/decoy name that keeps getting reintroduced.

**Why:** Nearly every creation path (InspectionCapture.jsx, UploadQueueContext.jsx, generateAdjusterReport.ts read side) correctly uses `related_entity_id`/`related_entity_type`. But new code repeatedly reaches for the more "obvious" name `inspection_job_id` instead — this has caused two classes of bugs:
1. Read side: LeadProfile.jsx and CustomerProfile.jsx queried `JobMedia.filter({ inspection_job_id: {$in:[...]} })` — always empty, so their "Inspection Photos" sections silently showed nothing even though photos existed and displayed fine on the Inspection Capture page itself.
2. Write side: smartGlassesPhotoWebhook.ts created JobMedia with `inspection_job_id: linkedJob?.id` — those photos were invisible everywhere (no consumer reads that field) even though the link was captured server-side.

**How to apply:** Whenever adding or auditing any JobMedia create/query call, use `related_entity_id` + `related_entity_type: 'InspectionJob'` (or `'Customer'` for crew/WhatsApp uploads keyed to a customer instead of a job). Grep for `inspection_job_id` near `JobMedia` as a smell before shipping. Also check `source` is set on create (`smart_glasses`, `crew_upload`, `whatsapp_upload`, etc.) since several list views filter by it.
