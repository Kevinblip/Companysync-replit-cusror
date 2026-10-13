---
name: Esri imagery overzoom alignment
description: Why alternate satellite layers (Clear/Winter/Recent) made the roof-drawing target "move", and the correct overzoom fix.
---

# Esri imagery overzoom alignment (roof-drawing map)

In the satellite roof-drawing map, a fixed red bullseye Marker sits at the property
lat/lng. Switching from the Google "Default" layer to an Esri layer (Clear /
Winter / Recent) made the house appear to slide several meters out from under the
bullseye. The marker never moves and the map never pans — the **imagery itself is
misaligned**.

## Root cause
`google.maps.ImageMapType`'s `getTileUrl` can only return a URL; Google always
paints that tile at exactly `tileSize` (256px) in the requested slot. Above the
provider's native max zoom the old code returned the whole low-zoom PARENT tile
for a high-zoom slot, so Google shrank the entire parent area into one 256px slot
— imagery ends up at 1/scale the correct scale and offset by up to `scale` tiles.
At zoom ≤ native it aligns; at drawing zooms (~19–22) it shifts. That shift is the
"target moved" symptom.

**Not the cause:** click-through / event propagation. Google Maps custom controls
already suppress map clicks, so adding `stopPropagation` on the control panel does
nothing for this bug. (Wasted a first attempt on that.)

## Correct fix
Replace the `ImageMapType`+`getTileUrl` overlay with a plain object implementing
the MapType interface (`tileSize`, `maxZoom`, `minZoom`, `getTile`, `releaseTile`)
pushed onto `overlayMapTypes`. In `getTile`, crop the correct sub-region of the
parent tile: a 256px `overflow:hidden` div containing an `<img>` sized
`256*scale`, offset `left = -(coord.x - tx*scale)*256`, `top = -(coord.y -
ty*scale)*256`, src = the native-zoom tile URL. Keep Google satellite as the base
so the marker/drawing coordinate frame stays correct.

**Why:** getTile can build DOM that crops+scales; getTileUrl cannot. This is the
only robust way to overzoom a raster source in Google Maps JS API.

## Sharpness + "no data" tiles (separate from alignment)
Missing-tile behavior differs per Esri endpoint (probe with curl, don't assume):
- **World_Imagery** (server.arcgisonline.com): missing tile → **HTTP 200 + a fixed
  ~2.5KB "Map data not yet available" placeholder JPEG**. `<img>.onerror` NEVER
  fires → that's the gray tiles. Real tiles are ~10–40KB.
- **Wayback** (wayback.maptiles.arcgis.com): missing → real **404**; real tiles
  301-redirect to a CDN. Both endpoints (and the redirect target) send
  `Access-Control-Allow-Origin:*`, so `fetch`+blob inspection is allowed.

Fix: `makeEsriOverzoomOverlay({urlTemplate, preferMax, floor, name})` `fetch`es each
tile, treats `!res.ok` OR `blob.size <= ~4KB` as "no imagery here", and steps DOWN
one zoom at a time (upscaled crop) to the first REAL tile. Nothing real down to
`floor`(16) → leave transparent so Google base shows through. Object URLs +
AbortController; revoke in `releaseTile`. **Do NOT rely on `onerror` for Esri
overzoom** — the 200-placeholder defeats it.

## Wayback release config parse
`config.maptiles.arcgis.com/waybackconfig.json` is an **object keyed by release
number**; values carry `itemTitle` like "World Imagery (Wayback YYYY-MM-DD)" (NO
`releaseNum`/`releaseDatetime` field). Release numbers are **not chronological** —
sort by the date parsed from `itemTitle`. Old code parsed it as an array /
`versionsInfo`, so recent/winter were always null and Winter/Recent silently fell
through to World_Imagery. The tile-URL release id is the object KEY.

## Residual / gotchas
- Even after the fix expect ~0.5–2 m provider drift between Esri and Google orthos
  (different photos). Precise measurements should be drawn on the Default (Google)
  layer; the panel's "Coming Soon" label signals the Esri layers are experimental.
- Esri max native resolution is provider- AND location-limited: at rural addresses
  the sharpest Esri tile can still be softer than Google's Default. Source limit,
  not a rendering bug.
- This is a frontend component (bundled by Vite for dev+prod) — no prod-server.cjs
  mirroring needed.
