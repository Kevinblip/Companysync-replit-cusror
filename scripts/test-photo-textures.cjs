#!/usr/bin/env node
/** Unit tests for 3D photo-texture application (stale-callback race, azimuth matching, UV mapping). */
async function main() {
  const { applyPhotoTextures } = await import('../src/components/estimator/photoTextures.js');

  let pass = 0, fail = 0;
  const ok = (cond, label, detail = '') => {
    if (cond) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label} ${detail}`); }
  };

  const mkLoader = () => {
    const calls = [];
    return { calls, load(url, onLoad) { calls.push({ url, onLoad }); } };
  };
  const mkTex = () => ({ disposed: false, repeat: { v: null, set(a, b) { this.v = [a, b]; } }, offset: { x: 0 }, dispose() { this.disposed = true; } });
  const mkWall = (over = {}) => {
    const oldMat = {
      disposed: false, map: { disposed: false, dispose() { this.disposed = true; } },
      clone() { return { cloned: true, color: { set() {} } }; },
      dispose() { this.disposed = true; },
    };
    return { az: 180, lenFt: 30, upperH: 9, flipU: false, uvNormalized: false, mesh: { material: oldMat }, _old: oldMat, ...over };
  };

  // 1. Azimuth matching: closest photo within 45° wins; no match → no load
  {
    const loader = mkLoader();
    const started = applyPhotoTextures([mkWall()], [{ url: 'a', az: 100 }, { url: 'b', az: 170 }, { url: 'c', az: 0 }], { loader, isCurrent: () => true, toDispose: [] });
    ok(started === 1 && loader.calls[0].url === 'b', 'closest face azimuth within 45° wins', JSON.stringify(loader.calls.map(c => c.url)));
  }
  {
    const loader = mkLoader();
    const started = applyPhotoTextures([mkWall()], [{ url: 'a', az: 100 }], { loader, isCurrent: () => true, toDispose: [] });
    ok(started === 0 && loader.calls.length === 0, 'photo beyond 45° leaves siding texture');
  }

  // 2. Current scene: texture applied, old material freed, resources tracked
  {
    const loader = mkLoader(); const w = mkWall(); const toDispose = [];
    applyPhotoTextures([w], [{ url: 'u', az: 180 }], { loader, isCurrent: () => true, toDispose });
    const tex = mkTex();
    loader.calls[0].onLoad(tex);
    ok(w.mesh.material.cloned === true && w.mesh.material.map === tex, 'texture applied to cloned material');
    ok(tex.repeat.v && Math.abs(tex.repeat.v[0] - 1 / 30) < 1e-9 && Math.abs(tex.repeat.v[1] - 1 / 9) < 1e-9, 'raw-foot UVs normalized to 0..1', JSON.stringify(tex.repeat.v));
    ok(w._old.disposed && w._old.map.disposed, 'replaced siding material + texture disposed');
    ok(toDispose.length === 2 && toDispose[0] === tex, 'new texture + material tracked for teardown');
  }

  // 3. Stale callback (rebuilt scene): texture disposed, mesh untouched
  {
    const loader = mkLoader(); const w = mkWall(); const toDispose = [];
    applyPhotoTextures([w], [{ url: 'u', az: 180 }], { loader, isCurrent: () => false, toDispose });
    const tex = mkTex();
    loader.calls[0].onLoad(tex);
    ok(tex.disposed, 'stale callback disposes the loaded texture');
    ok(w.mesh.material === w._old, 'stale callback never mutates the detached mesh');
    ok(toDispose.length === 0 && !w._old.disposed, 'stale callback touches no disposal lists or old materials');
  }

  // 4. flipU: negative repeat.x with offset.x=1
  {
    const loader = mkLoader(); const w = mkWall({ flipU: true });
    applyPhotoTextures([w], [{ url: 'u', az: 180 }], { loader, isCurrent: () => true, toDispose: [] });
    const tex = mkTex();
    loader.calls[0].onLoad(tex);
    ok(tex.repeat.v && tex.repeat.v[0] < 0 && tex.offset.x === 1, 'mirrored wall flips photo horizontally', JSON.stringify([tex.repeat.v, tex.offset.x]));
  }

  // 5. uvNormalized walls keep native 0..1 UVs
  {
    const loader = mkLoader(); const w = mkWall({ uvNormalized: true });
    applyPhotoTextures([w], [{ url: 'u', az: 180 }], { loader, isCurrent: () => true, toDispose: [] });
    const tex = mkTex();
    loader.calls[0].onLoad(tex);
    ok(tex.repeat.v === null && tex.offset.x === 0, 'box walls keep native UVs');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
