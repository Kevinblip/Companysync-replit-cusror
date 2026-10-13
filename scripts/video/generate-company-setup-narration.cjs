#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GOOGLE_GEMINI_API_KEY is required');
  process.exit(1);
}

const OUT = path.join(__dirname, 'company-setup', 'audio');
fs.mkdirSync(OUT, { recursive: true });

const scripts = [
  ['part1-01', 'Start Company Setup with the information that makes CompanySync feel like your business. Confirm the company name, tagline, logo, industry, time zone, preferred language, website, email, phone, and address. The time zone is especially important because it controls appointment times, reminders, and scheduled automations. Next, choose your primary and secondary brand colors and upload the logo or AI avatar you want staff and customers to see.'],
  ['part1-02', 'Your preferred shingle brands are used by the measurement and estimating tools. Keep the brands your team actually sells, choose the normal product for each brand, and enter the bundles per square used by your supplier or estimator. You can reorder the list, uncheck a brand to hide it, or add a custom brand. Continue into Business Settings to set the default tax rate and the prefixes and starting numbers for invoices, estimates, and customers.'],
  ['part1-03', 'Company Setup also controls how customers book time with you. Customize the booking heading and confirmation message, then decide whether the public form shows email, message, and property-address fields. If an address is required, turn that on deliberately. Add the service types your team wants customers to choose from. Finish Part One by saving the company profile, then test the booking link as a customer so you can confirm the wording and required fields are right.'],
  ['part2-01', 'The PhotoSync assignment email is sent when an inspector receives a job. You can keep the branded default or customize the subject and body with merge fields such as property address, scheduled date, company name, and the crew link. Use the preview to see how real values will appear, then send a test email before saving. The goal is a message an inspector can understand without opening the CRM first.'],
  ['part2-02', 'The assignment SMS serves the same purpose when the field team needs a short message. Keep it concise because SMS is split into segments and longer messages cost more to deliver. The preview shows the real length and the merge-field substitutions. The resend reminder email and SMS are fallbacks for an inspector who needs the PhotoSync link again. Customize them only when your process needs different instructions, and use the test buttons before saving.'],
  ['part2-03', 'Customer-facing inspection confirmations are separate from inspector assignments. The email can include the scheduled date, property address, inspector name, and contact details inside your branded template. The SMS version should stay short and tell the homeowner what happens next. Company Setup also includes the homeowner photo-upload notifications. Those alerts go to the assigned project manager, or to the admin fallback, with a review link so photos are not missed.'],
  ['part3-01', 'Use the on-call escalation section for critical alert channels, not routine customer communication. PagerDuty routing keys, Opsgenie API keys, and the secondary webhook are stored as protected credentials. Only an authorized administrator should enter them. Save the credentials, then send a test alert and verify that the right on-call channel receives it. If a channel is not configured, CompanySync can still use the in-app and normal notification paths.'],
  ['part3-02', 'The voice command sheet lets you tailor the guided inspection experience. Add the phrases inspectors actually use for photos, sections, and counters, such as front slope, rear elevation, gutters, or another vent. These entries change the examples shown in the voice panel; they do not replace the full built-in command set. Keep phrases short, natural, and consistent across the team so inspectors do not have to remember different wording.'],
  ['part3-03', 'Default Notes and Disclaimers control the text that appears on new estimates, invoices, and proposals. Put your approved payment terms, warranty language, and scope reminders here, then review every document type before relying on the defaults. Quick Create Shortcuts controls the actions shown in the Quick Create menu and their order. Keep the most common actions at the top for staff, save the shortcut changes, and use Update Company Profile when the full setup is complete.'],
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
    const out = path.join(OUT, `seg-${id}.wav`);
    if (fs.existsSync(out)) continue;
    console.log(`Generating Kore narration ${id}`);
    fs.writeFileSync(out, await tts(text));
  }
  console.log(`Narration ready in ${OUT}`);
}

main().catch(error => {
  console.error('Company setup narration failed:', error.message);
  process.exit(1);
});