---
name: Siding photo orientation rules
description: 4 rules added to analyzeHousePhotosForSiding.ts + getStreetViewImages for EXIF heading binding, satellite anchor, corner splitting, and street-view face alignment.
---

## Rule 1 — EXIF Compass Binding (`extractExifHeading`)
Parses `GPSImgDirection` (tag `0x0011`, RATIONAL type `5`) from JPEG APP1/EXIF bytes via a minimal TIFF walk. Lives in `functions/analyzeHousePhotosForSiding.ts` as `extractExifHeading(buf: ArrayBuffer): number | null` + `_tiffGPSHeading(d: Uint8Array)`.

Download step now fetches raw bytes (chunk-based btoa to avoid stack overflow), tries caller-supplied `photo.exif_heading` first, then parses from bytes. Result stored as `photoData.exif_heading`.

**Why:** Field photos have embedded GPS compass data that is more accurate than Gemini's visual wall-face inference. Without extraction the data is discarded.

**How to apply:** Frontend can also supply `photo.exif_heading` (pre-extracted by `exifr.js`) to skip the server-side parse.

---

## Rule 2 — Satellite Anchor Constraint (`computeFootprintOrientation` + `headingToWallFace`)
Derives 4 wall-face outward-normal azimuths from the OSM polygon XY vertices (`polygon_xy` = `[east_ft, north_ft][]`). Longest edge's right-hand perpendicular = primary wall normal. 4 faces labelled front/right/back/left.

`headingToWallFace(cameraHeading, wallAz)` → `{ face, isOblique, secondaryFace, angularError }`. Camera heading `h` → wall outward normal = `h` (not `h+180`) because camera points TOWARD the wall, which faces back.

`footprintWallAzimuths` is computed immediately after `resolvedFootprint` and before `downloadedPhotos`. When EXIF heading is available AND footprint wall azimuths are known, `result.wall_face` is overridden with the mathematically determined face.

**Why:** Gemini's visual face classification uses door/driveway appearance which is wrong for rear/side walls and heavily biased toward "front".

**How to apply:** Requires OSM polygon in resolvedFootprint. Solar API azimuths are a fallback (not yet plumbed in TS file). `alignOrientationToStreet()` can re-label front/back/left/right using the street-view `frontH` bearing.

Width anchor (`satellite_wall_width_ft`) now also uses EXIF heading to pick `width_ft` vs `length_ft` from the footprint.

---

## Rule 3 — Oblique Corner Splitting
`OBLIQUE_THRESHOLD_DEG = 35`. When `headingToWallFace` returns `angularError > 35°`, the photo spans two intersecting wall facets → `is_corner_shot = true`, `corner_faces = [primary, secondary]`.

Straight shots with EXIF heading clear any accidental `is_corner_shot` flag set by the label-text heuristic (`/corner|angle/`).

**Why:** Corner shots at 30–60° angles are common; treating them as a single flat wall inflates that face's area.

---

## Rule 4 — Street View Alignment (`getStreetViewImages` in `vite-functions-plugin.js`)
The function now:
1. Fetches Solar API for dominant segment azimuth → 4 wall-face azimuths (aligned to `frontH` so "Front" = street-facing).
2. For each face, offsets 80m in the opposite direction from the wall, queries Street View metadata there.
3. Uses `bearingTo(pano_lat, pano_lng, house_lat, house_lng)` as the camera heading (exact, not approximate).
4. Returns 4 images (or 1 if Solar fails) with `direction`, `heading`, `wall_azimuth`, `verified_elevation` (true = face-specific pano found), `evidence_role`.
5. `evidencePolicy` is now `'solar_aligned_wall_face_panoramas'` instead of `'single_house_facing_panorama'`.

**Why:** A single front-facing panorama misses side and rear elevations, causing the siding model to extrapolate dimensions from one face.

**How to apply:** If Solar API fails, falls back to single `frontH` front-facing pano (old behaviour). Main pano used as fallback when a face-specific pano isn't found at the offset point.
