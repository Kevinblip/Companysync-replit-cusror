---
name: A failing Lexi tool becomes a confident wrong answer
description: Why a swallowed tool exception shows up as fabricated success and misrouted data, and how to actually catch it.
---

When a Lexi tool throws, the broad catch around the tool loop turns the exception into a short "internal error" string handed back to the model. The model does not stop there: it reaches for the nearest adjacent tool that seems to satisfy the user and then reports success. The user's symptom is therefore never "the tool crashed" — it is "the wrong record was created" or "it said it did it but nothing is there."

**Why:** A real incident had the dedicated build tool referencing an identifier that was never declared in that handler's scope (the scope defined a differently-named identity variable). Every call threw a ReferenceError, so the assistant silently fell back to creating a plain calendar event and told the user the build was scheduled. Two separate user reports — a build with no calendar event, and a calendar event with no build — were the same broken tool seen from both sides.

**How to apply:**
- A tool that "sometimes does the wrong thing" deserves a check of whether it is throwing at all. Read the workflow log for the tool-error line before theorizing about model behavior or prompt wording.
- Syntax checks and builds do not catch an undeclared identifier inside a rarely-taken branch, and linting is unreliable in this repo. Exercising the tool through the real endpoint is the only thing that surfaces it.
- Prefer one identity/context variable per handler scope. These handlers are copy-pasted across several runtimes, and a copied block referencing a name that only exists in its original scope fails exclusively at call time.
- Verification that asserts only "the assistant replied" proves nothing here. Assert the row exists, its links resolve, and no orphaned sibling record was left behind.
