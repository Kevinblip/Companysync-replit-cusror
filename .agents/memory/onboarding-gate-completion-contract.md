---
name: Onboarding gate completion contract
description: What every QuickSetup completion path must do so the Layout onboarding gate doesn't bounce the user back
---

The dashboard onboarding gate in `src/Layout.jsx` redirects to QuickSetup when the ACTIVE company has `onboarding_completed === false` (explicit false only; NULL is grandfathered and never redirects).

**The rule:** every code path that marks onboarding complete must do all three of:
1. Write `onboarding_completed: true` to the company.
2. Pin `localStorage.last_used_company_id` to that company's id.
3. Flip the flag inside the cached `['layout-companies-list']` query (`setQueriesData`) AND invalidate that key.

**Why:**
- The gate reads Layout's `['layout-companies-list', email]` query (staleTime 3 min), NOT `['companies']`. Invalidating only `['companies']` leaves the gate on stale `false` → user completes setup, navigates to Dashboard, and is instantly bounced back to QuickSetup in a loop.
- Layout and QuickSetup resolve "my company" **independently** (QuickSetup: newest owned; Layout: last_used_company_id → admin staff profile → newest owned). For a user with multiple companies/staff profiles they can disagree — setup completes company A while the gate checks company B. `last_used_company_id` is Layout's first-priority resolution, so pinning it forces agreement.

**How to apply:** any new "finish/skip onboarding" button or server-driven completion must follow the same 3-part contract. When E2E-testing the gate with the QA fixture user (owns 2 companies + 2 admin staff profiles), flip the flag on BOTH companies or results are order-dependent.

Related: multi-location-profile-resolution.md (dual resolution lives in useRoleBasedData AND Layout).
