#!/usr/bin/env node
/**
 * Wall opening cutout geometry test (no browser needed).
 *
 * Bundles HouseModel3D with esbuild, imports its exported buildPolyWalls, and
 * asserts that door/garage-door apertures pierce BOTH the upper siding wall
 * AND the wainscot below (no solid triangle occupies the aperture), while the
 * wall remains solid outside the apertures.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  \u2713 ${name}`); }
  else { failed++; console.log(`  \u2717 ${name}${extra !== undefined ? ' \u2014 ' + JSON.stringify(extra) : ''}`); }
}

async function main() {
  const out = path.join(os.tmpdir(), `housemodel3d-test-${Date.now()}.mjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'components', 'estimator', 'HouseModel3D.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    loader: { '.jsx': 'jsx' },
    alias: { '@': path.join(__dirname, '..', 'src') },
    external: [],
    logLevel: 'silent',
  });
  const mod = await import('file://' + out);
  fs.unlinkSync(out);
  const { buildPolyWalls } = mod;
  const THREE = await import('three');

  // 40×24 footprint, 9 ft walls, 2 ft stone wainscot.
  const polyXZ = [[-20, -12], [20, -12], [20, 12], [-20, 12]];
  const wallH = 9, stoneH = 2;
  // Edge 0 runs (-20,-12) → (20,-12), length 40.
  const edgeBuckets = {
    0: [
      { type: 'entry_door', width_ft: 3, height_ft: 6.8, pos_x: 10 },
      { type: 'garage_door', width_ft: 9, height_ft: 7, pos_x: 28 },
      { type: 'window', width_ft: 3, height_ft: 4, pos_x: 36, pos_y: 5 },
    ],
  };
  const scene = new THREE.Scene();
  const toDispose = [];
  const tex = new THREE.Texture();
  buildPolyWalls(polyXZ, wallH, stoneH, scene, toDispose, tex, edgeBuckets);

  // Collect all solid triangles lying on edge 0's wall plane (z ≈ -12).
  const tris = [];
  scene.traverse(obj => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pos = obj.geometry.attributes.position;
    const idx = obj.geometry.index;
    const count = idx ? idx.count : pos.count;
    const get = k => {
      const i = idx ? idx.getX(k) : k;
      return [pos.getX(i), pos.getY(i), pos.getZ(i)];
    };
    for (let k = 0; k + 2 < count; k += 3) {
      const t = [get(k), get(k + 1), get(k + 2)];
      if (t.every(v => Math.abs(v[2] + 12) < 0.05)) tris.push(t);
    }
  });
  check('wall triangles found on the front edge plane', tris.length > 0, tris.length);

  // Point-in-triangle in the (x, y) wall plane.
  function covered(x, y) {
    for (const [a, b, c] of tris) {
      const s = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      const s2 = (c[0] - b[0]) * (y - b[1]) - (c[1] - b[1]) * (x - b[0]);
      const s3 = (a[0] - c[0]) * (y - c[1]) - (a[1] - c[1]) * (x - c[0]);
      const hasNeg = s < -1e-6 || s2 < -1e-6 || s3 < -1e-6;
      const hasPos = s > 1e-6 || s2 > 1e-6 || s3 > 1e-6;
      if (!(hasNeg && hasPos)) return true;
    }
    return false;
  }
  // u along edge → world x = -20 + u.
  const X = u => -20 + u;

  // Entry door at u=10 (3 ft wide, 6.8 ft tall): aperture must be open through
  // the wainscot (y=1) and the upper wall (y=4).
  check('entry door aperture open at wainscot height', !covered(X(10), 1.0));
  check('entry door aperture open at mid height', !covered(X(10), 4.0));
  // Garage door at u=28 (9 ft wide, 7 ft tall)
  check('garage aperture open at wainscot height', !covered(X(28), 1.0));
  check('garage aperture open at mid height', !covered(X(26), 4.0));
  check('garage aperture open near its top', !covered(X(28), 6.0));
  // Window at u=36 (centered y≈5): hole in upper wall, wainscot SOLID below it
  check('window aperture open at its center', !covered(X(36), 5.0));
  check('wainscot solid below window', covered(X(36), 1.0));
  // Wall solid between openings and above doors
  check('wall solid between door and garage', covered(X(18), 4.0));
  check('wall solid above entry door', covered(X(10), 8.0));
  check('wainscot solid away from doors', covered(X(2), 1.0));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
