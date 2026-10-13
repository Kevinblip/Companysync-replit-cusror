---
name: Change orders are copy-forward estimates — bill the delta
description: Why a change order's own total must never reach an invoice, and how its chain scoping and line reconciliation have to work.
---

A change order in this app is not a separate record type. It is the existing
supplement / revision: a child estimate produced by copying the parent forward
and then editing it. The child therefore holds the FULL revised scope, not just
the new work.

**Rule: the only amount a change order may contribute to an invoice is its net
delta against its parent.**

**Why:** billing the change order's own total on top of the original estimate
charges the homeowner for the entire job a second time. The copy-forward makes
the child's total look like a standalone number, which is exactly why the
mistake is easy to make and hard to spot — both numbers are individually
plausible.

**How to apply:**

- Delta = child's saved total − parent's saved total. Use the saved totals, not
  the line sums, so discounts and adjustments are included.
- No parent resolvable ⇒ contribute nothing. A guessed baseline is worse than
  no line.
- Scope contributions to the base estimate's OWN revision chain (walk
  `supplement_of` to the root). A customer routinely has several unrelated
  estimates; without the chain check, one job's approved change order lands on
  another job's invoice.
- Approval state gates the money: only an explicit `approved` counts, and any
  unrecognized state must resolve to pending, never approved.
- Strip the change-order fields in the copy-forward skip set, alongside the
  chain fields. Otherwise a change order created from an approved one is born
  approved and billable without anyone reviewing it.

**Line reconciliation:** an estimate's discount lives in its total, not in its
lines, so carrying raw estimate lines onto an invoice produces items that don't
sum to the invoice total. Emit a balancing line, and write an explicit numeric
`amount` on every generated line — downstream consumers (QuickBooks sync, PDF
builders) read `amount`, and a line that only ever carried `rcv` exports as
undefined.

**Approval is a money permission, not a UI state.** Because approving flips a
change order into the next invoice, hiding the button is not the control — the
gate belongs on the server. Four failure modes, each of which independently
defeats the other three:

- Authorization: administrator of the *owning* company, or that company's
  owner. An admin of a different company must be refused.
- Attribution: stamp the approver from the SESSION and overwrite whatever the
  client sent. A client-supplied approver is both spoofable and empty during
  the window before the auth call resolves, and an approval naming nobody looks
  reviewed when it wasn't. Refuse the write rather than record a blank approver.
- Creation, not just update: if the create path is unguarded, the update guard
  is a speed bump — anyone can POST a record that is already approved. A change
  order is always born pending; only a service/restore caller may replay a real
  historical decision.
- **Post-approval mutation: an approval is a decision about a SPECIFIC amount.**
  Gating only the status field leaves the total and the line items editable, so
  the bill grows after sign-off with the approval still attached. Any change to
  what a decided change order bills — its total, its lines, or which parent
  chain it points at — must revoke the decision back to pending. Where no
  caller can be identified, refuse the edit instead.

Enumerate every write path before believing any of this is enforced. Entity API
update is the obvious one; single create, bulk create, unauthenticated legacy
direct routes, and import/sync upserts are the ones that get missed, and a
guard that covers three of five is not a boundary. Each path must also close
the nested JSONB route, since these fields are not real columns.

**Diffing lines:** match on code + description, paired positionally within
duplicates, and compare stored RCV only. Recomputing quantity × rate makes a
carrier's intentionally rounded or $0 line read as repriced on every comparison.
