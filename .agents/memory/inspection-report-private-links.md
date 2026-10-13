---
name: Inspection report private links
description: Preserve complete browser-generated inspection PDFs while delivering them through private, expiring links.
---

Inspection reports are assembled in the browser from the full inspection view, including photos and sections. Upload the finished PDF bytes to private object storage, then email a short-lived, database-backed access link. Never fall back to public upload URLs or report attachments as a "temporary" delivery path. An in-process background worker is not a durable queue: it can disappear on restart, so do not acknowledge work until its inputs are durable and retryable.

**Why:** Rebuilding the report server-side risks omitting browser-only content, while public files and email attachments expose or duplicate sensitive, large PDFs. SMTP acceptance is still not proof of inbox delivery.

**How to apply:** For inspection-report delivery changes, preserve the existing browser PDF builder, enforce same-company upload authorization and PDF validation, check token expiry/revocation before reading private storage, and describe provider acceptance as submitted rather than delivered.