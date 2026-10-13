---
name: Date-only values need local-timezone handling
description: Why YYYY-MM-DD strings shift a day in US timezones and the required helpers
---

**Rule:** For date-only values (paid_date, expense_date, "today" defaults), always use `src/utils/localDate.js`:
- `localToday()` — local-timezone YYYY-MM-DD (never `new Date().toISOString().split('T')[0]`, which is UTC-today and rolls to tomorrow after ~7–8pm ET)
- `parseDateOnly(str)` / `formatDateOnly(str)` — parse date-only strings at LOCAL midnight (never `format(new Date('YYYY-MM-DD'))`, which parses as UTC midnight and displays the PRIOR day in US timezones)

**Why:** July 2026 bug — a fee recorded July 22 ET displayed as "Jul 21" (display parse bug) and evening saves stamped the wrong day (UTC-today storage bug).

**How to apply:** Any new frontend code writing or displaying a date-only field must use these helpers. Deliberately NOT swept: derived future dates built from timestamps (`someDate.toISOString().split('T')[0]` for valid_until / cycle end in Billing, Estimates, Proposals, Subscriptions, MyAssignments) and server-timestamp conversions — those are fine.

**Accounting-date matching:** Normalize calendar dates before comparing records that have passed through different storage types. Preserve the written calendar day rather than converting midnight to the viewer's timezone.

**Why:** A date-only input can return as an ISO timestamp after a PostgreSQL round trip while a JSON-stored counterpart remains date-only. Exact raw-string equality then rejects a genuine accounting pair even though both represent the same entered day.

**How to apply:** Test legacy record matching with persisted/API-shaped timestamps as well as date-only input strings; keep the other identity and ambiguity guards intact.

**Payment dates are calendar days, not instants:** A payment's entered date must retain its written day even when the database returns midnight with an ISO timestamp suffix. Do not apply ordinary instant/timezone conversion to payment dates.

**Why:** Converting an October 1 midnight timestamp to Eastern time displayed September 30 and excluded a saved payment from October's history and total. A date-only-only fix missed the database-shaped timestamp.

**How to apply:** Normalize the accounting day consistently for payment filtering, customer history, receipts, exports, and edit inputs. Test the first and last days of a month with API-shaped timestamps in both negative and positive UTC offsets; do not change actual event timestamps.
