---
name: Test suites send real mail
description: Smoke tests invoke real cron endpoints, so they deliver real email the moment a working provider is wired up; reserved test domains are blocked at the shared sender.
---

Several smoke suites in `scripts/` create fixtures and then call the **real**
cron trigger endpoints, which scan every company in the database. They are not
hermetic. Any working email or SMS provider therefore turns a test run into
real outbound messages.

**Why this stayed invisible:** while the email provider was dead-but-accepting
(returning HTTP 200 and a message ID while discarding everything), no test
send ever landed. Restoring a genuinely working provider made every suite
start delivering at once — to fixture addresses and, through recipient
fallbacks, potentially to real staff.

**The dangerous shape:** recipient resolution frequently falls back when a
company has nothing configured — e.g. storm alerts fall back to *active
admins* when `alert_recipients` is empty. A test that iterates all companies
therefore reaches real people, not just its own fixtures.

**Rule:** the shared sender refuses recipients on domains reserved by RFC 2606
/ RFC 6761 (`example.com/.net/.org`, `.test`, `.example`, `.invalid`,
`.localhost`, `.local`). Mixed lists still deliver to the real recipients and
drop only the reserved ones; an all-reserved send throws `RESERVED_TEST_RECIPIENT`
with `noRetry`.

**Why:** those domains have no MX records, so mail to them can only bounce, and
bounce rate is what gets a sending account throttled or terminated. A prior
provider on this project was cut off after abuse produced a large bounce spike,
so protecting the replacement's reputation is not theoretical.

**How to apply:** unit suites that mock the provider and assert on fixture
recipients set `EMAIL_ALLOW_RESERVED_RECIPIENTS=1`. Nothing at runtime sets it.
If a mocked email test suddenly fails on recipient validation, that flag is
what it is missing — do not weaken the filter.

**Still open:** blocking reserved domains does not stop a test-triggered cron
from reaching a *real* admin address through a fallback. Only the bounce
problem is solved; hermetic crons would be the real fix.
