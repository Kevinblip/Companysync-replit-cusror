---
name: Customer PDF delivery parity
description: Why estimate public links must share rendering and format selection with authenticated delivery paths.
---

Public PDF links and authenticated preview/download/email historically used separate templates, so branding, page layout, proposal style, and even saved monetary amounts could diverge. A valid public token only grants access to the saved estimate; it does not make an independent formatter authoritative.

**Why:** Maintaining two financial presentation paths creates customer-facing contradictions, especially for insurance formats and intentional zero-valued items. The saved format selection may be stored as an ID rather than a complete format object.

**How to apply:** After token validation, resolve the saved estimate and company from the database, resolve the selected tenant/global format when present, and call the same PDF renderer used by authenticated channels. Do not trust caller-supplied company, format, or totals for public documents. Keep dev and production public routes in sync; legacy rows without itemized scope need an explicit saved-total-only fallback rather than fabricated line items.