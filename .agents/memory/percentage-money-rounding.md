---
name: Percentage-of-money rounding
description: Any percent-of-a-dollar-amount calculation must go through integer cents, or it silently books a cent less than it should.
---

Compute a percentage of a money amount by converting the base to integer cents
first, never by evaluating `percent / 100 * amount` (or `Math.round(pct * amount) / 100`)
on the raw dollar float.

```js
const baseCents = Math.round(base * 100);
const cents = Math.round((pct * baseCents) / 100);
return cents / 100;
```

**Why:** binary floating point lands just *under* a half-cent boundary often
enough to round the result down by a full cent. 15% of $4.10 evaluates to
`0.6149999999999999`, so the naive form books $0.61 when the answer is $0.62.
This is invisible in spot checks — the obvious test values (9% of $4,181.12,
9% of $14,224.50) all happen to come out right, so a passing test suite is not
evidence the formula is safe. It surfaces as third-party fees, commissions, tax,
or depreciation being off by a cent against the other party's paperwork.

**How to apply:** anywhere a rate meets a dollar figure — fee deductions,
commission splits, tax lines, depreciation, discounts, markup. When adding or
reviewing one, sweep the whole cent range against an exact integer-cent
reference rather than asserting a handful of literals; a loop over ~20,000 cent
values across several rates catches the boundary cases immediately.
