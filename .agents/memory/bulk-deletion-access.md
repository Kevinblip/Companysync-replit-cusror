---
name: Bulk deletion access
description: User-required permission boundary for mass deletion across CRM and financial records.
---

Bulk deletion must be reserved for platform Super Admins and each company's
owner across customers, leads, invoices, payments, and other record types.
Owners may bulk-delete only within their own company. Ordinary administrator
status must not automatically authorize mass deletion.

**Why:** The user explicitly requested this restriction after seeing a
select-all action capable of deleting an entire customer collection, then
selected "Super Admins and each company's owner" as the intended boundary.

**How to apply:** Enforce this boundary in both bulk-delete controls and server
authorization, using ownership of the actual records. Do not silently expand
this rule into a ban on individual-record deletion.
