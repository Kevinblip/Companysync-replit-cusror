---
name: Dashboard first paint
description: Keeps login-to-dashboard responsive when tenant collections are large or database requests are slow.
---

The dashboard shell should render once authentication and the active company
are known. Large customer and invoice collections must populate their widgets
progressively instead of gating the entire page behind those requests.

**Why:** A full-page skeleton makes a successful login look stalled, and
several dashboard collections can be large enough to contend for database
connections or time out on mobile.

**How to apply:** Keep page-level loading gates limited to identity/company
resolution. Use local empty states or a small non-blocking status indicator for
collection queries that continue after the first paint.

When accurate dashboard totals require broad collection reads, start those
queries after the shell paints instead of lowering the row limit and silently
changing totals. Keep heavy feature pages route-lazy so the dashboard does not
download unrelated estimator, PDF, or reporting code.

**Why:** This preserves financial and pipeline accuracy while preventing a
large tenant dataset and a monolithic page bundle from delaying first paint.

**How to apply:** Gate the dashboard's bulk React Query collections behind a
post-paint idle callback, and use a lazy page registry with a Suspense fallback
for authenticated routes.

Audit global providers as well as route imports when startup remains slow.
Optional media decoders must load only when their format is actually processed.

**Why:** Route-level splitting alone did not prevent a globally mounted upload
provider from pulling a large HEIC decoder into every visitor's initial bundle.
Network transfer size must also be measured with the production server, not
inferred from Vite's printed gzip estimates.

**How to apply:** Compare the entry artifact with actual response encoding.
Keep optional feature loading outside the startup path, but retain a tool's
mounted state after first use when unmounting would discard drafts or calls.

Apply the same boundary to other data-heavy CRM routes: start the collection
that provides the page's primary content immediately, then defer supporting
collections until after the shell paints. Reports may paint their navigation
and an explicit loading state before starting bulk report collections.

**Why:** Starting every route collection concurrently makes the database-heavy
supporting data compete with the one request needed for a useful screen.

**How to apply:** Keep the primary Calendar events and Inspection jobs eager;
defer synthetic calendar sources, selection lists, inspection media, and bulk
report datasets through the shared post-paint gate. Never show empty totals as
final while the initial deferred queries are still loading.