---
name: Filter value "null" widens the query
description: Why a stored placeholder string silently returns every row with a blank column, and the two guards that stop it.
---

# A stored `"null"` string must never reach a filter as SQL null

Two rules, both required:

1. **Server:** query-string filter values arrive as strings. Only JSON-parse a
   value that starts with `{` or `[` (operator objects like `{$in:[...]}` /
   `{$contains:'x'}`). Never blanket-parse.
2. **Frontend:** sanitize any stored contact field before using it as a lookup
   key. Treat `null`, `undefined`, `none`, `n/a`, `-` (as text) as "no value"
   and skip the lookup entirely.

**Why:** contact fields get saved as the literal text `"null"` when something
writes `String(null)` into the column. That string is truthy, so a plain
`if (lead.email)` guard passes it through. The SDK serializes it to
`?customer_email=null`; a blanket `JSON.parse` turns it back into a real `null`;
and the filter builders expand a null value to `(col IS NULL OR col = '')`.
The result is a lookup for one person returning **every row in the company with
a blank column**.

Note the SDK drops `null`/`undefined` filter values before they reach the wire,
so a bare `null` on the query string is *always* junk text and never an
intentional IS-NULL filter. That is what makes rule 1 safe.

**How to apply:** whenever a profile page shows implausibly many linked records,
check for placeholder text in the field being matched on before assuming runaway
record creation. Also pair every name/email fallback lookup with an
"owned or unlinked" filter — a match on a shared first name must not pull in
records already attached to a different person.
