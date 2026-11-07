'use strict';

// Twilio Media Streams are 8 kHz mu-law. Gemini Live expects 16 kHz PCM in and
// speaks 24 kHz PCM out. This is the same conversion the Alex/Lexi phone path uses.

const BIAS = 0x84;
const CLIP = 32635;
const EXP_LUT = new Uint8Array([0,0,1,1,2,2,2,2,3,3,3,3,3,3,3,3,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,5,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,6,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7]);

function mulawEncode(sample) {
  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  const exponent = EXP_LUT[(sample >> 7) & 0xFF];
  const mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

const MULAW_DECODE_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i += 1) {
  const val = ~i & 0xFF;
  const sign = val & 0x80;
  const exponent = (val >> 4) & 0x07;
  const mantissa = val & 0x0F;
  let magnitude = ((mantissa << 3) + BIAS) << exponent;
  magnitude -= BIAS;
  MULAW_DECODE_TABLE[i] = sign ? -magnitude : magnitude;
}

function twilioToGemini(mulawB64) {
  const buf = Buffer.from(mulawB64, 'base64');
  const nSrc = buf.length;
  const pcm8k = new Int16Array(nSrc);
  for (let i = 0; i < nSrc; i += 1) pcm8k[i] = MULAW_DECODE_TABLE[buf[i]];
  const nDst = nSrc * 2;
  const pcm16 = new Int16Array(nDst);
  for (let i = 0; i < nSrc - 1; i += 1) {
    pcm16[i * 2] = pcm8k[i];
    pcm16[i * 2 + 1] = (pcm8k[i] + pcm8k[i + 1]) >> 1;
  }
  if (nSrc) {
    pcm16[nDst - 2] = pcm8k[nSrc - 1];
    pcm16[nDst - 1] = pcm8k[nSrc - 1];
  }
  return Buffer.from(pcm16.buffer).toString('base64');
}

const LP_COEFFS = new Float64Array([0.0595, 0.0990, 0.1571, 0.2030, 0.2218, 0.2030, 0.1571, 0.0990, 0.0595]);
const LP_LEN = LP_COEFFS.length;
const LP_HALF = (LP_LEN - 1) >> 1;

function geminiToTwilio(pcmB64) {
  const buf = Buffer.from(pcmB64, 'base64');
  const nSrc = buf.length >> 1;
  const pcm = new Float64Array(nSrc);
  for (let i = 0; i < nSrc; i += 1) pcm[i] = buf.readInt16LE(i * 2);
  let prev = pcm[0] || 0;
  for (let i = 1; i < nSrc; i += 1) {
    const orig = pcm[i];
    pcm[i] = orig - 0.4 * prev;
    prev = orig;
  }
  const ratio = 3;
  const nDst = Math.floor(nSrc / ratio);
  const out = Buffer.alloc(nDst);
  for (let i = 0; i < nDst; i += 1) {
    const center = i * ratio;
    let acc = 0;
    for (let k = 0; k < LP_LEN; k += 1) {
      const idx = center - LP_HALF + k;
      if (idx >= 0 && idx < nSrc) acc += pcm[idx] * LP_COEFFS[k];
    }
    out[i] = mulawEncode(Math.max(-32768, Math.min(32767, Math.round(acc))));
  }
  return out.toString('base64');
}

function mulawFrames(mulawB64, frameBytes = 160) {
  const audio = Buffer.from(String(mulawB64 || ''), 'base64');
  const frames = [];
  for (let offset = 0; offset < audio.length; offset += frameBytes) {
    frames.push(audio.subarray(offset, offset + frameBytes).toString('base64'));
  }
  return frames;
}

function mulawRms(mulawB64) {
  const buf = Buffer.from(String(mulawB64 || ''), 'base64');
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const sample = MULAW_DECODE_TABLE[buf[i]];
    sum += sample * sample;
  }
  return Math.sqrt(sum / buf.length);
}

module.exports = {
  mulawEncode,
  twilioToGemini,
  geminiToTwilio,
  mulawFrames,
  mulawRms,
};
