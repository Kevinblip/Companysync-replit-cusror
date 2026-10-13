---
name: Workflow trigger compatibility
description: Keep workflow template trigger names compatible with the event names emitted by dev and production mutation paths.
---

Workflow templates and entity mutation handlers may use different names for the same business event, such as project completion vs job completion or inspection scheduling vs appointment creation. Matching must support the compatibility aliases in both the development trigger engine and production immediate-trigger engine.

**Why:** A workflow can be explicitly activated and still never run if its catalog trigger name is compared literally against an older operational event name. Development-only fixes are also insufficient because production has its own immediate trigger lookup.

**How to apply:** When adding or renaming a trigger, update both event maps and both matching paths together, and add a parity regression assertion. Keep delayed execution on the shared action executor so provider and recipient failures remain visible.