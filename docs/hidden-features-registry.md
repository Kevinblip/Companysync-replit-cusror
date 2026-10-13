# Hidden Features Registry

Features that are intentionally hidden (but NOT deleted) live behind on/off switches in `src/config/hiddenFeatures.js`. The code for each feature stays in the app; the switch just controls whether it shows. To bring a feature back, open that file and change its flag from `false` to `true` (`true` = shown, `false` = hidden). Currently hidden, all on the AI Estimator's satellite/map view:

- **Generate 3D Aerial Video button** (and its video popup) — flag `AI_ESTIMATOR_AERIAL_VIDEO`.
- **Bottom-left N/E/S/W "all 4 sides" box** — flag `AI_ESTIMATOR_QUAD_VIEW`.

Now shown:

- **Imagery picker** (Default/Clear/Winter/Recent) — flag `AI_ESTIMATOR_IMAGERY_PICKER`, switched on. The "Coming Soon" badge was removed: the picker works and Winter imagery is relied on to see roofs through tree cover.

The gating lives in `src/pages/AIEstimator.jsx` (JSX conditionals for the video button/modal and quad-view box; an `if`-guard around the imperatively-built imagery picker map control).
