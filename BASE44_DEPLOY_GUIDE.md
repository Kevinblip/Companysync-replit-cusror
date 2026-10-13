# Base44 Deployment Guide — Sarah Voice Upgrade

Everything here goes into your Base44 platform. Nothing runs on Replit.

---

## 1. Base44 Function: `incomingCall`

**Where:** Base44 Dashboard > Functions > `incomingCall`
**What it does:** Twilio webhook — when a call comes in, it returns TwiML that routes audio to your Railway WebSocket bridge.

**Copy the entire contents of:** `functions/incomingCall.ts`

**Environment variables needed on Base44:**
- `RAILWAY_WS_URL` = `wss://sarah-media-stream-bridge.up.railway.app` (already set if you had this before)

---

## 2. Frontend Component: Voice Selection

**Where:** Your Base44 React app, wherever Sarah's settings are managed (e.g., AI Settings page)
**File:** `src/components/ai/SarahVoiceSettings.base44.jsx`

**How to use:**
```jsx
import SarahVoiceSettings from './SarahVoiceSettings.base44';

// Inside your settings page:
<SarahVoiceSettings companyId={currentCompanyId} />
```

**What it does:** Lets subscribers pick Sarah's voice (Kore, Aoede, Sage, Puck, Charon, Fenrir, Orion). Saves to `AssistantSettings.voice_id` field.

---

## 3. Frontend Component: Presence Settings

**Where:** Same settings page, below the voice selector
**File:** `src/components/ai/SarahPresenceSettings.base44.jsx`

**How to use:**
```jsx
import SarahPresenceSettings from './SarahPresenceSettings.base44';

// Inside your settings page:
<SarahPresenceSettings companyId={currentCompanyId} />
```

**What it does:** Controls response speed, background audio, interim audio (typing sounds), assertiveness slider, and humor slider. Saves to `AssistantSettings` entity.

---

## 4. AssistantSettings Entity Fields Required

Make sure your `AssistantSettings` entity on Base44 has these fields:

| Field | Type | Description |
|-------|------|-------------|
| `company_id` | text | Company reference |
| `assistant_name` | text | Always "sarah" |
| `voice_id` | text | Gemini voice name (Kore, Aoede, etc.) |
| `gemini_voice` | text | Legacy field, same purpose |
| `response_speed` | text | normal / fast / ultra_fast |
| `background_audio` | text | none / call_center / office / cafe |
| `interim_audio` | text | none / typing / thinking |
| `personality_assertiveness` | number | 0-100 slider |
| `personality_humor` | number | 0-100 slider |
| `system_prompt` | text | Custom system prompt |
| `knowledge_base` | text | Company knowledge |
| `website_urls` | text[] | Company websites |
| `custom_responses` | json | Custom Q&A pairs |
| `brand_short_name` | text | Short company name |
| `engine` | text | Gemini model name |

---

## 5. Railway (Separate from Base44)

**Where:** Your Railway project at `sarah-media-stream-bridge.up.railway.app`
**What:** Push the `railway/` folder contents to Railway
**File:** `railway/server.js` + `railway/package.json`

**Railway environment variables:**
- `GOOGLE_GEMINI_API_KEY` — your Gemini API key
- `BASE44_APP_ID` — your Base44 app ID
- `BASE44_SERVICE_ROLE_KEY` — your Base44 service role key

---

## Call Flow Summary

```
Phone Call → Twilio
  → Twilio hits Base44 incomingCall webhook
  → Returns TwiML: <Connect><Stream url="wss://railway..."/></Connect>
  → Twilio opens WebSocket to Railway
  → Railway bridges audio ↔ Gemini Live API
  → Gemini tool calls → Railway calls Base44 API (leads, calendar, appointments)
```

## Files You Can Ignore

These files were earlier attempts and are NOT needed:
- `functions/sarahVoiceBridge.ts` — tried WebSocket in Base44 (doesn't work)
- `functions/sarahFastVoice.ts` — same issue
- `functions/sarahMediaStreamHandler.ts` — same issue
- `functions/geminiLiveCallStream.ts` — same issue
