---
name: VM deploy node PATH & nix layer cache
description: Production VM "node: command not found" fix and the replit.nix layer-cache trap
---

# VM deploy node PATH & nix layer cache

**Rule 1:** Neither bare `node` nor an absolute path captured from the build container is reliable in the production VM. Declare Node 20 as a Nix system dependency, resolve a compatible Node 20 executable from the VM's own Nix store at startup, and fail clearly if it is absent. Do not fall back to an unverified `node` on `PATH`.

**Why:** The VM run environment can resolve a different runtime than the build container, and their absolute Nix store paths are not portable between images. The wrong Node version rejected Replit's injected network-timeout option; an empty value also needs normalization before Node 20 can parse it. A successful build does not establish runtime compatibility or public-site health.

**How to apply:** Keep the Node 20 Nix dependency and runtime startup resolver paired. Add a build-time launcher smoke check, remove only the confirmed incompatible Replit network-timeout option from `NODE_OPTIONS`, and preserve all other options.

**Rule 2 (revised 2026-08-11):** The 2026-08-11 outage proved the run image's nix store can be CORRUPT (missing node store path AND replit_rtld_loader.so — ld.so errors in deploy logs) while builds report "success". In that state the fix IS to change replit.nix (added pkgs.nodejs_20 via installSystemDependencies) — it busts the corrupt cached nix layer and guarantees node in the run image. Caveat: a fresh nix layer build can fail at "verifying nix store path integrity"; a failed publish keeps the old build serving.

**Rule 3:** A failed publish does NOT take the live site down — the previous successful build keeps serving. Always `curl` the production URL before assuming an outage; user-side "can't view app" may be the PWA service worker caching an error page (hard refresh).

**How to apply:** debugging publish failures here → check `listDeploymentBuilds` status, read the failed build tail, distinguish build vs promote vs packaging failures, and verify the live URL independently.
