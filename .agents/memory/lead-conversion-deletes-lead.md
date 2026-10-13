---
name: Lead conversion deletes the lead
description: Why "won"-status lead metrics are always ~0 in this CRM
---

When a lead is converted to a customer (convertToCustomerMutation in
src/pages/Leads.jsx), the flow CREATES a Customer record and then DELETES
the Lead entirely. The lead's status is never set to 'won' as part of
conversion.

**Why this matters:** Any dashboard/report metric of the form
`leads.filter(l => l.status === 'won')` will be ~0 in real data, because
converted leads no longer exist in the Lead table. 'won' is a valid lead
status that can be set manually, but the primary conversion path never uses it.

**How to apply:** To count actual conversions, count Customers (each customer
is effectively a converted lead, since the originating lead is deleted). For a
conversion ratio use `customers.length / (customers.length + leads.length)`.
The Dashboard "Converted Leads" stat card uses this approach.
