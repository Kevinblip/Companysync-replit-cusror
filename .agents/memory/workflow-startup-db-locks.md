---
name: Workflow startup database locks
description: Why the dev server intermittently fails to open its port, and what the real cause is.
---

A dev server that logs a normal startup but never opens its port is often not
hung on application code — it is blocked in database initialization behind a
lock held by a leaked connection from an earlier process.

**Why:** startup runs schema work (index creation) that needs a lock on a large,
busy table. A single abandoned backend still holding a row-level lock is enough
to block it, and every later boot attempt and query then queues behind that
blocked schema statement. One leaked connection stalls everything touching the
table, so the symptom looks far broader than its cause. Test scripts and probes
that exit without closing their pool are a routine source of these leaks.

**How to apply:** when a workflow times out waiting on a port, check for
ungranted locks before assuming the application code is at fault. Terminate the
old backend actually *holding* the lock — not the blocked waiters, which are
victims — then restart. Restarting the workflow first only adds another waiter.
The dev server must also bind its preview port before awaiting schema DDL:
initialize the database in the background and return a temporary 503 from
database routes until readiness, rather than letting one lock make the whole
preview fail its port health check.

**Prevention lesson:** a standalone script's pool needs server-side timeouts,
not just a `pool.end()` in a `finally`. These connections reach Postgres through
a proxy, so a killed client does not reliably tear its backend down — closing
sockets is a courtesy, `idle_in_transaction_session_timeout` is the only real
guarantee. Process-level teardown must also roll back *every* pool before
waiting on any one of them to drain, and hand back borrowed clients first:
`pool.end()` blocks until checked-out clients are returned, so a serial
close-one-then-the-next leaves later pools holding their locks for the whole
stall. Getting a pool from a shared module instead of constructing it is not an
exemption — it is the easiest way to end up unguarded, because the module's
pool is tuned for a long-lived server. Tag script connections with
`application_name` so the next lock investigation can name the culprit instead
of guessing.

**Additional lesson:** repeated `CREATE INDEX IF NOT EXISTS` checks still take
relation locks even when every index already exists. A current schema should be
verified from `pg_indexes` and skip the DDL; a genuinely missing-index migration
should use a short lock timeout and retry, so background jobs cannot create a
permanent lock queue.
