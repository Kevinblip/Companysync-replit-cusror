---
name: Shared calendar company timezone
description: Business rule for shared appointment times when staff work in different countries
---

Shared calendar event entry and display must use the active company's configured timezone, not the staff member's device timezone. Persist actual event instants in UTC.

**Why:** Offshore staff schedule appointments for the company's service area. The user explicitly chose a common company-time schedule so an intended business-hour appointment does not become an overnight appointment when another employee views it.

**How to apply:** Use company-local dates/times for calendar forms, day grouping, editing, moving, and labels. External calendar integrations must preserve the actual instant. Do not guess or bulk-shift historical appointments; confirm their intended times or reconcile with an authoritative source.
