---
name: npm audit accepted residuals
description: Which npm audit findings are deliberately accepted (and why), so future security passes don't re-litigate or "fix" them destructively.
---

# npm audit — accepted residual findings (July 2026 pre-launch pass)

After the pre-launch package update (all High findings resolved; axios/lodash/nodemailer/ws/undici/vite/form-data/js-yaml/dompurify patched, nodemailer 8→9 major was safe: createTransport/sendMail API unchanged), these moderates remain and are ACCEPTED:

- **quill XSS via react-quill** — react-quill 2.0.0 is the latest real release and pins quill 1.3.7. npm's "fix" is a bogus downgrade to react-quill 0.0.2; do NOT apply it. Real fix = migrating to a quill-2 fork (react-quill-new), a risky editor swap. Editor is only used by authenticated staff on their own company's content.
- **uuid bounds-check chain under @google-cloud/storage** (gaxios 6.x / teeny-request pin uuid@9) — npm's "fix" is downgrading GCS 7→5, worse than the bug. The advisory only affects uuid v3/v5/v6 with a caller-supplied `buf`; these libs use v4 without buf. Re-check when GCS ships gaxios 7 in a stable release.

**How to apply:** on future `npm audit` passes, run plain `npm audit fix` (never `--force` — it applies the two destructive downgrades above). Regression gate: vitest suites + live smoke workflows (test:body-limit, test:onboarding-trial, test:quick-create-shortcuts) + app boot/screenshot.
