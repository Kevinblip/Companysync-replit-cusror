#!/usr/bin/env node
/**
 * test-wall-face-materials.cjs
 *
 * The 3D viewer used to render every wall with the same lap-siding texture, so
 * a brick elevation looked like vinyl and hid the real scope of work. Walls now
 * resolve cladding per face.
 *
 * The invariant that matters most is the NEGATIVE one: a material observed on
 * one elevation must never be painted onto an elevation nobody photographed.
 * An unmeasured wall renders as plain lap siding, exactly like before.
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

// Canvas stub: the texture builders are pure 2D-canvas drawing code, and we only
// care which builder was selected, not the pixels it produced.
function installCanvasStub() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (prop === 'canvas') return undefined;
      return () => {};
    },
    set: () => true,
  });
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
}

async function main() {
  installCanvasStub();

  const out = path.join(os.tmpdir(), `wall-materials-${Date.now()}.mjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'components', 'estimator', 'HouseModel3D.jsx')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: out,
    loader: { '.jsx': 'jsx' },
    // The existing wall-cutout test omits this and dies on "@/utils/...".
    alias: { '@': path.join(__dirname, '..', 'src') },
    logLevel: 'silent',
  });
  const mod = await import('file://' + out);
  fs.unlinkSync(out);
  const { assignMaterialsToEdges, materialRender, buildPolyWalls } = mod;
  const THREE = await import('three');

  check('assignMaterialsToEdges is exported', typeof assignMaterialsToEdges === 'function');
  check('materialRender is exported', typeof materialRender === 'function');

  // A 40x24 rectangle: four edges, normals exactly 90 deg apart, so every edge
  // is within 45 deg of exactly one canonical face.
  const polyXZ = [[-20, -12], [20, -12], [20, 12], [-20, 12]];
  const FACES = ['front', 'back', 'left_side', 'right_side'];
  const makeFakeTex = () => {
    const t = { isFake: true, repeat: { set(x, y) { this.x = x; this.y = y; } } };
    t.clone = () => { const c = { ...t, repeat: { set(x, y) { this.x = x; this.y = y; } } }; c.clone = t.clone; return c; };
    return t;
  };
  const collectAll = (edgeMaterials, stoneH = 0, edgeAccentMaterials = null) => {
    const scene = new THREE.Scene();
    const toDispose = [];
    buildPolyWalls(polyXZ, 9, stoneH, scene, toDispose, makeFakeTex(), null, null, edgeMaterials, null, edgeAccentMaterials);
    return scene.children.filter(o => o.isMesh);
  };
  const collect = (edgeMaterials) =>
    collectAll(edgeMaterials).filter(o => o.material && o.material.map);

  console.log('\n\u2500\u2500 1. A single measured brick face does not smear \u2500\u2500');
  for (const face of FACES) {
    const edges = assignMaterialsToEdges(polyXZ, { [face]: 'brick' }, null);
    const brickCount = edges.filter(m => m === 'brick').length;
    const nullCount = edges.filter(m => m == null).length;
    check(`only one edge is brick when just "${face}" is measured`,
      brickCount === 1, { face, edges });
    check(`the other three edges stay unmeasured when just "${face}" is measured`,
      nullCount === 3, { face, edges });
  }

  console.log('\n\u2500\u2500 2. Every measured face keeps its own material \u2500\u2500');
  {
    const map = { front: 'brick', back: 'vinyl', left_side: 'stucco', right_side: 'stone' };
    const edges = assignMaterialsToEdges(polyXZ, map, null);
    check('all four edges resolve to a material', edges.every(m => m != null), edges);
    check('all four materials are distinct (no face overwrites another)',
      new Set(edges).size === 4, edges);
    for (const m of Object.values(map)) {
      check(`"${m}" is present exactly once`, edges.filter(e => e === m).length === 1, edges);
    }
  }

  console.log('\n\u2500\u2500 3. Empty / unusable material data changes nothing \u2500\u2500');
  {
    check('no measured faces -> every edge unmeasured',
      assignMaterialsToEdges(polyXZ, {}, null).every(m => m == null));
    check('null map is handled without throwing',
      assignMaterialsToEdges(polyXZ, null, null).every(m => m == null));
  }

  console.log('\n\u2500\u2500 4. materialRender distinguishes the materials that matter \u2500\u2500');
  {
    const brick = materialRender('brick');
    const stone = materialRender('stone');
    const stucco = materialRender('stucco');
    const vinyl = materialRender('vinyl');
    const unknown = materialRender('some_material_we_never_heard_of');
    const nothing = materialRender(null);

    check('brick, stone and stucco are three different renderers',
      new Set([brick, stone, stucco]).size === 3);
    check('brick does NOT render as lap siding', brick !== vinyl);
    check('vinyl falls through to the lap renderer', vinyl === unknown && unknown === nothing);
    check('masonry uses a white tint so its own colour shows',
      brick.color === 0xffffff && stone.color === 0xffffff);
    check('lap siding keeps its original 1/8 repeat', vinyl.repeat === 1 / 8);
    check('brick is scaled tighter than lap siding (finer courses)',
      brick.repeat > vinyl.repeat, { brick: brick.repeat, vinyl: vinyl.repeat });
    // Synonyms an LLM realistically emits must not silently fall back to vinyl.
    check('"brick_veneer" resolves to brick', materialRender('brick_veneer') === brick);
    check('"natural stone" resolves to stone', materialRender('natural stone') === stone);
    check('"EIFS" resolves to stucco', materialRender('EIFS') === stucco);
    check('material matching is case-insensitive', materialRender('Brick') === brick);
  }

  console.log('\n\u2500\u2500 5. Legacy path (no material data) is unchanged \u2500\u2500');
  {
    // A wall built with edgeMaterials=null must use the caller's texture at the
    // original repeat and tint — this is the no-regression guarantee.
    const legacy = collect(null);
    check('legacy render still produces one textured mesh per edge',
      legacy.length === 4, { got: legacy.length });
    check('legacy meshes all use the caller-supplied texture',
      legacy.every(m => m.material.map.isFake === true));
    check('legacy meshes keep the 1/8 repeat',
      legacy.every(m => m.material.map.repeat.x === 1 / 8 && m.material.map.repeat.y === 1 / 8));
    const legacyColor = legacy[0].material.color.getHex();
    check('legacy meshes keep a single consistent wall tint',
      legacy.every(m => m.material.color.getHex() === legacyColor));

    // One brick face -> that wall must differ, the rest must match legacy.
    const mixed = collect(assignMaterialsToEdges(polyXZ, { front: 'brick' }, null));
    check('mixed render still produces one mesh per edge', mixed.length === 4, { got: mixed.length });
    const brickWalls = mixed.filter(m => m.material.map.isFake !== true);
    const lapWalls = mixed.filter(m => m.material.map.isFake === true);
    check('exactly one wall switched to a generated masonry texture',
      brickWalls.length === 1, { brick: brickWalls.length, lap: lapWalls.length });
    check('the other three walls still use the caller-supplied lap texture',
      lapWalls.length === 3);
    check('the three lap walls kept the legacy 1/8 repeat',
      lapWalls.every(m => m.material.map.repeat.x === 1 / 8));
    check('the brick wall uses a different repeat than lap siding',
      brickWalls[0].material.map.repeat.x === 1 / 4,
      { got: brickWalls[0].material.map.repeat.x });
    check('the brick wall is tinted white so the texture shows',
      brickWalls[0].material.color.getHex() === 0xffffff);
  }

  console.log('\n\u2500\u2500 6. Wainscot uses only the observed face accent \u2500\u2500');
  {
    const accents = assignMaterialsToEdges(polyXZ, { front: 'brick' }, null);
    const meshes = collectAll(null, 2, accents);
    const bands = meshes.filter(m => {
      const pos = m.geometry?.attributes?.position;
      if (!pos) return false;
      let maxY = -Infinity;
      for (let i = 0; i < pos.count; i++) maxY = Math.max(maxY, pos.getY(i));
      return Math.abs(maxY - 2) < 0.001;
    });
    const textured = bands.filter(m => !!m.material.map);
    const flat = bands.filter(m => !m.material.map);
    check('one wainscot band is built per footprint edge', bands.length === 4, { got: bands.length });
    check('only the photographed brick accent gets a texture', textured.length === 1,
      { textured: textured.length, flat: flat.length });
    check('unobserved accents keep the legacy flat band', flat.length === 3);
    check('brick accent uses the brick texture repeat',
      textured[0]?.material.map.repeat.x === 1 / 4,
      { got: textured[0]?.material.map.repeat.x });
    check('textured wainscot geometry includes planar UVs',
      !!textured[0]?.geometry.attributes.uv &&
      textured[0].geometry.attributes.uv.count === textured[0].geometry.attributes.position.count);
  }

  console.log(`\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`);
  console.log(`${passed + failed} checks \u2014 ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log('\u274c FAILED'); process.exit(1); }
  console.log('\u2705 Per-face wall materials verified');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
