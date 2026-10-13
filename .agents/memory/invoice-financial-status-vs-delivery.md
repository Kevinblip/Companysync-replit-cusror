---
name: Invoice financial status vs delivery
description: Why invoice creation, payment, and old sent labels cannot establish customer email delivery.
---

An invoice's financial state and its customer-message delivery state are independent. A converted estimate was historically labeled "sent" by creation alone, and staff could record payments against it without any tracked invoice-email attempt. An old "sent" label, a payment, or a sent date is not evidence of provider acceptance, delivery, or reading. The absence of an app send record means delivery is unconfirmed, not that an off-platform message never happened.

**Why:** This distinction mattered in a live incident: the customer invoice was marked sent after estimate conversion while its email audit had no attempt, and separate manual payments made the invoice appear active.

**How to apply:** Never claim customer delivery from invoice/payment state. Keep paid and partially paid financial statuses intact when sending by email or SMS. Do not even update a paid invoice's send date via the generic entity route: an unrelated edit can replay status-based payment workflows. Use an audited attempt to report provider submission and a matching webhook to report delivery or bounce; even delivered does not mean opened. Do not automatically resend or retroactively change financial history to repair misleading old labels.