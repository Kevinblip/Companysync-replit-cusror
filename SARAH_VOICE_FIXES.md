# Sarah Voice Assistant Fixes - Copy to Base44

## ROOT CAUSE FOUND

The main `SarahSettings` page was overwriting the `voice_id` every time you saved ANY setting. It defaulted `voice_id` to `"Bella"` — which is NOT a valid Gemini voice. So even if you changed the voice to "Aoede" in the voice widget, the next time you saved anything on the main settings page, it would overwrite `voice_id` back to `"Bella"`, and the bridge would fall back to `Kore`.

## Files to Update on Base44

### 1. `components/ai/SarahVoiceSettings.jsx`
Copy the full contents from `src/components/ai/SarahVoiceSettings.base44.jsx` in Replit.

Changes:
- Fixed voice list (removed invalid Sage/Orion, added valid Leda/Orus/Zephyr)
- Added test voice play button

### 2. `pages/SarahSettings.jsx` — CRITICAL FIX
Three changes needed:

**A. Change the default `voice_id` from `"Bella"` to `""`:**
Find: `voice_id: "Bella"` (appears twice - in initial state and in the loading function)
Replace with: `voice_id: ""`

**B. Exclude `voice_id` from the save payload:**
In the `saveMutation`, change:
```js
// OLD:
const payload = {
  company_id: company?.id,
  ...form,
};

// NEW:
const { voice_id: _excludeVoiceId, ...formWithoutVoice } = form;
const payload = {
  company_id: company?.id,
  ...formWithoutVoice,
};
```

**C. Update the voice input field text:**
Find the voice_id Input field and change it to disabled with updated help text:
```jsx
<Input value={form.voice_id} disabled placeholder="Managed by Voice Settings below" className="mt-2" />
<p className="text-xs text-blue-600 mt-1">Voice is managed by the "Sarah's Voice" card below. Valid: Kore, Aoede, Leda, Puck, Charon, Fenrir, Orus, Zephyr</p>
```

### 3. `functions/sarahBridgeAPI.ts` — Optional Logging
Added `voice_id` to the debug log in the `getSettings` action. Copy from Replit if you want better debugging.

### 4. `vite-twilio-ws-plugin.js` — Already Active on Replit
- Keepalive ping (prevents call disconnects)
- Voice debug logging
- These run on Replit, no Base44 changes needed.

## Valid Gemini 2.5 Flash Voices
```
Kore    - Female, bright, energetic
Aoede   - Female, warm, clear
Leda    - Female, soft, soothing
Puck    - Neutral, friendly, warm
Charon  - Male, deep, smooth
Fenrir  - Male, strong, bold
Orus    - Male, calm, neutral
Zephyr  - Neutral, breezy, light
```

Any voice not in this list falls back to `Kore` with a warning in the bridge logs.
