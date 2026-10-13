---
name: 12 CRM UX improvements (session July 2026)
description: Completed set of 12 CRM UX polishes; durable decisions and edge-cases noted here.
---

## Changes completed
1. Sticky table headers (`sticky top-0 z-10`) on Leads, Customers, Estimates, Invoices.
2. Empty-state CTAs with icon + subtitle + action button on Leads (desktop), Customers (desktop), Invoices (mobile+desktop).
3. "Contact Info" section header added to renderFormFields() in Leads.jsx (Address / Source sections already existed).
4. ESX export button gated by `HIDDEN_FEATURES.XACTIMATE_ESX_EXPORT: false` — output is invalid ZIP, hidden until fixed.
5. QuickBooks card added to IntegrationsHub under "Accounting"; button routes to Settings → integrations tab.
6. Facebook Lead Ads + TikTok Lead Ads: descriptions say "manual webhook setup"; amber "Manual Setup" badge; button text "View Setup Instructions".
7. Action Items sidebar badge counts all pending items (was: only past-due ones with due_at <= now).
8. LeadProfile breadcrumb: replaced "Back to Leads" ghost button with "← Leads / {name}" nav inside gradient header. CustomerProfile: similar breadcrumb above gradient card.
9. Lead list name cell: amber StickyNote icon with tooltip preview of lead.notes (220-char cap). StickyNote added to lucide imports.
10. Global "New Lead" button in Layout header (all pages). Navigates to /leads?new=1. Leads.jsx detects param and opens sheet, then strips param from history.
11. AIEstimator._generateAndSetEstimate: filter zero-priced placeholder rows (rate=0, rcv=0, qty>0) before setLineItems and setCurrentEstimate. Fixes REVISED duplicate row inflation.
12. Dashboard "Today's Focus" widget: first in widget order; shows pending action items (due today/overdue), today's calendar events, today's lead follow-ups. Draggable + togglable.

## Durable notes
- Leads.jsx `renderFormFields()` already had Address + Source section headers — Change 3 only added "Contact Info" at the top.
- hiddenFeatures.js is the single source for UI feature flags; XACTIMATE_ESX_EXPORT: false is now registered there.
- IntegrationsHub QuickBooks card uses `integration.id === 'quickbooks'` branch in the card renderer, not the credential-based connect flow.
- Dashboard widget system: add to DEFAULT_WIDGET_VISIBILITY, DEFAULT_WIDGET_ORDER, and renderWidget switch.
