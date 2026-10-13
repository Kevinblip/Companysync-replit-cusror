---
name: Usage dashboard row-cap truncation
description: Platform usage totals are computed client-side from a capped row fetch, so they understate exactly during an abuse spike.
---

Any "total cost / total usage" figure computed by fetching raw metering rows
into the browser and summing them is only correct while the row count stays
under the fetch cap. Aggregate on the server (SUM/GROUP BY) instead, or the
number is decorative.

**Why:** a single abusive tenant generated tens of thousands of metering rows in
a few days. The admin dashboard fetched the most recent capped slice and summed
it, reporting roughly a sixth of the real figure. The under-reporting scaled
*with* the abuse — the worse the incident, the more reassuring the dashboard
looked. The owner reviewed the page and saw a number small enough to ignore.

**How to apply:** whenever a UI sums a metered/event table, check whether the
read is capped. If it is, move the aggregation server-side and return totals,
not rows. Treat "sorted newest-first with a limit" as a silent correctness bug
in any total, not a performance detail.
