---
name: Color Visualizer photo fidelity
description: Why roof recolors and white corner posts need surface-specific, lighting-aware image-edit instructions.
---

## Rule
In exterior photo edits, prioritize the visible roof shingles (including lower wings and additions) when a roof color is selected. Ground standard corner-post edits to boards that already exist and keep their width, texture, and source-photo light and shadow. White is a painted material under the scene's illumination, not a flat #FFFFFF overlay.

**Why:** A real two-view comparison showed a selected medium-gray roof still brown while corner posts became newly outlined, stark-white strips. The former prompt emphasized every corner in pure white and relegated the roof to a short color label; the result looked artificial despite a plausible overall picture.

**How to apply:** Keep contractor and homeowner generation on the same prompt path. Do not use absolute bright-white directives, blanket "every corner" geometry instructions, or flat fills for standard trim. When assessing image quality, check an actual new render as well as prompt text; wording alone cannot guarantee a generative model obeys the selected roof color.