---
name: Stripe ACH Connect capability
description: ACH invoice Checkout depends on each connected contractor account, not just the platform Stripe account.
---

Do not treat `charges_enabled` or a working card Checkout as proof that ACH works. Each connected Stripe account must have `us_bank_account_ach_payments` active before invoice Checkout should offer bank-account payment.

**Why:** A destination-charge Checkout can be created for a connected account whose general charges are enabled while its ACH capability is missing or inactive, causing inconsistent customer results.

**How to apply:** Check the connected account's ACH capability before offering or requesting ACH. Keep the delayed-settlement webhook subscribed to `checkout.session.async_payment_succeeded`, and only credit the invoice after that event.