#!/usr/bin/env node
/**
 * CompanySync — 15 Marketing Video Generator
 * Usage:
 *   BATCH=1 node scripts/generate-marketing-videos.cjs   # videos 01-05
 *   BATCH=2 node scripts/generate-marketing-videos.cjs   # videos 06-10
 *   BATCH=3 node scripts/generate-marketing-videos.cjs   # videos 11-15
 *   VIDEOS=01,03 node scripts/generate-marketing-videos.cjs
 */
'use strict';
const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const https = require('https');

const CONFIGS  = require('./marketing-video-configs.cjs');
const FONT_B   = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FONT_R   = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const TMP      = path.join(__dirname, 'mv-tmp');
const OUT      = path.join(__dirname, '..', 'public', 'generated_marketing_videos');
const GEMINI_KEY = process.env.GOOGLE_GEMINI_API_KEY;

// ── Force-rebuild flag (--force clears existing outputs so they're regenerated) ─
const FORCE = process.argv.includes('--force');

// ── Batch selection ────────────────────────────────────────────────────────
const BATCH = process.env.BATCH;
const ONLY  = process.env.VIDEOS;
let configs;
if (ONLY) {
  const ids = ONLY.split(',').map(s => s.trim().padStart(2, '0'));
  configs = CONFIGS.filter(c => ids.includes(c.id));
} else if (BATCH === '1') { configs = CONFIGS.slice(0, 5);
} else if (BATCH === '2') { configs = CONFIGS.slice(5, 10);
} else if (BATCH === '3') { configs = CONFIGS.slice(10, 15);
} else { configs = CONFIGS; }

fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(OUT,  { recursive: true });

// When --force is passed, delete existing outputs for the selected configs
// so the idempotency skip is bypassed and they are fully rebuilt.
if (FORCE) {
  for (const cfg of configs) {
    const out = path.join(OUT, `video-${cfg.id}.mp4`);
    if (fs.existsSync(out)) { fs.rmSync(out); }
    // Also clear tmp frames/segments so nothing stale is reused
    for (const prefix of [`hook_${cfg.id}`, `sol_${cfg.id}`, `cta_${cfg.id}`,
                           `h1_${cfg.id}`, `h2_${cfg.id}`, `hs_${cfg.id}`,
                           `sf_${cfg.id}`, `sfr_${cfg.id}`, `st_${cfg.id}`, `str_${cfg.id}`,
                           `sl_${cfg.id}`, `slr_${cfg.id}`,
                           `b1_${cfg.id}`, `b2_${cfg.id}`, `b3_${cfg.id}`,
                           `c1_${cfg.id}`, `c2_${cfg.id}`,
                           `audio_${cfg.id}`, `audio_cta_${cfg.id}`]) {
      for (const ext of ['.png', '.mp4', '.wav', '.txt']) {
        const p = path.join(TMP, prefix + ext);
        if (fs.existsSync(p)) fs.rmSync(p);
      }
    }
  }
  console.log(`  🗑  --force: cleared ${configs.length} video(s) for rebuild\n`);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function writeText(name, text) {
  const p = path.join(TMP, name);
  // Escape % → %% (FFmpeg treats % as strftime format token)
  const safe = String(text)
    .replace(/'/g, '\u2019')   // curly apostrophe – avoids shell quoting confusion
    .replace(/%/g, '%%');
  fs.writeFileSync(p, safe, 'utf8');
  return p;
}

// Raw variant for drawtext with expansion=none — no %-doubling (which drawtext
// would otherwise render literally / choke on as "stray %").
function writeTextRaw(name, text) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, String(text).replace(/'/g, '\u2019'), 'utf8');
  return p;
}

function run(args, timeout = 110000) {
  const cmd = ['ffmpeg', '-y', ...args].join(' ');
  execSync(cmd, { stdio: 'pipe', timeout });
}

function pcmToWav(pcmBuf, sr = 24000, ch = 1, bd = 16) {
  const data = Buffer.isBuffer(pcmBuf) ? pcmBuf : Buffer.from(pcmBuf, 'base64');
  const hdr  = Buffer.alloc(44);
  hdr.write('RIFF',  0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8);
  hdr.write('fmt ',  12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20);
  hdr.writeUInt16LE(ch, 22); hdr.writeUInt32LE(sr, 24);
  hdr.writeUInt32LE(sr * ch * (bd / 8), 28); hdr.writeUInt16LE(ch * (bd / 8), 32);
  hdr.writeUInt16LE(bd, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40);
  return Buffer.concat([hdr, data]);
}

async function makeTTS(text, outWav) {
  if (!GEMINI_KEY) return null;
  if (fs.existsSync(outWav) && fs.statSync(outWav).size > 500) return outWav;
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `Read in a warm, confident, energetic voice for a sales video: ${text}` }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
    },
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString());
          const part = json?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('audio/'));
          if (!part) { resolve(null); return; }
          fs.writeFileSync(outWav, pcmToWav(Buffer.from(part.inlineData.data, 'base64')));
          resolve(outWav);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

// Dynamic font size: cap so text fits within 1080px frame width
// DejaVu Bold uppercase: avg ~0.72× font-size per char
function hookFontSize(text) {
  return Math.min(92, Math.max(52, Math.floor(1020 / (text.length * 0.72))));
}
// Mixed/lower-case: avg ~0.60× font-size per char
function fitFontSize(text, maxPx, availableW = 1020) {
  return Math.min(maxPx, Math.max(28, Math.floor(availableW / (text.length * 0.60))));
}

// ── Frame PNG builders — no @alpha, no h* in drawbox y ────────────────────
function hookPng(cfg, out) {
  if (fs.existsSync(out)) return;
  const l1 = writeText(`h1_${cfg.id}.txt`, cfg.hookLine1);
  const l2 = writeText(`h2_${cfg.id}.txt`, cfg.hookLine2);
  const sb = writeText(`hs_${cfg.id}.txt`, cfg.hookSub);
  const fs1 = hookFontSize(cfg.hookLine1);
  const fs2 = hookFontSize(cfg.hookLine2);
  const lineH = Math.max(fs1, fs2) + 14;

  const vf = [
    `drawbox=x=0:y=0:w=iw:h=ih:color=0x080C1A:t=fill`,
    // top accent bar
    `drawbox=x=0:y=0:w=iw:h=14:color=0xFFAA00:t=fill`,
    // bottom accent bar
    `drawbox=x=0:y=1906:w=iw:h=14:color=0xFFAA00:t=fill`,
    // CompanySync wordmark
    `drawtext=fontfile='${FONT_B}':text='CompanySync':x=60:y=68:fontsize=44:fontcolor=white`,
    // hook line 1
    `drawtext=fontfile='${FONT_B}':textfile='${l1}':x=(w-text_w)/2:y=500:fontsize=${fs1}:fontcolor=0xFFD700:shadowx=4:shadowy=4`,
    // hook line 2
    `drawtext=fontfile='${FONT_B}':textfile='${l2}':x=(w-text_w)/2:y=${500 + lineH}:fontsize=${fs2}:fontcolor=0xFFD700:shadowx=4:shadowy=4`,
    // horizontal rule
    `drawbox=x=80:y=${500 + lineH * 2 + 40}:w=920:h=4:color=0x445566:t=fill`,
    // sub-hook
    `drawtext=fontfile='${FONT_R}':textfile='${sb}':x=(w-text_w)/2:y=${500 + lineH * 2 + 80}:fontsize=44:fontcolor=0xAABBCC`,
  ].join(',');

  run(['-f','lavfi','-i','color=c=black:s=1080x1920:r=30',
       '-vf', `"${vf}"`, '-vframes','1','-update','1', out]);
}

const SHOTS = path.join(__dirname, 'mv-shots');

// Solution frame built from a REAL live-app screenshot (captured by mv-capture.cjs).
// Screenshot is scaled to 1080 wide, top-cropped/letterboxed to 1080x1920, with
// branded bands overlaid: accent header + feature name on top, stat + URL on bottom.
function solutionShotPng(cfg, shot, out) {
  if (fs.existsSync(out)) return;
  const acc = cfg.accentColor.replace('#','0x');
  const sf  = writeTextRaw(`sfr_${cfg.id}.txt`, cfg.feature);
  const st  = writeTextRaw(`str_${cfg.id}.txt`, cfg.stat);
  const sl  = writeTextRaw(`slr_${cfg.id}.txt`, cfg.statLabel);
  const featFs = fitFontSize(cfg.feature, 46);

  const vf = [
    // optional: keep only the top fraction of the shot (e.g. camera pages whose
    // viewfinder renders black in headless capture)
    ...(cfg.shotCrop ? [`crop=iw:'ih*${cfg.shotCrop}':0:0`] : []),
    // fit screenshot: 1080 wide, keep top of page, letterbox if short
    `scale=1080:-2`,
    `crop=1080:'min(ih,1920)':0:0`,
    `pad=1080:1920:(ow-iw)/2:'max(0,(oh-ih)/2)':color=0x080C18`,
    // header bar
    `drawbox=x=0:y=0:w=iw:h=140:color=${acc}:t=fill`,
    `drawtext=fontfile='${FONT_B}':text='CompanySync':x=50:y=46:fontsize=46:fontcolor=white`,
    `drawtext=fontfile='${FONT_B}':text='SOLUTION':x=760:y=54:fontsize=32:fontcolor=white`,
    // feature-name strip under header
    `drawbox=x=0:y=140:w=iw:h=96:color=0x080C18:t=fill`,
    `drawtext=fontfile='${FONT_B}':expansion=none:textfile='${sf}':x=(w-text_w)/2:y=${168 - Math.floor((featFs - 40) / 2)}:fontsize=${featFs}:fontcolor=0xFFD700:shadowx=2:shadowy=2`,
    // bottom band: stat + label + URL
    `drawbox=x=0:y=1600:w=iw:h=320:color=0x080C18:t=fill`,
    `drawbox=x=0:y=1600:w=iw:h=6:color=${acc}:t=fill`,
    `drawtext=fontfile='${FONT_B}':expansion=none:textfile='${st}':x=(w-text_w)/2:y=1630:fontsize=120:fontcolor=${acc}:shadowx=4:shadowy=4`,
    `drawtext=fontfile='${FONT_B}':expansion=none:textfile='${sl}':x=(w-text_w)/2:y=1768:fontsize=${fitFontSize(cfg.statLabel, 42)}:fontcolor=white`,
    `drawtext=fontfile='${FONT_B}':text='companysync.io':x=(w-text_w)/2:y=1846:fontsize=38:fontcolor=0xFFD700`,
    `drawbox=x=0:y=1906:w=iw:h=14:color=${acc}:t=fill`,
  ].join(',');

  run(['-i', `"${shot}"`, '-vf', `"${vf}"`, '-vframes','1','-update','1', out]);
}

function solutionPng(cfg, out) {
  if (fs.existsSync(out)) return;
  // Prefer a real live-app screenshot when mv-capture.cjs has produced one
  const shot = path.join(SHOTS, `${cfg.id}.png`);
  if (fs.existsSync(shot) && fs.statSync(shot).size > 20000) {
    return solutionShotPng(cfg, shot, out);
  }
  const acc = cfg.accentColor.replace('#','0x');
  const sf  = writeText(`sf_${cfg.id}.txt`, cfg.feature);
  const b1  = writeText(`b1_${cfg.id}.txt`, '>>  ' + cfg.featureBullet1);
  const b2  = writeText(`b2_${cfg.id}.txt`, '>>  ' + cfg.featureBullet2);
  const b3  = writeText(`b3_${cfg.id}.txt`, '>>  ' + cfg.featureBullet3);
  const st  = writeText(`st_${cfg.id}.txt`, cfg.stat);
  const sl  = writeText(`sl_${cfg.id}.txt`, cfg.statLabel);

  // fit feature name and bullet text to frame width
  const featFs = fitFontSize(cfg.feature, 46);
  // bullets have x=60 start; available = 1020px
  const bFs    = Math.min(40, Math.floor(1020 / ((cfg.featureBullet1.length + 5) * 0.58)));

  const vf = [
    `drawbox=x=0:y=0:w=iw:h=ih:color=0x080C18:t=fill`,
    // header bar
    `drawbox=x=0:y=0:w=iw:h=140:color=${acc}:t=fill`,
    // CompanySync in header
    `drawtext=fontfile='${FONT_B}':text='CompanySync':x=50:y=46:fontsize=46:fontcolor=white`,
    // SOLUTION badge in header right
    `drawtext=fontfile='${FONT_B}':text='SOLUTION':x=760:y=54:fontsize=32:fontcolor=white`,
    // big stat number
    `drawtext=fontfile='${FONT_B}':textfile='${st}':x=(w-text_w)/2:y=200:fontsize=210:fontcolor=${acc}:shadowx=6:shadowy=6`,
    // stat label
    `drawtext=fontfile='${FONT_B}':textfile='${sl}':x=(w-text_w)/2:y=455:fontsize=${fitFontSize(cfg.statLabel, 44)}:fontcolor=white`,
    // separator line
    `drawbox=x=80:y=545:w=920:h=3:color=${acc}:t=fill`,
    // feature name
    `drawtext=fontfile='${FONT_B}':textfile='${sf}':x=(w-text_w)/2:y=580:fontsize=${featFs}:fontcolor=0xFFD700:shadowx=2:shadowy=2`,
    // bullet divider 1
    `drawbox=x=80:y=${580+featFs+30}:w=920:h=1:color=0x334466:t=fill`,
    // bullet 1
    `drawtext=fontfile='${FONT_R}':textfile='${b1}':x=60:y=${580+featFs+40}:fontsize=${bFs}:fontcolor=0xDDEEFF`,
    // bullet divider 2
    `drawbox=x=80:y=${580+featFs+40+bFs+25}:w=920:h=1:color=0x334466:t=fill`,
    // bullet 2
    `drawtext=fontfile='${FONT_R}':textfile='${b2}':x=60:y=${580+featFs+40+bFs+35}:fontsize=${bFs}:fontcolor=0xDDEEFF`,
    // bullet divider 3
    `drawbox=x=80:y=${580+featFs+40+bFs*2+60}:w=920:h=1:color=0x334466:t=fill`,
    // bullet 3
    `drawtext=fontfile='${FONT_R}':textfile='${b3}':x=60:y=${580+featFs+40+bFs*2+70}:fontsize=${bFs}:fontcolor=0xDDEEFF`,
    // bottom bar
    `drawbox=x=0:y=1906:w=iw:h=14:color=${acc}:t=fill`,
    // URL watermark
    `drawtext=fontfile='${FONT_B}':text='companysync.io':x=(w-text_w)/2:y=1840:fontsize=40:fontcolor=0xFFD700`,
  ].join(',');

  run(['-f','lavfi','-i','color=c=black:s=1080x1920:r=30',
       '-vf', `"${vf}"`, '-vframes','1','-update','1', out]);
}

function ctaPng(cfg, out) {
  if (fs.existsSync(out)) return;
  const acc  = cfg.accentColor.replace('#','0x');
  const cta1 = writeText(`c1_${cfg.id}.txt`, cfg.ctaLine1);
  const cta2 = writeText(`c2_${cfg.id}.txt`, cfg.ctaLine2);

  const cta1Fs = fitFontSize(cfg.ctaLine1, 52, 960);
  const cta2Fs = fitFontSize(cfg.ctaLine2, 46, 960);

  const vf = [
    // Dark navy background
    `drawbox=x=0:y=0:w=iw:h=ih:color=0x03070F:t=fill`,
    // Full-width accent bar at top
    `drawbox=x=0:y=0:w=iw:h=18:color=${acc}:t=fill`,
    // Full-width accent bar at bottom
    `drawbox=x=0:y=1902:w=iw:h=18:color=${acc}:t=fill`,
    // "FREE TRIAL" badge background (bright accent band)
    `drawbox=x=0:y=320:w=iw:h=110:color=${acc}:t=fill`,
    // "FREE TRIAL" badge text
    `drawtext=fontfile='${FONT_B}':text='FREE 14-DAY TRIAL':x=(w-text_w)/2:y=350:fontsize=66:fontcolor=white`,
    // Brand name — huge
    `drawtext=fontfile='${FONT_B}':text='CompanySync':x=(w-text_w)/2:y=500:fontsize=116:fontcolor=white:shadowx=6:shadowy=6`,
    // Tagline
    `drawtext=fontfile='${FONT_R}':text='The All-In-One Roofing Platform':x=(w-text_w)/2:y=644:fontsize=38:fontcolor=0xAABBCC`,
    // Separator
    `drawbox=x=80:y=720:w=920:h=3:color=${acc}:t=fill`,
    // CTA line 1 — the selling line
    `drawtext=fontfile='${FONT_B}':textfile='${cta1}':x=(w-text_w)/2:y=750:fontsize=${cta1Fs}:fontcolor=0xFFD700:shadowx=2:shadowy=2`,
    // CTA line 2 — the action line
    `drawtext=fontfile='${FONT_B}':textfile='${cta2}':x=(w-text_w)/2:y=${750+cta1Fs+24}:fontsize=${cta2Fs}:fontcolor=white`,
    // Big button block
    `drawbox=x=60:y=1020:w=960:h=150:color=${acc}:t=fill`,
    // Button text line 1
    `drawtext=fontfile='${FONT_B}':text='START FREE — NO CREDIT CARD':x=(w-text_w)/2:y=1052:fontsize=48:fontcolor=white`,
    // URL — largest, gold, unmissable
    `drawtext=fontfile='${FONT_B}':text='companysync.io':x=(w-text_w)/2:y=1240:fontsize=88:fontcolor=0xFFD700:shadowx=4:shadowy=4`,
    // URL underline
    `drawbox=x=180:y=1350:w=720:h=5:color=0xFFD700:t=fill`,
    // "No credit card required" reassurance
    `drawtext=fontfile='${FONT_R}':text='No credit card required  •  Cancel anytime':x=(w-text_w)/2:y=1410:fontsize=36:fontcolor=0x778899`,
  ].join(',');

  run(['-f','lavfi','-i','color=c=black:s=1080x1920:r=30',
       '-vf', `"${vf}"`, '-vframes','1','-update','1', out]);
}

// ── Segment video builders ─────────────────────────────────────────────────
// All segments must share the same audio format so concat works.
// Gemini TTS outputs 24000 Hz mono L16 → wrapped WAV → AAC 128k mono 24kHz.
// Hook and CTA use identical-format silence.
const SILENT_AUDIO = 'aevalsrc=0:channel_layout=mono:sample_rate=24000';

function hookVideo(png, mp4) {
  if (exists(mp4)) return;
  run([
    '-loop','1','-framerate','30','-i', png,
    '-f','lavfi','-i', SILENT_AUDIO,
    '-vf', '"scale=2160:3840,zoompan=z=\'min(zoom+0.0012\\,1.08)\':x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':d=90:s=1080x1920:fps=30,fade=t=in:st=0:d=0.4"',
    '-t','3','-c:v','libx264','-preset','ultrafast','-crf','24',
    '-c:a','aac','-b:a','128k','-pix_fmt','yuv420p', mp4,
  ]);
}

function solutionVideo(png, wav, mp4) {
  if (exists(mp4)) return;
  const dur = 14;
  const vf  = `"scale=2160:3840,zoompan=z='min(zoom+0.0005\\,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${dur*30}:s=1080x1920:fps=30,fade=t=in:st=0:d=0.4,fade=t=out:st=${dur-0.5}:d=0.5"`;
  const hasWav = wav && fs.existsSync(wav);
  // Always include an audio track so concat never has stream-count mismatches.
  // If TTS succeeded, use it; otherwise lay a silent mono/24kHz track.
  const audioArgs = hasWav
    ? ['-i', wav,
       '-af', `"afade=t=in:st=0:d=0.5,afade=t=out:st=${dur-0.9}:d=0.9"`]
    : ['-f','lavfi','-i', SILENT_AUDIO];
  run([
    '-loop','1','-framerate','30','-i', png,
    ...audioArgs,
    '-vf', vf,
    '-t', String(dur), '-c:v','libx264','-preset','ultrafast','-crf','24',
    '-c:a','aac','-b:a','128k','-shortest','-pix_fmt','yuv420p', mp4,
  ]);
}

function ctaVideo(png, wav, mp4) {
  if (exists(mp4)) return;
  const dur = 9; // extra second — URL stays readable, no fade-to-black
  const frames = dur * 30;
  const hasWav = wav && fs.existsSync(wav);
  // No fade-out on video or audio: freeze on the URL card as the final frame.
  // A tiny 0.05s audio fade-out prevents a hard click without burying the CTA.
  const audioArgs = hasWav
    ? ['-i', wav, '-af', `"afade=t=in:st=0:d=0.3,afade=t=out:st=${dur-0.1}:d=0.1"`]
    : ['-f','lavfi','-i', SILENT_AUDIO];
  run([
    '-loop','1','-framerate','30','-i', png,
    ...audioArgs,
    '-vf', `"scale=2160:3840,zoompan=z='min(zoom+0.0006\\,1.04)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,fade=t=in:st=0:d=0.4"`,
    '-t', String(dur), '-c:v','libx264','-preset','ultrafast','-crf','24',
    '-c:a','aac','-b:a','128k','-shortest','-pix_fmt','yuv420p', mp4,
  ]);
}

function concat(hookMp4, solMp4, ctaMp4, final) {
  const lst = path.join(TMP, `lst_${path.basename(final, '.mp4')}.txt`);
  fs.writeFileSync(lst, `file '${hookMp4}'\nfile '${solMp4}'\nfile '${ctaMp4}'\n`);
  run(['-f','concat','-safe','0','-i', lst,
    '-c:v','libx264','-preset','fast','-crf','22',
    '-c:a','aac','-b:a','128k','-pix_fmt','yuv420p','-movflags','+faststart', final,
  ]);
}

function exists(p) { return fs.existsSync(p) && fs.statSync(p).size > 2000; }

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🎬  CompanySync Marketing Videos — ${configs.length} video(s): ${configs.map(c=>c.id).join(', ')}\n`);
  const results = [];

  for (const cfg of configs) {
    const t0  = Date.now();
    const out = path.join(OUT, `video-${cfg.id}.mp4`);
    if (exists(out)) {
      console.log(`  ⏭  video-${cfg.id}.mp4  skipped (exists)`);
      results.push({ id: cfg.id, ok: true, skipped: true });
      continue;
    }
    console.log(`  🔧  [${cfg.id}] ${cfg.feature.slice(0, 55)}`);
    try {
      const hP  = path.join(TMP, `hook_${cfg.id}.png`);
      const sP  = path.join(TMP, `sol_${cfg.id}.png`);
      const cP  = path.join(TMP, `cta_${cfg.id}.png`);
      process.stdout.write('     frames...');
      hookPng(cfg, hP); solutionPng(cfg, sP); ctaPng(cfg, cP);
      console.log(' ✓');

      const wavPath    = path.join(TMP, `audio_${cfg.id}.wav`);
      const ctaWavPath = path.join(TMP, `audio_cta_${cfg.id}.wav`);
      process.stdout.write('     tts...');
      const [got, gotCta] = await Promise.all([
        makeTTS(cfg.voiceover,    wavPath),
        makeTTS(cfg.ctaVoiceover, ctaWavPath),
      ]);
      console.log(got ? ` sol✓${gotCta ? ' cta✓' : ' cta-'}` : ' (skipped)');

      const hV = path.join(TMP, `hook_${cfg.id}.mp4`);
      const sV = path.join(TMP, `sol_${cfg.id}.mp4`);
      const cV = path.join(TMP, `cta_${cfg.id}.mp4`);
      process.stdout.write('     segments...');
      hookVideo(hP, hV); solutionVideo(sP, got, sV); ctaVideo(cP, gotCta, cV);
      console.log(' ✓');

      process.stdout.write('     concat...');
      concat(hV, sV, cV, out);
      console.log(' ✓');

      // Post-build validation: confirm video+audio streams are present
      const probe = execSync(
        `ffprobe -v error -show_streams -select_streams a -of default=nw=1 "${out}"`,
        { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
      ).trim();
      if (!probe) throw new Error('Output MP4 has NO audio stream — generation failed');

      const sz = (fs.statSync(out).size / 1048576).toFixed(1);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`     ✅  video-${cfg.id}.mp4  ${sz} MB  ${dt}s\n`);
      results.push({ id: cfg.id, ok: true, sz, dt });
    } catch (e) {
      console.error(`     ❌  video-${cfg.id} FAILED: ${e.message?.slice(0,120)}\n`);
      results.push({ id: cfg.id, ok: false, err: e.message?.slice(0,80) });
    }
  }

  const ok = results.filter(r => r.ok && !r.skipped).length;
  const sk = results.filter(r => r.skipped).length;
  const fl = results.filter(r => !r.ok).length;
  console.log(`\n  Done: ${ok} built  ${sk} skipped  ${fl} failed`);
  if (fl) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
