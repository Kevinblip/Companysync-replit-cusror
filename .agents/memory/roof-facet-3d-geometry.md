---
name: Roof facet 3D geometry
description: Constraints and lessons for the Solar-facet 3D roof and correct-by-construction walls
---
- Roof facet geometry (`functions/utils/roofFacetGeometry.js`) is RENDERING-ONLY — never feed its outputs into area/linear/pricing math. Solar segment areas are already slope-adjusted; never re-multiply by pitch.
- **Why:** the 3D viewer is a visualization layer; measurement math has its own audited pipeline and mixing them risks silent pricing drift.
- Hip-vs-valley classification: each facet "sees" the other uphill ⇒ hip, else valley. Junction edges must live on BOTH facets and rectangles must be half-plane-clipped along them, or facets overlap instead of tiling. Symmetric roofs (pyramids) tie on high-corner pair distance — bias pair selection toward the low corner or the wrong diagonal gets picked.
- **Latent-bug lesson:** rotation-convention wall placement (`rotation.y=atan2(dx,dz)` on PlaneGeometry) was 90°-off and only *looked* right on near-rectangular footprints. Walls/wainscot are now built from edge endpoints (ShapeGeometry with real opening holes; wainscot segmented to skip door spans). Never reintroduce rotation-based walls — build from endpoints; guarded by `test:wall-cutouts`.
- Headless screenshot tooling has no WebGL; to visually verify Three.js scenes use puppeteer-core + nix chromium with swiftshader flags (`--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`) against a temporary vite-served harness page.
- Real Solar responses contain several independent ridge systems. Never normalize every ridge to the roof-wide maximum; only reconcile edges explicitly shared by the same facet pair. An unmatched level uphill edge is still roof, not a gable-wall boundary; only sloped exterior side edges get wall infill.
- **Why:** live complex roofs exposed two synthetic-fixture blind spots: global ridge normalization stretched low wings into spikes, while filling below unmatched ridges created full-height vertical sheets through the roof.
- **How to apply:** preserve independent ridge heights on wings/dormers, require shared topology for pairwise height reconciliation, and validate complex changes in at least two rotated SwiftShader views.
- Multi-level Solar elevation is render-only and must preserve meaningful levels above and below the dominant roof. When canonical facets exist, they own the visible roof even if a traced footprint owns the walls.
- **Why:** a single-plate outline approximation flattens dormers and split-level additions; absolute elevation must never change labels or measurement totals.
- **How to apply:** make topology and infill decisions relative to each facet's local plate, and keep edge lengths invariant when an entire roof section moves vertically.

## 3D label decluttering (screen-space collision culling)
Measurement chips (DOM divs projected per-frame) must be placed greedily by priority with rect-collision culling, or 20+ chips stack into an unreadable wall in top-down views. Priorities: 0=wall dims, 1=structural edge LF, 2=facet pitch/area. Two gotchas: (1) cache offsetWidth/Height at creation — a chip hidden by display:none measures 0×0 and corrupts the next frame's collision rect; (2) cull labels at the source too (facets <90 sqft, edges <6 LF emit no chip — hover tooltip covers them).
