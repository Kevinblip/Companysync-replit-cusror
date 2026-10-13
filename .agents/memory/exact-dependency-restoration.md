---
name: Exact dependency restoration
description: Avoid accidental major upgrades when repairing a missing npm package in an existing project.
---

When a declared npm package is missing from node_modules, install the version already recorded in package-lock.json (or the exact declared compatible version), not `@latest`.

**Why:** The package-management installer can rewrite package.json and package-lock.json when given `@latest`, turning a missing-package repair into an unrelated major toolchain upgrade.

**How to apply:** Check package.json and package-lock.json first, install the exact locked version, then run the build and restore any package metadata changes that were not part of the requested work.