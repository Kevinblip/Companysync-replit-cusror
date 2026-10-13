#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GOOGLE_GEMINI_API_KEY is required');
  process.exit(1);
}

const OUT = path.join(__dirname, 'audio-siding');
fs.mkdirSync(OUT, { recursive: true });

const scripts = [
  ['01', 'Open AI Estimator and confirm the property address before measuring. CompanySync keeps the customer, claim, measurement, and estimate work together so you can move from the exterior inspection to a priced scope without re-entering the job.'],
  ['02', 'In estimator settings, select Siding as one of your specialties. Set the normal story height, waste percentage, and opening assumptions for your company. These defaults speed up each job, and you can still adjust them for the property in front of you.'],
  ['03', 'Open Storm Tracking inside AI Estimator and confirm the property address. You can begin with automatic roof detection or manual roof tracing, while the dedicated siding workflow stays available directly below for the same property.'],
  ['04', 'Expand Measure Siding and Roof from House Photos. Photos Only mode provides guided slots for the front, back, sides, corners, garage, and detail images. Clear coverage gives the analyzer better wall, opening, material, and condition evidence.'],
  ['05', 'Choose Satellite when you need a fast exterior starting point without photos. CompanySync uses the property footprint with your story and opening settings, then presents the result for review before it creates any estimate line items.'],
  ['06', 'Choose Manual Entry when you already have tape-measure numbers. Enter the perimeter, stories, eave height, optional gable rise, building dimensions, openings, and corners. This path uses your measurements as the dimensional source instead of asking AI to estimate them.'],
  ['07', 'Review the completed measurement summary before pricing. CompanySync shows the net wall area, perimeter, wall height, gable area, deductions, and material assumptions. If anything is wrong, return to the form and correct it before rebuilding the estimate.'],
  ['08', 'Open View Report to create a branded exterior measurement report. The report documents the property, measurement source, wall quantities, openings, trim, and supporting details so your team has a consistent record to review or share.'],
  ['09', 'Build Siding Estimate converts the approved measurements into editable line items. Review quantities, materials, labor, accessories, waste, and the final total, then save or export only after the field measurements and job scope have been verified.'],
];

function pcmToWav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function tts(text) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Read this in a warm, upbeat, professional training voice: ${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        },
      }),
    },
  );
  if (!response.ok) throw new Error(`TTS ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const encoded = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!encoded) throw new Error('TTS response did not contain audio');
  return pcmToWav(Buffer.from(encoded, 'base64'));
}

async function main() {
  for (const [id, text] of scripts) {
    const out = path.join(OUT, `seg${id}.wav`);
    if (fs.existsSync(out) && fs.statSync(out).size > 10000) continue;
    console.log(`Generating Kore narration ${id}`);
    fs.writeFileSync(out, await tts(text));
  }
  console.log(`Narration ready in ${OUT}`);
}

main().catch((error) => {
  console.error('Siding narration failed:', error.message);
  process.exit(1);
});