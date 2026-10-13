---
name: Gemini image generation API
description: How to call Gemini for image-to-image editing/generation; which model names actually exist, response format, and key differences from text-only models.
---

## The rule
For image-to-image editing / image generation via the generateContent REST API, use a model whose name you have **verified against the live ListModels endpoint** — do NOT trust a remembered model name. Model availability also depends on the specific API key's project.

Verify before using:
```
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$KEY" | \
  python3 -c "import sys,json;[print(m['name'], m.get('supportedGenerationMethods')) for m in json.load(sys.stdin)['models'] if 'image' in m['name'].lower()]"
```

As of 2026-07, models that returned HTTP 200 with an image for this project's key: `gemini-2.5-flash-image`, `gemini-3.1-flash-image`, `gemini-3-pro-image` (all support `generateContent`). The `imagen-4.0-*` models use the `predict` method, NOT `generateContent`.

**`gemini-2.0-flash-preview-image-generation` DOES NOT EXIST → returns HTTP 404** ("not found for API version v1beta"). An earlier version of this note wrongly claimed it was correct, which caused a live 404 outage of the Color Visualizer. Same for the old `gemini-2.0-flash-exp-image-generation`.

Request must include `generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }`.
The generated image is in `candidates[0].content.parts.find(p => p.inlineData)` — NOT `parts[0]` (order of text vs image part is not guaranteed).

**Why:** Model names churn and a wrong name fails as a 404 that looks like a "bad photo" error to the user, not an obvious config bug. Guessing/remembering the name burned real production time twice.

**How to apply:**
- The Color Visualizer handler (`generateColorVisualization` in `vite-functions-plugin.js`) now iterates a list of known-good models and only falls through to the next one on a 404, so one dead model name can't take the feature down. Keep that list seeded with names verified from ListModels.
- The handler resolves the key via `getCompanyGeminiKey(companyId)`: company BYOK key (generic_entities `CompanyApiKeys`.data.gemini_api_key, decrypted) first, else `process.env.GOOGLE_GEMINI_API_KEY`. A 404 can therefore be caused by a BYOK key whose project lacks the model, not just a wrong name.
- **Prod is a separate deploy:** editing the handler only fixes dev; production keeps running the last-published code until the user republishes. A model-name bug fixed in dev still 404s in prod until redeploy.

```javascript
const IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-3.1-flash-image', 'gemini-3-pro-image'];
const body = {
  contents: [{ role: 'user', parts: [
    { inlineData: { mimeType: photo.mimeType, data: photo.base64 } },
    { text: prompt }
  ]}],
  generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
};
// loop models, break on r.ok, continue only on r.status === 404
const parts = data.candidates?.[0]?.content?.parts || [];
const imagePart = parts.find(p => p.inlineData);
```
