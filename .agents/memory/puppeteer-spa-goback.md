---
name: Puppeteer SPA goBack failure
description: page.goBack() in Puppeteer reliably fails (blank screenshots) in React SPAs; explicit goto required.
---

## Rule
Never use `page.goBack()` in Puppeteer capture scripts for this SPA. Always navigate back with an explicit `page.goto(BASE + '/RouteName', { waitUntil: 'networkidle2', timeout: 30000 })`.

**Why:** The React app uses client-side routing (pushState). After navigating to a list item by clicking (not by URL), `goBack()` can return to an empty/loading intermediate state that screenshots as a near-blank 5380-byte PNG. The catch block (which falls back to `page.goto()`) fires only on a timeout, adding unnecessary delay.

**How to apply:** In any Puppeteer capture handler that navigates away from a page (e.g. to a detail view) and then needs to return, use an explicit `page.goto()` instead of `page.goBack()`. Increase the post-navigation wait to at least 2500ms to allow React to hydrate.

**Blank screenshot signature:** File size ~5380 bytes for a 1920×1080 screenshot = blank/empty content area. Any screenshot below ~50KB from this app is suspect.
