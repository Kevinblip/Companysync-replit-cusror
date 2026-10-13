#!/usr/bin/env node
/**
 * Assemble per-segment MP4s from frames + audio, then concatenate into final video.
 * Uses FFmpeg Ken Burns (zoompan) effect, drawtext caption pills, fade in/out.
 * Build is IDEMPOTENT — skip clips that already exist.
 */
'use strict';

const fs            = require('fs');
const path          = require('path');
const { execSync }  = require('child_process');

const FRAMES_DIR   = path.join(__dirname, 'frames');
const AUDIO_DIR    = path.join(__dirname, 'audio');
const CLIPS_DIR    = path.join(__dirname, 'clips');
const FINAL_DIR    = path.join(__dirname, 'final');
const FONT         = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

fs.mkdirSync(CLIPS_DIR, { recursive: true });
fs.mkdirSync(FINAL_DIR, { recursive: true });

const SEGMENTS = [
  { id: '01-storm-tracking',        caption: 'Step 1 — Storm Tracking' },
  { id: '02-storm-card',            caption: 'Import Data or Jump to Lead Finder' },
  { id: '03-property-importer',     caption: 'Step 2 — Import County Records' },
  { id: '04-lead-finder-empty',     caption: 'Step 3 — Lead Finder' },
  { id: '05-lead-finder-results',   caption: 'Results Ranked by Storm Proximity' },
  { id: '06-api-keys-lead-data',    caption: 'Paid Option — BatchLeads & PropStream' },
  { id: '07-field-sales-tracker',   caption: 'Step 4 — Field Sales Tracker' },
];

const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;

function ffmpeg(args) {
  const cmd = `ffmpeg -y ${args} 2>&1`;
  console.log(`  $ ffmpeg ${args.slice(0, 120)}…`);
  try {
    const out = execSync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    return out.toString();
  } catch (e) {
    console.error('ffmpeg failed:', e.stdout?.toString().slice(-800) || e.message);
    throw e;
  }
}

// Get audio duration in seconds
function audioDuration(wavPath) {
  const out = execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${wavPath}"`).toString().trim();
  return parseFloat(out) || 8;
}

// Escape special chars for ffmpeg drawtext
function esc(s) { return s.replace(/[:'\\]/g, m => `\\${m}`); }

async function run() {
  const clipPaths = [];

  for (const seg of SEGMENTS) {
    if (ONLY && !ONLY.some(id => seg.id.startsWith(id))) continue;

    const frame = path.join(FRAMES_DIR, `${seg.id}.png`);
    const audio = path.join(AUDIO_DIR,  `${seg.id}.wav`);
    const clip  = path.join(CLIPS_DIR,  `${seg.id}.mp4`);

    if (!fs.existsSync(frame)) { console.warn(`[SKIP-NO-FRAME] ${seg.id}`); continue; }
    if (!fs.existsSync(audio)) { console.warn(`[SKIP-NO-AUDIO] ${seg.id}`); continue; }

    if (fs.existsSync(clip)) {
      console.log(`[SKIP] ${seg.id} clip already exists`);
      clipPaths.push(clip);
      continue;
    }

    const dur = audioDuration(audio);
    console.log(`[BUILD] ${seg.id}  (${dur.toFixed(1)}s)`);

    // Ken Burns: scale to 2× first, zoom slowly from 1.0 → 1.05 over duration
    const fps      = 30;
    const frames   = Math.ceil(dur * fps);
    const zoomEnd  = 1.05;
    const zInc     = (zoomEnd - 1.0) / frames;
    const zoompan  = `zoompan=z='min(zoom+${zInc.toFixed(6)},${zoomEnd})':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1920x1080:fps=${fps}`;

    // Caption pill (bottom, semi-transparent background)
    const capText  = esc(seg.caption);
    const caption  = `drawtext=fontfile='${FONT}':text='${capText}':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=h-90:box=1:boxcolor=black@0.55:boxborderw=18`;

    // Fade in/out
    const fadeDur = Math.min(0.5, dur * 0.12);
    const fadeOut = dur - fadeDur;
    const vfade = `fade=t=in:st=0:d=${fadeDur},fade=t=out:st=${fadeOut}:d=${fadeDur}`;
    const afade = `afade=t=in:st=0:d=${fadeDur},afade=t=out:st=${fadeOut}:d=${fadeDur}`;

    ffmpeg(
      `-loop 1 -t ${dur} -i "${frame}" -i "${audio}" ` +
      `-vf "scale=3840:2160,${zoompan},${caption},${vfade}" ` +
      `-af "${afade}" ` +
      `-c:v libx264 -preset fast -crf 22 -pix_fmt yuv420p ` +
      `-c:a aac -b:a 128k ` +
      `-t ${dur} ` +
      `"${clip}"`
    );
    console.log(`  → ${clip}`);
    clipPaths.push(clip);
  }

  if (!clipPaths.length) { console.log('No clips to concatenate.'); return; }

  // Concatenate
  const finalPath = path.join(FINAL_DIR, 'lead-finder-storm-training.mp4');
  const listFile  = path.join(CLIPS_DIR, 'concat.txt');
  fs.writeFileSync(listFile, clipPaths.map(p => `file '${p}'`).join('\n'));
  console.log(`\n[CONCAT] ${clipPaths.length} clips → ${finalPath}`);
  ffmpeg(`-f concat -safe 0 -i "${listFile}" -c copy "${finalPath}"`);
  console.log(`\n✅  Final video: ${finalPath}`);
}

run().catch(e => { console.error(e); process.exit(1); });
