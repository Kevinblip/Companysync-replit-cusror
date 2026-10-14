'use strict';

// Gemini 2.5 native-audio retires 2026-12-13. New sessions use Gemini 3.8 Live,
// which is already the production web-assistant model. GEMINI_LIVE_MODEL overrides
// it; GEMINI_NATIVE_AUDIO_MODEL remains accepted so existing hosts keep working.
const DEFAULT_GEMINI_LIVE_MODEL = 'models/gemini-3.8-live';

const ALLOWED_GEMINI_LIVE_MODELS = new Set([
  'gemini-3.8-live',
  'gemini-3.1-flash-live-preview',
]);

function normalizeModelId(value) {
  return String(value || '').trim().replace(/^models\//, '');
}

function geminiLiveModel(explicit, env = process.env) {
  const candidates = [explicit, env.GEMINI_LIVE_MODEL, env.GEMINI_NATIVE_AUDIO_MODEL];
  for (const candidate of candidates) {
    const id = normalizeModelId(candidate);
    if (ALLOWED_GEMINI_LIVE_MODELS.has(id)) return `models/${id}`;
  }
  return DEFAULT_GEMINI_LIVE_MODEL;
}

function isAllowedGeminiLiveEngine(engine) {
  return ALLOWED_GEMINI_LIVE_MODELS.has(normalizeModelId(engine));
}

module.exports = {
  DEFAULT_GEMINI_LIVE_MODEL,
  ALLOWED_GEMINI_LIVE_MODELS,
  geminiLiveModel,
  isAllowedGeminiLiveEngine,
};
