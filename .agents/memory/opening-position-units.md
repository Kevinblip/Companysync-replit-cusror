---
name: Opening position units
description: How siding opening locations are represented across analyzers and renderers.
---

Opening `pos_x` and `pos_y` values are physical feet from the wall's left edge and grade, respectively. Renderers must divide by the measured face width/height to obtain a drawing fraction.

**Why:** A magnitude heuristic such as “values at or below 1.5 are fractions” corrupts valid openings near a wall edge (for example, an opening centered 1 ft from the edge of a 30 ft wall). The analyzer now stamps new records with `position_unit: 'feet'` so renderers do not need to guess.

**How to apply:** Treat unmarked and `feet` records as physical measurements. Honor normalized coordinates only when the record explicitly declares a normalized/fraction unit; migrate or explicitly label legacy records rather than using coordinate magnitude to detect them.