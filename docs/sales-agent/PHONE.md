# Cole phone line

The toll-free number +1 (888) 670-3112 is Cole's line. YICN Admin Bot points that number's webhooks here after deploy. This app does not buy numbers or change Twilio webhook settings.

## Webhooks

- Voice: `POST /api/sales-agent/voice`
- SMS: `POST /api/sales-agent/sms`
- Status: `POST /api/sales-agent/status`
- Media stream: `wss://<public-host>/ws/sales-phone`

Voice TwiML plays "This call is recorded and transcribed so we can follow up accurately." once, then `<Connect action="/api/sales-agent/voice-fallback"><Stream>` to `/ws/sales-phone` on the same host that answered the webhook. The socket bridges Twilio 8 kHz mu-law to Cole's Gemini Live session (Fenrir by default, `SALES_AGENT_VOICE` overrides it; the same knowledge base, phone prompt, and tools as `/SalesDemo`). Cole does not say the recording notice again. If that voice URL is requested again for the same call, or the stream never connects, the caller hears one apology and the call hangs up. Transcripts and both audio legs land in the sales file store.

Texts from this number are customer care only: booked-demo confirmations and the 24-hour and 1-hour reminders. Marketing follow-ups stay email. Inbound texts get a Cole reply, and STOP / HELP are honored.

## Env

- `SALES_AGENT_PHONE_NUMBER=+18886703112` selects Cole. `+12167777154` stays on YICN Sarah/Alex.
- `SALES_AGENT_SMS_FROM=+18886703112` is the outbound SMS sender.
- `SALES_AGENT_PHONE_ALLOWLIST=+12163318323` while testing. Cole only answers that caller and only texts that destination. Everyone else hears a short refusal. An empty allowlist answers and texts any number.
- `STAGING_READ_ONLY_SIDE_EFFECTS=1` still simulates outbound SMS, except a destination on the allowlist, which is sent for real.
- `SALES_AGENT_VOICE` selects Cole's Gemini Live voice. Unset means Fenrir. Charon, Orus, and Puck are the other allowed values. Lexi and Alex do not read this variable.
- The media stream URL is the host on the voice webhook (`x-forwarded-host`), then `RAILWAY_PUBLIC_DOMAIN`, then `SALES_AGENT_PUBLIC_URL`. It does not follow `APP_URL`, because that is often the product site and that site does not upgrade `/ws/sales-phone`.
- `SALES_AGENT_PUBLIC_URL` is only the stream host when the webhook has no Host header. Signature checks still try `x-forwarded-host`, `RAILWAY_PUBLIC_DOMAIN`, and that public URL.
- `TWILIO_AUTH_TOKEN` validates `X-Twilio-Signature`. Do not print it.

## Railway websockets

`prod-server.cjs` listens on the single `PORT` Railway injects. The HTTP proxy on `*.up.railway.app` upgrades WebSockets on that same port, so Twilio can open `wss://<RAILWAY_PUBLIC_DOMAIN>/ws/sales-phone`. No second port and no DNS change.

If you set `SALES_AGENT_PUBLIC_URL`, point it at the Railway host that serves `/ws/sales-phone`. Do not point it at the product site. Signature checks try `x-forwarded-host`, `RAILWAY_PUBLIC_DOMAIN`, and that public URL, because the proxy host Twilio signed must match.

`/ws/twilio` is closed while staging side effects are suppressed. `/ws/sales-phone` stays open so an allowlisted test call can connect. Media frames keep the socket active; Railway does not need a custom idle timeout for a live call.
