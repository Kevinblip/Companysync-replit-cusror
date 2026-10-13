#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GOOGLE_GEMINI_API_KEY is required');
  process.exit(1);
}

const OUT = path.join(__dirname, 'audio-quickbooks');
fs.mkdirSync(OUT, { recursive: true });

const scripts = [
  ['01', 'Start in Settings, then open the QuickBooks Online card. Select Connect QuickBooks to begin the secure Intuit authorization flow. Sign in with the QuickBooks account for this company and approve access. The connection belongs to this company, so each customer account should authorize its own QuickBooks organization.'],
  ['02', 'After authorization, confirm the green Connected status and read the company name carefully. This example is a sandbox, or test company. The warning is important: anything you sync here goes to the practice company, not your real books. If that is not what you want, disconnect and reconnect with the production QuickBooks company before sending live data.'],
  ['03', 'The counters show what CompanySync knows about the connection. Twelve of fifteen invoices and eight of ten payments are already in QuickBooks. The amber not yet synced numbers are the records still waiting for a push. These are counts, not errors, so use them to decide whether a catch-up sync is needed.'],
  ['04', 'Push to QuickBooks is the catch-up action for invoices and payments created in CompanySync. Use Sync Now only after checking whether those records already exist in QuickBooks. Sending a record that is already there can double your revenue or payment totals. New records will continue to sync automatically after they are saved.'],
  ['05', 'If historical payments were entered manually in QuickBooks, use Mark all as already in QB before you run a catch-up sync. This tells CompanySync not to create a second payment for the same money. It is a protection for migration history, not a replacement for matching each new payment normally.'],
  ['06', 'Expenses can move the other direction. Choose a date range, then use Import Now to pull QuickBooks expense transactions into CompanySync. Existing records are skipped automatically, so the import can complete without creating duplicates. Review the results, then find the imported items in Expenses.'],
  ['07', 'On the invoice list, the QuickBooks status gives you a quick read of each record. A linked invoice can open in QuickBooks; an unsynced invoice can be pushed by an administrator. This is the record-level view, while the Settings card is the best place to understand the connection as a whole.'],
  ['08', 'The chart of accounts can also be imported from QuickBooks. That brings your accounting categories into CompanySync so reports use the same structure your bookkeeper already recognizes. Imports bring data into the app; the invoice and payment sync pushes operational activity back to QuickBooks.'],
  ['09', 'The simple mental model is this: invoices and payments created here go to QuickBooks, while expenses and accounting categories can be imported from QuickBooks. The connection status, counters, and safeguards tell you what has happened. Once the initial history is reconciled, new records sync automatically within seconds.'],
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
    if (fs.existsSync(out)) continue;
    console.log(`Generating Kore narration ${id}`);
    fs.writeFileSync(out, await tts(text));
  }
  console.log(`Narration ready in ${OUT}`);
}

main().catch((error) => {
  console.error('QuickBooks narration failed:', error.message);
  process.exit(1);
});