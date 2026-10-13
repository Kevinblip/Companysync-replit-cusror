---
name: SQL callback statement termination
description: Production read-only SQL may silently do nothing without a terminating semicolon.
---

Terminate SELECT statements passed to executeSql with a semicolon.

**Why:** A production read returned success with only START TRANSACTION / ROLLBACK and no results when the query lacked a semicolon. A terminated SELECT returned the expected rows.

**How to apply:** Do not interpret transaction-only output as an empty table. Check statement termination before concluding that production data is missing.
