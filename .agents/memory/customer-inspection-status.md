---
name: Customer inspection status
description: Manual customer inspection bookkeeping must remain distinct from report and job-completion evidence.
---

Customers need to be markable as already inspected without manufacturing an
inspection report or completing a scheduled inspection job.

**Why:** The user needs to update customers whose inspections have already
been performed. A status-only update is not proof that photos or a report
exist, and should not trigger job-completion behavior.

**How to apply:** Count manual marks alongside actual completed inspections
in customer status filters. Identify manual marks clearly and allow correction
without erasing completed inspection evidence. Ordinary status updates do not
inherit the Super Admin/owner-only restriction on bulk deletion.
