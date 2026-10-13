---
name: Training video style
description: Existing CompanySync training videos require both branded visuals and spoken narration.
---

CompanySync training videos should include a real voice-over, a 16:9 landscape composition, full-frame actual CRM screenshots, and bottom title overlays. For settings integrations, show the surrounding General Settings context instead of an isolated control crop.

When the source is a full-page Settings capture, the video topic is the page itself and must cover every major section shown. Do not infer the topic from the first card on the page.

**Why:** A General Settings capture begins with Google Calendar, but the page also includes company defaults, notifications, financial options, personal preferences, security, and account-access history.

**How to apply:** Inventory all sections across the complete upload before writing the title, narration, catalog description, or selecting the catalog slot.

Uploaded training screenshots must be anonymized before publication and each source crop must preserve its native aspect ratio; narrower continuation pages should be letterboxed rather than stretched.

**Why:** Settings captures can include tenant names, staff contact details, payout identities, and account-session history, while PDF continuation pages do not share the first page’s width.

**How to apply:** Redact full dynamic cards—not just one column—replace visible values with fictional demo data, then scale with aspect-ratio preservation and padding.

**Why:** A music-only visual walkthrough was not consistent with the existing training catalog even though its colors, layout, and duration matched.

**How to apply:** When creating or replacing a training video, verify the final MP4 has a spoken narration track, not only background music.

Training catalog slots must be validated against the feature they name: every captured frame should show that workflow or its direct output, not an adjacent page that happens to contain related words.

**Why:** The Photo & Damage Reports slot was assembled from Build Schedule captures, making the published video unrelated to PhotoSync despite having a plausible duration and title.

**How to apply:** Before assembling, inspect representative frames from the first page, core interaction, analysis result, and final output; reject the set if any of those are from a neighboring workflow.

For automated captures of tabbed CRM pages, target the actual tab element and verify its selected state instead of clicking the first matching text label.

**Why:** The same label can appear in navigation, hidden controls, and the active tab strip; text-only automation can click the wrong control while producing a plausible but incorrect screenshot.

**How to apply:** Select by the tab role or a stable test id, then assert the active state and expected panel before capturing the frame.