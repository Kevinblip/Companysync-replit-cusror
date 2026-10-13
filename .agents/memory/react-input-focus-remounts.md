---
name: React input focus remounts
description: Why a controlled field can lose focus after every character even when its value handler is correct.
---

Do not declare wrapper components inside a rendering component when those wrappers contain interactive fields. Define them at module scope and pass state through props.

**Why:** A new function identity is created on every parent render. React treats that identity as a different component type, unmounts its subtree, and mounts a replacement. A controlled input then loses focus after its first state update and appears to accept only one character at a time.

**How to apply:** When a field loses focus on every keystroke, first check whether any ancestor is a component function declared inside the rendering parent. Regression tests should verify the field remains the same DOM node and stays focused while typing multiple characters.