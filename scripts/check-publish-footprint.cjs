#!/usr/bin/env node
'use strict';

// Read-only packaging diagnostics. Never deletes files or reads their contents.
// Used around cleanup in the disposable publishing builder, not the dev server.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const phase = process.argv[2];
if (!['before-cleanup', 'after-cleanup'].includes(phase)) {
  console.error('Usage: node scripts/check-publish-footprint.cjs before-cleanup|after-cleanup');
  process.exit(1);
}

try {
  const output = execFileSync('du', ['-x', '-B1', '--max-depth=1', '.'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 120000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const entries = output.trim().split('\n').map(line => {
    const tab = line.indexOf('\t');
    return { bytes: Number(line.slice(0, tab)), name: line.slice(tab + 1) };
  });
  const total = entries.find(entry => entry.name === '.');
  if (!total || !Number.isSafeInteger(total.bytes)) {
    throw new Error('Cannot determine workspace size from du output');
  }
  console.log(`[Publish] ${phase}: workspace payload ${(total.bytes / 1024 ** 3).toFixed(3)} GiB (${total.bytes} bytes)`);
  for (const entry of entries.filter(entry => entry.name !== '.').sort((a, b) => b.bytes - a.bytes)) {
    console.log(`[Publish] ${phase}: ${entry.name} ${(entry.bytes / 1024 ** 2).toFixed(2)} MiB`);
  }

  if (phase === 'after-cleanup') {
    for (const name of ['.git', '.local', '.agents', '.canvas', 'attached_assets', 'public']) {
      // lstat also detects dangling symlinks, unlike existsSync.
      let present = true;
      try {
        fs.lstatSync(name);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        present = false;
      }
      if (present) throw new Error(`Required publishing exclusion remains: ${name}`);
    }
    for (const name of ['dist/index.html', 'prod-server.cjs', 'scripts/start-production.sh', 'db', 'lib', 'node_modules']) {
      if (!fs.existsSync(path.resolve(name))) {
        throw new Error(`Required production runtime path is missing: ${name}`);
      }
    }
    // This is only the workspace layer, NOT a measurement of the full image.
    // The full image also contains Nix/system and hosting layers.
    if (total.bytes >= 8 * 1024 ** 3) {
      throw new Error('Workspace payload alone reaches the 8 GiB container image limit');
    }
    console.log('[Publish] Cleanup verified; required production runtime paths remain.');
    console.log('[Publish] Workspace size excludes Nix/system layers; full container size is not available here.');
  }
} catch (error) {
  console.error(`[Publish] Packaging check failed: ${error.message}`);
  process.exit(1);
}
