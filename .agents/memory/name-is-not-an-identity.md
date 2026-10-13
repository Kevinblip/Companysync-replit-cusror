---
name: A customer name is not an identity
description: Why documents must never link to a person by name, and the customer/lead resolution contract that replaced it.
---

# A name is not an identity

Never navigate to, claim, or attribute a record by matching a person's name.
Resolve to a stable ID or ask the user to choose.

**Why:** Duplicate and formatting-variant names occur in normal contractor
data, and a wrong match exposes another person's invoices, payments, or
history.

**How to apply:** Normalize a name only to find candidate customers and leads.
Open a record automatically only when there is exactly one candidate across all
relevant entity types; otherwise present a picker. Treat a linked ID as the
destination and any name or stale lead reference as supporting evidence only.

Verify record IDs, contact details, and creation timestamps before treating a
same-name customer as evidence that estimate creation converted a lead.

**Why:** An apparent automatic conversion was actually a newly created lead and
a different, pre-existing customer with the same name. Changing or merging
records on that assumption would have mixed two people's information.

**How to apply:** Establish which record was newly created before changing
conversion behavior or repairing associations. Never copy the lead's address
onto an older same-name customer without confirming they are the same person.
