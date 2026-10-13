---
name: Mobile camera trip wipes page state
description: Android kills the browser tab while the camera app is open; staged uploads must survive a reload
---
Opening the phone camera from an `<input capture>` often makes Android kill the browser tab in the background; on return the SPA reloads and all in-memory state (staged photos, previews) is silently lost — server logs show earlier uploads succeeded, so it looks like "uploads stopped working".

**Why:** heavy camera apps trigger OS memory reclaim; the file input's onChange never fires after the reload, so the new shot is lost too (user must re-pick via gallery/Upload mode).

**How to apply:** persist staged upload state (remote URLs + metadata, NOT blob: previews) to sessionStorage, scoped to a job/address identity so photos never leak across estimates; restore on mount, re-scope when the address changes in-page, and clear on Start Over / Clear All. Done for AIEstimator housePhotos (`aiestimator_house_photos_v1`). Any other mobile capture flow with multi-photo staging needs the same treatment.
