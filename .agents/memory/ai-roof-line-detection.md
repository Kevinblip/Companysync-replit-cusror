---
name: AI roof line detection geometry
description: How "AI Draw Lines for Me" derives drawable roof lines from Google Solar API
---

# AI roof line detection

The "AI Draw Lines for Me" tool draws roof lines from the `aiRoofMeasurement`
function. The Solar API does NOT give true ridge/valley topology — only per-plane
`roofSegmentStats[]` with `center`, `azimuthDegrees`, and an **axis-aligned**
`boundingBox` (sw/ne lat/lng).

**Why a plain bounding box is not enough:** the bbox is always N/S/E/W aligned, so
on a roof that sits at an angle the derived lines look crooked/offset. This was a
real user complaint.

**Rotated-rectangle method (current):** for each plane, rebuild a rectangle rotated
to the true azimuth instead of using bbox edges directly.
- azimuth points downhill → toward the eave; ridge/eave run perpendicular to it,
  rakes run parallel.
- Solve the rectangle's two side lengths from its axis-aligned bbox:
  `bboxW = A·|sin az| + B·|cos az|`, `bboxH = A·|cos az| + B·|sin az|`
  (A = slope-axis depth along azimuth, B = ridge length). det = sin²−cos².
- Near 45° rotation det→0 (ill-conditioned) → fall back to a square-ish estimate;
  also guard degenerate/negative A,B.
- Build corners by offsetting the plane center along bearings (equirectangular:
  east delta scaled by cos(lat)). eave edge = center + A/2 @ az, ridge = @ az+180,
  each spanning ±B/2 @ az±90; rakes connect the eave/ridge ends.

**Hard limits (tell the user honestly):** valleys/hips (between adjacent planes)
are still NOT derived — manual only. The rotated rect is still an approximation of
plane size from the bbox, not a true outline. For exact lines, manual drawing wins.

**Auto-draw is intentionally OFF.** Do NOT auto-run line detection on map load —
it dropped inaccurate lines before the user started and they hated it. Lines only
appear when the user presses the "AI Draw Lines for Me" button.

**Dev/prod parity is mandatory.** Keep the dev handler
(`vite-functions-plugin.js`) and prod handler (`functions/aiRoofMeasurement.ts`) in
lockstep — both must emit identical `detectedLines` {ridge,hip,valley,rake,eave} as
`{lat1,lng1,lat2,lng2}` segments plus `detected_lines_format:'latlng'`, or the
published app silently behaves differently from the workspace.

**Frontend** (`InteractiveRoofMap.jsx` `handleAIDetectLines`): branches on
`detected_lines_format` ('latlng' vs legacy 0-1000 normalized) and attaches custom
drag handles via `makePolylineEditable`.

**Custom edit handles:** the app uses a custom `ClickDrawingManager` (Google's
DrawingManager was removed/changed) and replaces the tiny built-in vertex handles
with custom drag markers (`makePolygonEditable`/`makePolylineEditable`, tracked in
`sectionHandlesRef`/`featureHandlesRef`). Always `destroy()` them on
delete/undo/clear AND on component unmount or they leak map markers/listeners.
Handle marker scale was reduced (vertex ~5, midpoint ~3) after users said the
circles were too big.

## Rotate-all AI lines control
- `rotateAILines(deltaDeg)` in InteractiveRoofMap.jsx rotates every feature with `aiGenerated:true` together around their shared centroid, then calls `featureHandlesRef.current[id].refresh()` to rebuild drag handles.
- Coordinate convention: north is up (+y). With the standard 2D rotation matrix, a POSITIVE angle rotates counterclockwise on screen — so CCW buttons pass positive degrees, CW buttons pass negative. Get this backwards and the icons lie.
- Mutating polyline paths via setPath without setFeatures is fine: `features` holds live Google Maps object refs, so geometry reads stay current.
