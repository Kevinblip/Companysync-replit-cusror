---
name: Lexi answer grounding (anti-hallucination)
description: Why Lexi's factual claims are enforced in three layers, and the rules the response audit must keep obeying.
---

# Lexi answer grounding

Every fact Lexi states about a person, job, inspection, schedule, or dollar
amount must come from a tool read that succeeded **in that same turn**.
Enforcement lives in three layers, not one:

1. **Prompt rules** — appended to the shared Lexi system prompt, so all chat and
   voice runtimes inherit them.
2. **Tool-result envelope** — every tool response is annotated with an additive
   `_source` block (status `ok`/`empty`/`failed`/`denied`, row count, and an
   instruction). An empty read is labelled empty instead of arriving as a blank
   object the model reads as "probably fine."
3. **Server-side response audit** — the final text is checked against a ledger of
   what the turn's tools actually proved, and replaced with a refusal if it
   fabricates.

Native voice must buffer sensitive financial/schedule audio until the completed
output transcript has passed the same audit. Financial voice answers are not
model summaries at all: the server assembles the spoken wording directly from
successful `get_financial_summary` payloads, including the exact date range.
Failed/denied lookups use a fixed refusal and discard the model's audio.

**Why:** Gemini Live streams audio before a final transcript exists, so auditing
only the text is too late—the invented number has already been heard. Spoken
transcripts can also spell out numbers and evade `$`-based matching.

**How to apply:** never reintroduce immediate streaming for money or schedule
questions. New native voice bridges must use the shared buffered turn guard and
must provide a deliberate client path for speaking replacement text.

Native voice lifecycle events consumed by the browser—including tool-call,
turn-complete, interruption, and reconnect signals—must remain identical in
development and production bridges.

**Why:** a client-only activity indicator appeared correct in development while
production omitted the tool-call event, so live users could never see the
"checking CRM" phase.

**How to apply:** when adding or changing a browser-visible native voice event,
update both bridges and keep a parity regression check for the event contract.

**Why three layers:** a prompt rule alone had already failed in production on
build routing — the model read the rule and ignored it. A rule the model can
ignore is not enforcement. Only layers 2 and 3 are load-bearing; layer 1 just
improves the odds.

## Rules the audit must keep

- **Money is bound to values, not to tool presence.** It is not enough that a
  money tool ran. Every non-zero dollar figure in the reply must equal a number
  the money read returned, or fall under the sum of its amount-like fields
  (Lexi may legitimately total a list of payments; she may never exceed it).
  A zero-result read and a denied read both license `$0` and nothing more.
  **Why:** the original failure was a confident `$4,500` for a tenant with no
  payments — a presence check would have passed it, because the tool ran fine
  and returned zeros.

- **A denial is not a bypass.** An access-denied money lookup still blocks an
  invented figure; it only changes which refusal text is used.

- **Never block an honest "I can't find them."** Lexi saying a name is not in
  the CRM, and Lexi echoing a name the user themselves typed, are correct
  behaviour. Blocking those turns the guard into the bug.

- **Attachments are their own source.** When the turn carries a document or
  image, figures read out of it are the user's own data and are exempt from
  value binding.

- **Placeholder names are a hardcoded list.** The audit catches "Mary Smith",
  "John Doe" and friends — it deliberately does **not** try to detect arbitrary
  invented people ("Alice Jones"), because a general person-name detector
  false-positives constantly. Layers 1 and 2 cover the general case.

**How to apply:** any new Lexi tool that reads money must be added to the money
tool set, or its figures will be treated as ungrounded. Any new tool-loop exit
path must return a function response — the loop's `finally` block does this
automatically, and removing it silently starves the model of tool results on
every `continue` shortcut.

## Positive read fixtures

Grounding changes must be tested with both empty and nonempty CRM results. An
empty-company refusal cannot prove a tool works or a valid answer passes.

**Why:** a broken income tool and a time-parser false positive both passed
negative-only tests: the refusal looked safe while genuine money and calendar
answers were unusable. Calendar locale strings can include seconds even when
the spoken reply omits them; compare the same clock minute without discarding
the check against invented times.

**How to apply:** require a known nonzero cash total and known scheduled events
to reach the user, alongside the existing fabricated-money/time rejection tests.
When a draft fails the audit after a successful read, a deterministic rendering
of that result may be used only after passing the same audit.

## Verified writes

A write reports BEFORE and AFTER from a real re-read of the row, comparing only
the fields the write asked for. If the stored value does not match what was
requested, the tool returns `success: false` — so the model cannot truthfully
say "done."
**Why:** Lexi reported a reschedule that never landed. Returning a bare
`{ success: true }` immediately after an UPDATE proves nothing; `rowCount` alone
does not prove the value took.
