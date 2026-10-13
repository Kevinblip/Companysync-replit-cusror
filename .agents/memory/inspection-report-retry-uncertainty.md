---
name: Inspection report retry uncertainty
description: Why inspection-report email retries must fail closed after provider acceptance but before durable receipt storage.
---

If an email provider accepts a report email but saving that acceptance fails, leave the recipient's private link valid and the send claim reserved. Do not classify that outcome as a safe retry or revoke the link; another send could duplicate mail while the original message contains a broken link.

**Why:** Provider acceptance and the database receipt are not atomic. A transport exception before acceptance can be retried; an exception after acceptance is an uncertain outcome, not proof that the mail failed.

**How to apply:** Keep ordinary retries tied to the same uploaded report and recipient. When acceptance is uncertain, show a check-email-activity warning and require reconciliation before resending. This principle also applies to other outbound messages that contain newly created signed links.