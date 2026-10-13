---
name: Vite server-plugin edits need a workflow restart
description: Why a user can re-test right after your fix and still see the old behavior — server plugins load once at boot while frontend files hot-reload.
---

# Vite server-plugin edits need a workflow restart

Editing `vite-*-plugin.js`, or any module they `import` at the top level
(`functions/utils/*`, `db/*.cjs`), does **not** take effect until the
`Start application` workflow is restarted. Vite loads plugins once when the dev
server boots; only frontend files hot-reload.

**Why:** this produces a uniquely misleading failure. The user re-tests a feature
right after you say it is fixed, sees the frontend half of your change working
("everything else looks much better") and the server half apparently untouched,
and reasonably concludes the fix did not work. Nothing in the logs says
"stale" — the server happily serves old logic indefinitely.

A duplicate `Port 5000 is already in use` boot failure is the tell that an
**older** process still owns the port and is serving pre-fix code. The app
answers 200 the whole time, so an HTTP health check does not catch it.

**How to apply:** after changing server-plugin code, restart the workflow before
claiming the fix is live, and before asking the user to re-test. When a user
reports "still broken" on backend behavior you just changed, compare the vite
process start time against the file mtime *first* — it is a two-command check
and it is a common cause:

```
ps -o lstart= -p $(lsof -ti:5000 | tail -1)
stat -c '%y' <the file you edited>
```

If the process predates the edit, the report says nothing about your fix yet.
