---
name: functions.invoke() returns an envelope, not the payload
description: The invoke() API contract — payload nested under .data, failures resolve instead of throwing — and the two bug shapes that follow from ignoring it.
---

# `base44.functions.invoke()` returns an envelope

The contract, end to end:

- The server route always wraps the handler's return value: `{ data: <handler return> }`.
- The client passes that through unchanged, so the UI sees exactly **one**
  level of nesting — even when the handler's own value contains a `data` key.
- On failure the client returns `{ error: '<message>', data: {} }` and
  **resolves rather than rejecting**.

## Why this matters more than it looks

Because failures resolve, `try/catch` around an invoke call catches almost
nothing, and a `useMutation` whose `mutationFn` returns the envelope fires
`onSuccess` on failure. Because the payload is nested, any field read straight
off the envelope is `undefined`.

Two consequences:

1. **Silent wrong behavior** — a success toast after a real failure, "Imported
   undefined accounts", a disbursed payout never marked completed, an empty
   list that should have rows.
2. **A delayed hard crash** — the `undefined` survives until something calls
   `.toFixed()` / `.forEach()` on it, then the error boundary takes the page
   down. The symptom is a generic "Cannot read properties of undefined" on a
   page nobody has edited in months.

**Why it looks like a fresh regression:** the bug is latent from the day the
call site is written and only surfaces when that path first gets a *successful*
response. These pages often behave fine while the backend is broken (the
failure envelope sends the code down a fallback branch) and start crashing once
the backend starts succeeding.

## Rule

`payload = envelope?.data` is always correct; `.error` is the only field
legitimately read off the envelope. Use `src/lib/functionResult.js`
(`fnData` / `fnError` / `fnOk` / `fnNumber`) instead of touching the envelope.
Guard numeric render paths with `fnNumber` so a partial payload degrades to `0`
rather than white-screening.

**How to apply:** at every new invoke call site, and *first* when triaging a
"Cannot read properties of undefined" on an untouched page. Two shapes are
worth grepping for during an audit: a payload property read off the invoke
result, and a `queryFn` that returns the raw envelope (which caches the
envelope, so every consumer of that query reads undefined).

**Money paths:** a transport-level failure is ambiguous — the upstream transfer
may still have happened. Report it as ambiguous rather than as a failure, or a
blind retry sends the money twice. Real protection needs provider-side
idempotency keyed on the payout id; that does not exist yet here.
