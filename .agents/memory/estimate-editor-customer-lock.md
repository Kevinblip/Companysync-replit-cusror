---
name: EstimateEditor customer-field lock/unlock
description: How allowCustomerEdit gates the four Customer Information inputs in EstimateEditor.jsx, and the supplement-creation unlock rule.
---

`allowCustomerEdit` (default `false`) gates whether Customer Name/Email/Phone/Property Address are editable whenever a contact is linked (`selectedContactId` set from `estimate.customer_id`/`lead_id`). All four inputs share the exact pattern `disabled={!allowCustomerEdit && selectedContactId}` — any new customer-info field must use the same gate or it will silently ignore the unlock toggle.

Any estimate created as a revision/supplement (`estimate.supplement_of` truthy) auto-unlocks (`setAllowCustomerEdit(true)`) on load, since supplements are drafts meant to be corrected before sending. Non-supplement linked estimates explicitly reset the flag to `false` on load, because React Router navigation between estimates on the same route (e.g. clicking a supplement-chain link) does not remount the component — without the reset, an unlocked state leaks from one estimate's view into the next.

**Why:** users reported supplements/revisions landing with customer fields permanently greyed out, with the only unlock path buried in a "More" dropdown item ("Edit Customer Info"). A second, more discoverable toggle button now lives inline in the Customer Information card next to the "Change" contact button — both drive the same `allowCustomerEdit` state.

**Caveat:** editing customer_name/email/phone/address here only updates that Estimate record's snapshot fields (via `saveMutation`) — it does NOT write back to the linked Customer/Lead entity (only insurance fields like adjuster/claim_number sync back). This is intentional/pre-existing behavior, but a per-estimate correction will not fix the underlying customer record.

**How to apply:** when adding new customer-linked estimate flows (e.g. new duplication/creation entry points), check whether the new draft should start locked or unlocked, and make sure `estimate.supplement_of` (or any future "this is a copy that needs editing" flag) is threaded into this same load-effect branch.
