---
name: Catching crashes that only show up in a built bundle
description: ESLint is broken in this repo so use-before-define bugs reach production; how to reproduce and locate a minified page crash.
---

## ESLint here produces no findings, ever

`npx eslint` crashes with `TypeError: expand is not a function` (minimatch/@eslint/config-array
version conflict) **before it lints anything**. It exits 0 and prints the crash to stderr, so a
piped `| grep <rule>` looks exactly like a clean run.

**Rule:** never conclude "no issues" from an ESLint run in this repo without reading its raw
output. Static use-before-define / TDZ checking is unavailable, so those bugs reach production.

**Why it matters:** a temporal-dead-zone read is not data-dependent — it throws on *every* render,
takes down the whole page through the ErrorBoundary ("System Recovering / CompanySync detected an
unexpected issue"), and the message names a *minified* variable (e.g. "Cannot access 'it' before
initialization"), which is unsearchable in source.

## Recipe: reproduce and locate the crash

1. `npx vite build --sourcemap` (~45s).
2. Serve `dist/` on a spare port with a ~30-line static server that proxies
   `/api|/functions|/auth|/entities|/integrations|/stripe|/ws|/uploads|/objects` to the running dev
   server on 5000. **Do not boot a second `dist/index.cjs`** — that starts crons, Twilio, and
   outbound senders against live data.
3. Drive it with `puppeteer-core` (there is no `puppeteer` package) + the nix chromium at
   `/nix/store/*-chromium-*/bin/chromium`. Scripts must live under the workspace, not `/tmp`, or
   Node cannot resolve `node_modules`.
4. Auth: sign an existing unexpired `sessions.sid` the way `signSessionId` in `db/local-auth.cjs`
   does and set it as the `connect.sid` cookie (see forged-session-testing.md).
5. The ErrorBoundary swallows the throw, so `pageerror` never fires — read the stack off the
   console argument with `arg.evaluate(o => o.stack)`.
6. Map the minified frames with the `source-map` package against `dist/assets/<chunk>.js.map`.
   `SourceMapConsumer` instances here have no `.destroy()`.

Crawling a list of pages this way and diffing "crashed / ok" is the only reliable sweep for this
bug class in this codebase.

## The structural hazard these giant page components have

Pages like `invoice-details.jsx` are ~4k lines. Hooks sit at the top; the money values derived from
the loaded record (`subtotal`, `total`, `amountPaid`, `amountDue`, ...) are declared *far* below,
after the loading and access-denied early returns.

**Rule:** anything derived from those record-level values must be declared next to them, not up in
the hook block. Only real hooks need to stay above the early returns — plain derived consts do not,
and hoisting one up there to "keep the feature's code together" reads the money value from its
temporal dead zone and kills the page.

For the related deleted-state/setter hazard, see [feature-removal-dangling-identifiers.md](feature-removal-dangling-identifiers.md). Bundling can also succeed when a removed local is treated as an unresolved global.
