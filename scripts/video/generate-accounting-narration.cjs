#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GOOGLE_GEMINI_API_KEY is required');
  process.exit(1);
}

const OUT = path.join(__dirname, 'audio-accounting');
fs.mkdirSync(OUT, { recursive: true });

const scripts = [
  ['01', 'Start in Accounting for a quick view of income, expenses, net profit, and margin. The overview gives you the financial pulse of the business before you open a detailed ledger or report.'],
  ['02', 'Use Accounting Setup to establish the foundation once. Create your chart of accounts, connect the bank accounts you want to track, and review the sync options for payments, expenses, and payouts.'],
  ['03', 'The Chart of Accounts is where you organize the categories behind every report. Search or filter by account type, import from QuickBooks when available, and add accounts for assets, liabilities, revenue, or expenses.'],
  ['04', 'In Expenses, record day-to-day purchases and keep your deductible costs organized. Review totals, search by vendor, filter by category, and open a transaction when you need to edit or remove it.'],
  ['05', 'To add an expense, choose a vendor, enter the amount and date, select the category, and mark whether it is tax deductible. Add a project or receipt reference when you want the cost tied back to a job.'],
  ['06', 'Bills and Payables keeps vendor and subcontractor invoices in one place. Review what is unpaid, when it is due, and which bills have already been paid so nothing slips through the cracks.'],
  ['07', 'Select Add Bill to upload an invoice or enter it manually. CompanySync can scan a PDF or image to suggest the vendor, amount, invoice number, and due date. Confirm the details, then save the bill for payment tracking.'],
  ['08', 'When a bank account is connected, Bank Reconciliation compares the statement balance with transactions in CompanySync. Choose the account, enter the statement date and ending balance, auto-match cleared items, and finish only when the difference reaches zero.'],
  ['09', 'Accounting Reports turns those entries into financial statements. Choose a period to review the balance sheet, profit and loss, trial balance, and accounts receivable views, then export the report for your accountant or leadership team.'],
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
  console.error('Accounting narration failed:', error.message);
  process.exit(1);
});