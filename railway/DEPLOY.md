# Sarah Media Stream Bridge - Railway Deployment

## Environment Variables Required in Railway

Set these in your Railway project's Variables tab:

| Variable | Description |
|----------|-------------|
| `GOOGLE_GEMINI_API_KEY` | Your Gemini API key for speech-to-speech |
| `BASE44_APP_ID` | Your Base44 app ID (e.g., `companysync`) |
| `BASE44_SERVICE_ROLE_KEY` | Base44 service role key for reading settings & writing leads |
| `PORT` | Railway sets this automatically — do not set manually |

## Deploy Steps

1. Push the `railway/` folder contents to your Railway project's GitHub repo (or use Railway CLI)
2. Railway will detect `package.json` and run `npm install` + `npm start`
3. Your WebSocket endpoint will be at: `wss://sarah-media-stream-bridge.up.railway.app/ws/twilio`

## Base44 incomingCall Update

In your `incomingCall` function on Base44, the Stream URL now points to Railway:
```
wss://sarah-media-stream-bridge.up.railway.app/ws/twilio?companyId=COMPANY_ID
```

Add `RAILWAY_WS_URL` as an environment variable in Base44 if your Railway URL differs:
```
RAILWAY_WS_URL=wss://sarah-media-stream-bridge.up.railway.app
```

## Call Flow

```
Caller dials → Twilio → Base44 incomingCall (webhook, returns TwiML)
                            ↓
                     TwiML says <Stream url="wss://sarah-media-stream-bridge.up.railway.app/ws/twilio">
                            ↓
                  Twilio opens WebSocket → Railway server
                            ↓
                  Railway bridges audio ↔ Gemini 2.5 Flash (speech-to-speech)
                            ↓
                  Tools (book_appointment, save_lead) → Base44 API
```

## Health Check

```
curl https://sarah-media-stream-bridge.up.railway.app/health
```
