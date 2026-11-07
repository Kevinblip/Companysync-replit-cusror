'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths.cjs');

function recordingsDir() {
  const dir = path.join(dataDir(), 'recordings');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function wavHeader(dataLength, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

function writeWav(file, pcm, sampleRate) {
  const body = Buffer.isBuffer(pcm) ? pcm : Buffer.concat(pcm);
  fs.writeFileSync(file, Buffer.concat([wavHeader(body.length, sampleRate), body]));
  return file;
}

function createRecorder(callId) {
  const inbound = [];
  const outbound = [];
  let inRate = 16000;
  let outRate = 24000;
  return {
    pushInbound(base64, rate) {
      if (!base64) return;
      if (rate) inRate = rate;
      inbound.push(Buffer.from(base64, 'base64'));
    },
    pushOutbound(base64, rate) {
      if (!base64) return;
      if (rate) outRate = rate;
      outbound.push(Buffer.from(base64, 'base64'));
    },
    flush() {
      const dir = recordingsDir();
      const safe = String(callId).replace(/[^a-zA-Z0-9_-]/g, '');
      const files = {};
      if (inbound.length) files.in = writeWav(path.join(dir, `${safe}-in.wav`), inbound, inRate);
      if (outbound.length) files.out = writeWav(path.join(dir, `${safe}-out.wav`), outbound, outRate);
      return files;
    },
  };
}

function localSynopsis(transcript) {
  const lines = (transcript || []).slice(-8).map((line) => `${line.role}: ${line.text}`).join(' ');
  const brief = lines.replace(/\s+/g, ' ').slice(0, 420);
  return brief
    ? `Synopsis: ${brief}`
    : 'Synopsis: short call with no transcript captured.';
}

async function geminiSynopsis(transcript, apiKey, fetchImpl = fetch) {
  if (!apiKey || process.env.SALES_AGENT_SKIP_SYNOPSIS === '1') return localSynopsis(transcript);
  const text = (transcript || []).map((line) => `${line.role}: ${line.text}`).join('\n').slice(0, 12000);
  try {
    const resp = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `Summarize this CompanySync sales call in 4 short bullets: what they do, what they care about, objections, and the next step. Do not invent prices.\n\n${text}` }] }],
          generationConfig: { temperature: 0.2 },
        }),
      },
    );
    if (!resp.ok) return localSynopsis(transcript);
    const data = await resp.json();
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text;
    return summary || localSynopsis(transcript);
  } catch (_) {
    return localSynopsis(transcript);
  }
}

module.exports = {
  createRecorder,
  writeWav,
  localSynopsis,
  geminiSynopsis,
  recordingsDir,
};
