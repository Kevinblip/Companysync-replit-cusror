#!/usr/bin/env node
/**
 * Generate TTS narration for each video segment using Gemini 2.5 Flash TTS.
 * Outputs .wav files (PCM L16 24kHz mono wrapped in a 44-byte WAV header).
 */
'use strict';

const fs   = require('fs');
const path = require('path');

const API_KEY  = process.env.GOOGLE_GEMINI_API_KEY;
if (!API_KEY) { console.error('GOOGLE_GEMINI_API_KEY not set'); process.exit(1); }

const OUT_DIR = path.join(__dirname, 'audio');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Wrap raw L16 PCM (24000 Hz, mono, 16-bit LE) in a standard WAV container
function pcmToWav(pcmBuffer) {
  const numChannels  = 1;
  const sampleRate   = 24000;
  const bitsPerSample = 16;
  const byteRate     = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign   = numChannels * bitsPerSample / 8;
  const dataSize     = pcmBuffer.length;
  const header       = Buffer.allocUnsafe(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);               // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

const SCRIPTS = [
  {
    id: '01-storm-tracking',
    text: `Read this in a warm, upbeat, professional training voice: Welcome. This is Storm Tracking — your real-time severe weather command center, powered by NOAA. When storms are active in your service area, a red alert banner appears right at the top, showing each advisory and its expiration time. Below that, the built-in six-step guide walks you through the entire free workflow: note the affected ZIP codes, visit your county auditor's website, filter by ZIP, download a CSV of property owner records, import them here, and optionally add phone numbers through skip tracing. The search history dropdown lets you look back up to one full year, and the nationwide toggle gives you a country-wide storm view.`,
  },
  {
    id: '02-storm-card',
    text: `Read this in a warm, upbeat, professional training voice: When you find a storm in your territory, click the blue "Addresses" button on the card. The system pulls every mapped property address inside that storm zone straight from OpenStreetMap — no county website needed. You can filter by city boundary or pick a one- to ten-mile radius. Once the list loads, hit "Save Canvass List" and those addresses are saved as a named door-knocking list for your reps. No owner names are required at this stage — your reps will collect names at the door. When a homeowner engages, the rep creates a real CRM lead on the spot. That keeps your pipeline clean with only people who have actually shown interest.`,
  },
  {
    id: '03-property-importer',
    text: `Read this in a warm, upbeat, professional training voice: When you want owner names before knocking — not just addresses — use the Property Data Importer. Download a free CSV from your county auditor's website, upload it here, and hit Import. The system automatically maps columns like "Deeded Owner" and "Address", skips duplicates, and saves everything as a named Prospect List. These records do not go into your CRM pipeline — they sit in a holding area until a rep is actually ready to contact someone. Open Lead Finder, search the area, and the prospects appear with their storm scores and an "Add" button. Click Add only when you want that person in your active CRM. That keeps your pipeline clean — only real contacts who you've reached out to, not hundreds of county records you may never call.`,
  },
  {
    id: '04-lead-finder-empty',
    text: `Read this in a warm, upbeat, professional training voice: Step three is the Lead Finder. Enter any city name or ZIP code, choose a search radius, and hit Find Leads. The system searches all of your imported property records and ranks them by storm proximity — the addresses closest to verified hail or wind events float to the top. Every result shows the nearest storm's severity, distance, and date so your reps know exactly what to say when they knock the door.`,
  },
  {
    id: '05-lead-finder-results',
    text: `Read this in a warm, upbeat, professional training voice: Here are your results for Bedford, Ohio — 180 property owner records from a county import. Each card shows the owner's name and street address. The "Imported" badge tells you these came from county public data. For records you have already added to your CRM, a green "In CRM" badge appears instead of the Add button, so you never create duplicates. When a verified storm has hit near a property, that address gets a storm score from zero to one hundred and floats to the top automatically. The closer and more recent the storm, the higher the score — so your reps always knock the highest-priority storm-damaged doors first, without any manual sorting.`,
  },
  {
    id: '06-api-keys-lead-data',
    text: `Read this in a warm, upbeat, professional training voice: For even more power, there's the paid option. In API Keys Settings, scroll to the Lead Data Sources section. Here you can connect BatchLeads or PropStream — two professional property data services that provide live owner records, phone numbers, and skip-traced contacts with no CSV required. Just paste in your API key, hit Save, and the Lead Finder will automatically pull live results from that source alongside your imported data. Your key is encrypted and stored securely. A "Connected" badge appears once it's active.`,
  },
  {
    id: '07-field-sales-tracker',
    text: `Read this in a warm, upbeat, professional training voice: The last piece is the Field Sales Tracker. As your reps work through their canvass list, you see their activity here in real time — every knock, every "not home", and every appointment set, pinned to the map as it happens. When a homeowner opens the door and wants a quote, the rep enters their name and phone right there. That creates an actual CRM lead, so your pipeline stays clean — only real prospects, no anonymous filler. Managers can verify reps are staying inside their assigned territory and measure conversion rates across the team. That is the complete storm-to-signed-job workflow: spot the storm, save the canvass list, knock the doors, import owner data when you want more intel, and close the job.`,
  },
];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

async function tts(text) {
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      },
    }),
  });
  if (!resp.ok) throw new Error(`TTS ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const b64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!b64) throw new Error('No audio in response: ' + JSON.stringify(data).slice(0, 300));
  return Buffer.from(b64, 'base64');
}

async function run() {
  for (const seg of SCRIPTS) {
    if (ONLY && !ONLY.some(id => seg.id.startsWith(id))) continue;
    const outFile = path.join(OUT_DIR, `${seg.id}.wav`);
    if (fs.existsSync(outFile)) { console.log(`[SKIP] ${seg.id}`); continue; }
    console.log(`[TTS] ${seg.id} …`);
    const pcm = await tts(seg.text);
    const wav = pcmToWav(pcm);
    fs.writeFileSync(outFile, wav);
    console.log(`  → ${outFile} (${wav.length} bytes)`);
  }
  console.log('\n[DONE] Narration complete. Audio in', OUT_DIR);
}

run().catch(e => { console.error(e); process.exit(1); });
