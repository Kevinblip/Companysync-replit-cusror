#!/usr/bin/env bash
set -euo pipefail

# The builder and deployed VM may have different Nix store paths. Resolve Node
# 20 from the VM's packaged Nix store instead of carrying over a build-machine path.
NODE_BIN=''
for candidate in /nix/store/*-nodejs-20*/bin/node; do
  [[ -x "$candidate" ]] || continue
  if NODE_VERSION="$(env -u NODE_OPTIONS "$candidate" --version 2>/dev/null)" &&
    [[ "$NODE_VERSION" == v20.* ]]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [[ -z "$NODE_BIN" ]]; then
  printf '%s\n' '[Startup] No usable Node 20 executable found in the VM Nix store.' >&2
  exit 1
fi

# Replit injects a network-timeout option that the VM's Node 20.12 does not
# support in NODE_OPTIONS (or on the CLI). Remove only that incompatible option.
if [[ "${NODE_OPTIONS:-}" == *"--network-family-autoselection-attempt-timeout="* ]]; then
  NODE_OPTIONS="$(printf '%s' "$NODE_OPTIONS" | sed -E 's/(^|[[:space:]])--network-family-autoselection-attempt-timeout=[^[:space:]]*//g; s/^[[:space:]]+|[[:space:]]+$//g; s/[[:space:]]+/ /g')"
  export NODE_OPTIONS
fi

printf '[Startup] Node runtime: '
"$NODE_BIN" --version

if [[ "$#" -eq 0 ]]; then
  set -- prod-server.cjs
fi
exec "$NODE_BIN" "$@"