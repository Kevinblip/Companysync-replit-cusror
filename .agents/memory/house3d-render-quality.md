---
name: House 3D render quality (PBR + presentation mode)
description: Why the estimator's 3D house looked like a diagram, and the rules that keep it looking like a building
---

## Texture UVs are the first thing to check when a surface renders flat
A mesh built from a raw `BufferGeometry` with only a `position` attribute has **no `uv`**, so a
material's `map` samples texel (0,0) for every fragment — the surface renders as one solid colour
and looks like an authoring bug in the lighting, not the geometry.

**Why:** the parametric roof shipped a shingle texture for a long time while rendering as a flat
slab; the texture was never the problem, the missing UV attribute was.

**How to apply:** roof/wall faces get planar UVs projected onto the face's own tangent basis
(u = cross(worldUp, faceNormal) → along the ridge, v = cross(n, u) → up the slope). A world-axis
projection breaks on hips and dormers.

## Pick ONE place to carry texture scale
If UVs are emitted in tile units (`world feet / tileFeet`), `texture.repeat` must stay `1`.
Setting repeat to a face-size ratio *as well* scales the tiling twice, so shingles get tighter
quadratically as the building gets bigger — it looks fine on the one house you tested and wrong on
every larger one.

## Canvas textures: tile in whole courses, and declare sRGB
Course/tab pitch must divide the canvas size evenly (512/32 = 16 courses, 512/64 = 8 tabs) or the
repeat boundary slices a course and shows a seam line across the roof. Canvas textures used as
colour maps must set `colorSpace = SRGBColorSpace`, otherwise they render washed out once filmic
tonemapping is on. Reusing the colour map as `bumpMap` is a cheap, effective relief pass — but any
code that swaps in a real photo (facade photo texture mode) must null the bumpMap or the procedural
lap lines emboss the photograph.

## Realism comes from lighting, not from more geometry
ACESFilmic tonemapping + a PMREM environment probe (`RoomEnvironment`) + `MeshStandardMaterial`
is what separates "product render" from "flat diagram". When the env probe is added, dial the
hemisphere/ambient lights *down* — stacking them on top of image-based lighting washes everything out.
Dark roof tints get crushed to a single black shape under filmic tonemapping, so the shingle tint
multiplier has to stay light enough for the course pattern to survive.

## Customer view vs estimator view
The viewer carries two modes and presentation (customer) is the default: studio backdrop instead of
grass/driveway, no DOM measurement chips, no facet hover tooltip, no spec/stat pills, no diagnostic
badges, and every `THREE.Line*` plus any mesh tagged `userData.measurementOverlay` hidden.

**Why:** homeowners are shown this viewer, and coloured ridge/hip/valley overlays are exactly what
makes the model read as a wireframe diagram rather than their house.

**How to apply:** new measurement annotation must be either a `Line` or tagged
`userData.measurementOverlay = true`, or it will leak into the customer render. React overlays need
their own `!presentation` gate — the scene traversal cannot reach them.

## Verifying it
Headless screenshots have no GPU: puppeteer-core + nix chromium with
`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` against a temporary
vite-served harness page. Footprint polygons are signed offsets from the building **centroid** — a
corner-origin polygon in a test harness renders the walls detached from the roof and looks like a
geometry bug that isn't there.
