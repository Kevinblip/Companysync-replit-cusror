#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!API_KEY) throw new Error('GOOGLE_GEMINI_API_KEY is required');
const OUT = path.join(__dirname, 'audio-photosync');
fs.mkdirSync(OUT, { recursive: true });

const scripts = [
  ['01', 'PhotoSync gives your field team one place to document an inspection. The dashboard shows active jobs, completed inspections, and the total photo evidence attached to the work.'],
  ['02', 'Open a job to see the property record, inspection status, assigned inspector, and the photo count. Every image stays connected to the job instead of getting lost in a camera roll or text thread.'],
  ['03', 'The capture workspace organizes the inspection by roof section and gives the crew a fast way to add photos from the field. Use clear section names and captions so the final report is easy for an adjuster to follow.'],
  ['04', 'Each photo card keeps the original image, its section, and its caption together. PhotoSync also shows the AI result directly on the card, including severity, coverage verdict, and the damage counts found in that frame.'],
  ['05', 'Open any photo to review or correct the analysis. You can edit the caption and damage details, keep the original evidence, and make sure the final notes match what the inspector actually saw.'],
  ['06', 'The report workspace turns the evidence into a scope of work. Add notes, use AI Generate to draft repair language from the photos, and keep the inspection record ready for estimating and carrier review.'],
  ['07', 'Share selected photos directly with a production manager, homeowner, or adjuster. The message includes the photo labels and AI notes, so the recipient gets useful evidence without a separate download-and-attach step.'],
  ['08', 'Before sending, review the complete photo set by section. Download the evidence, keep the notes with the job, and use the report controls when the inspection is ready for a formal PDF.'],
  ['09', 'Generate the branded damage report with the property details, annotated evidence, AI summary, and recommended scope. PhotoSync turns a field inspection into documentation your office and the adjuster can use.'],
];

function pcmToWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function tts(text) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Read this in a warm, clear, professional training voice: ${text}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
    }),
  });
  if (!response.ok) throw new Error(`TTS ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const encoded = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!encoded) throw new Error('TTS response did not contain audio');
  return pcmToWav(Buffer.from(encoded, 'base64'));
}

(async () => {
  for (const [id, text] of scripts) {
    const out = path.join(OUT, `seg${id}.wav`);
    console.log(`Generating PhotoSync narration ${id}`);
    fs.writeFileSync(out, await tts(text));
  }
  console.log(`Narration ready in ${OUT}`);
})().catch((error) => { console.error('PhotoSync narration failed:', error); process.exit(1); });