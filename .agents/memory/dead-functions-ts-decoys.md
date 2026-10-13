---
name: functions/*.ts are decoys — the vite plugin is the live handler
description: Why reading functions/<name>.ts to understand a base44 function gives wrong answers, and how to confirm which copy actually executes.
---

For base44 function handlers, `functions/<name>.ts` can be **dead code**. The
live implementation is the handler exported from `vite-functions-plugin.js`.

`db/prod-integrations.cjs` `getFunctionHandlers()` does
`import('../vite-functions-plugin.js')` and reads `mod.functionHandlers`. There
is **no build step that compiles `functions/*.ts`** — nothing imports or
requires those files at runtime. They are only ever read as *text* by test
scripts.

**Why:** the two copies drift, and the stale one reads as authoritative because
it is a clean, well-named, well-commented TypeScript file sitting in an
obvious-looking `functions/` directory. The plugin copy is buried tens of
thousands of lines into a single enormous JS file.

This drift caused two wrong conclusions in one session while investigating
missing window/door/shutter counts: an explorer subagent and then a code-review
subagent both reported that shutter detection "was never implemented" and that
the analyzer "does not return shutter counts". Both had read the `.ts` file. The
live plugin had asked Gemini for `shutters_detail`, called `processShutters`,
and returned `shutter_pair_count`/`shutter_panel_count` the whole time — the
counts simply were not being displayed.

**How to apply:** before editing or reasoning about any base44 function, confirm
which copy runs:

```
grep -n "<functionName>" vite-functions-plugin.js
grep -rn "require(.*<functionName>\|from '.*<functionName>'" --include=*.js --include=*.cjs .
```

A hit in the plugin plus no runtime import of the `.ts` means the plugin wins;
edit that and ignore the `.ts`. Treat a subagent report that cites only
`functions/*.ts` line numbers as unverified — re-check against the plugin before
acting on it, especially when it claims a feature is missing.

Several `scripts/test-*.cjs` assert against the `.ts` file as source-of-truth
text, so those tests can pass while describing code that never executes.
