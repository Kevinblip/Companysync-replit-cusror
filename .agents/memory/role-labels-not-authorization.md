---
name: Role labels are not authorization
description: Prevents legacy or descriptive staff-role strings from granting broad tenant access.
---

Do not treat a staff profile's free-form or legacy `role` label as proof of
administrator authority. Full-company access requires the explicit
administrator flag, company ownership, or an evaluated permission record.

**Why:** A sales representative profile can retain the label `admin` while its
real administrator flag is false. Trusting that label exposes every customer
instead of only the representative's assigned records.

**How to apply:** Keep tenant-wide bypasses tied to explicit boolean authority
or resolved permissions. Treat role strings as display metadata unless a
specific, validated role system defines otherwise.