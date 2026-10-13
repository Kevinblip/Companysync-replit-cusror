---
name: Seeing house sides on Google Maps — tilt is unreliable, Street View is the fallback
description: Why N/E/S/W rotate + 45° tilt on the AI Estimator map can't show the sides/siding of a house, and what to use instead.
---

# Showing the sides of a house: don't rely on Google map tilt

Users want to click N/E/S/W (or a "3D" button) on the AI Estimator satellite map and
see the **sides / siding** of a house at an angle. Two separate Google limitations
make map tilt an unreliable way to deliver this:

1. **Raster satellite maps cannot tilt at all.** `map.setTilt(45)` on a plain raster
   map (`mapTypeId:'satellite'`, no `mapId`) just rotates the flat top-down tiles —
   you still see only the roof. True tilt requires a **vector** map (created with a
   `mapId`).
2. **Even with a vector map, seeing building sides depends on Google having 3D /
   oblique imagery for that exact address.** Google has retired/limited the classic
   45° "oblique" imagery for most addresses, so tilt frequently shows nothing useful.

**Why:** A user insisted the N/E/S/W buttons "used to" give a ~45° angled view of the
siding weeks ago, and now "just spin the flat roof." Git history confirmed the map
init + compass code was **identical** to the working period — no code regression. The
behavior change was on Google's side (oblique imagery coverage). A prior attempt to
add a vector `mapId` + `setTilt(45)` to the drawing map did **not** restore the
angled view and was reverted.

**How to apply:** When the goal is "see the sides of the house," do NOT chase map
tilt/oblique imagery — it's coverage-dependent and Google keeps shrinking it. Use the
reliable fallbacks the app already has:
- **Street View 4-sides panel** (`StreetViewPanel.jsx`, toggled via
  `data-testid="btn-street-view-toggle"` in `InteractiveRoofMap.jsx`) — aims
  panoramas at the house; the N/E/S/W + "Sides" map buttons now open this panel via
  an `openStreetViewRef` (ref reassigned every render so the once-built imperative map
  controls call the freshest opener). Caveat: Street View only covers road-facing
  sides; back/side panoramas are often unavailable.
- **Aerial View API** (`AERIAL_VIEW_API_KEY`, aerialview.googleapis.com proxy in
  `vite-functions-plugin.js`) — auto-generated 3D flyover that orbits the house; works
  at almost any address. Currently behind the hidden-features flag.
