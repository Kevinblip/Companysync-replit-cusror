# Flagged separate item: align app prices to $99 / $199 / $399

Cole quotes only the decided prices in `config/salesPricing.json`:

| Plan | Cole quotes | Pages and checkout still show |
|---|---|---|
| Basic | $99/mo | $59/mo |
| Business | $199/mo | $149/mo |
| Enterprise | $399/mo | $299/mo |

Those displayed amounts live on `/PublicPricing`, `/Pricing`, and the checkout buttons that call `createCheckoutSession` with the existing Stripe price IDs. The mapping is `config/salesPricingAlignment.json`.

This pull request does **not** change those pages and does **not** write to Stripe. Changing the display without new Stripe prices would advertise one amount and charge another.

TODO for Kevin, before Cole is used with real buyers:

1. Create Stripe prices for $99, $199, and $399 per month.
2. Put those price IDs in `stripePriceIdsForDecidedAmounts`.
3. Update `/PublicPricing`, `/Pricing`, and `TrialReminderBanner` in the same change so the number on the button matches the Stripe price.

Trial terms Cole may say: 14 days, no credit card, cancel anytime. Free data migration is Enterprise-only.
