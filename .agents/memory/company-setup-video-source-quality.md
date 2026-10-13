---
name: Company Setup video source quality
description: Preserve embedded screenshot resolution when turning PDF captures into training videos.
---

Use the original embedded raster images from a screenshot PDF when producing training videos. Rendering the letter-size PDF first can downsample a roughly 1919px-wide browser capture to under 1000px before it is enlarged into a 1920px video, making UI text permanently blurry.

**Why:** The earlier widescreen training videos used native browser screenshots, while a portrait-PDF render made the Company Setup videos visibly softer even after full-screen cropping.

**How to apply:** Extract embedded page images at their native resolution, anonymize using coordinates scaled to that source, then crop the content column and encode at 1920×1080. Handle short final pages separately instead of scrolling through blank padding.