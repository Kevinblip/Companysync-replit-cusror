#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const FRAMES = path.join(ROOT, 'company-setup', 'frames');
const AUDIO = path.join(ROOT, 'company-setup', 'audio');
const CLIPS = path.join(ROOT, 'company-setup', 'clips');
const PUBLIC = path.join(__dirname, '..', '..', 'public', 'videos');
const ATTACHED = path.join(__dirname, '..', '..', 'attached_assets', 'generated_videos');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 1920;
const H = 1080;
const FPS = 30;
const SOURCE_CROP_X = 314;
const SOURCE_CROP_W = 1360;
const SOURCE_CROP_H = 2522;

const parts = [
  {
    id: 'clip31-company-setup-part1',
    output: 'clip31-company-setup-part1.mp4',
    labels: ['Part 1 — Company Identity & Branding', 'Part 1 — Business Defaults', 'Part 1 — Booking Configuration'],
    segments: ['part1-01', 'part1-02', 'part1-03'],
  },
  {
    id: 'clip32-company-setup-part2',
    output: 'clip32-company-setup-part2.mp4',
    labels: ['Part 2 — PhotoSync Assignment Email', 'Part 2 — SMS & Resend Templates', 'Part 2 — Customer & Photo Alerts'],
    segments: ['part2-01', 'part2-02', 'part2-03'],
  },
  {
    id: 'clip33-company-setup-part3',
    output: 'clip33-company-setup-part3.mp4',
    labels: ['Part 3 — On-Call Escalations', 'Part 3 — Voice Command Sheet', 'Part 3 — Defaults & Shortcuts'],
    segments: ['part3-01', 'part3-02', 'part3-03'],
  },
];

const shell = (args) => execFileSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
const duration = file => parseFloat(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
const escapeText = value => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/,/g, '\\,');

function makeClip(partIndex, segIndex, segment) {
  const frame = path.join(FRAMES, `${segment}.png`);
  const audio = path.join(AUDIO, `seg-${segment}.wav`);
  const clip = path.join(CLIPS, `${parts[partIndex].id}-${segIndex + 1}.mp4`);
  if (!fs.existsSync(frame) || !fs.existsSync(audio)) throw new Error(`Missing source for ${segment}`);
  const seconds = duration(audio) + 0.6;
  const frames = Math.ceil(seconds * FPS);
  const fadeOut = Math.max(0.45, seconds - 0.4).toFixed(2);
  const caption = escapeText(parts[partIndex].labels[segIndex]);
  // The PDF contains the original 1919px-wide browser screenshots. Crop the
  // content column before scaling so text stays sharp and fills the player.
  // The final shortcuts page is a short embedded image, so it is padded
  // rather than scrolling through blank space below the UI.
  const shortPage = segment === 'part3-03';
  const vf = [
    shortPage
      ? `crop=${SOURCE_CROP_W}:747:${SOURCE_CROP_X}:0`
      : `crop=${SOURCE_CROP_W}:${SOURCE_CROP_H}:${SOURCE_CROP_X}:0`,
    `scale=${W}:-2`,
    shortPage
      ? `pad=${W}:${H}:0:(oh-ih)/2:color=white`
      : `crop=${W}:${H}:x=0:y='min((ih-oh)*n/${frames},ih-oh)'`,
    'setsar=1',
    `drawtext=fontfile=${FONT}:text='${caption}':fontcolor=white:fontsize=42:box=1:boxcolor=0x1e3a8a@0.9:boxborderw=24:x=72:y=h-140:shadowcolor=black@0.4:shadowx=2:shadowy=2`,
    'fade=t=in:st=0:d=0.35',
    `fade=t=out:st=${fadeOut}:d=0.35`,
  ].join(',');
  shell([
    '-y', '-loop', '1', '-i', frame, '-i', audio,
    '-filter_complex', `[0:v]${vf}[v];[1:a]afade=t=out:st=${fadeOut}:d=0.35[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast',
    '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
    '-ar', '48000', '-t', seconds.toFixed(2), '-r', String(FPS), clip,
  ]);
  return clip;
}

function buildPart(part, partIndex) {
  fs.mkdirSync(CLIPS, { recursive: true });
  const clips = part.segments.map((segment, segIndex) => {
    const clip = path.join(CLIPS, `${part.id}-${segIndex + 1}.mp4`);
    if (fs.existsSync(clip)) return clip;
    return makeClip(partIndex, segIndex, segment);
  });
  const list = path.join(CLIPS, `${part.id}.txt`);
  fs.writeFileSync(list, clips.map(file => `file '${file}'`).join('\n'));
  const attachedOutput = path.join(ATTACHED, part.output);
  const publicOutput = path.join(PUBLIC, part.output);
  fs.mkdirSync(ATTACHED, { recursive: true });
  shell(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', attachedOutput]);
  fs.copyFileSync(attachedOutput, publicOutput);
  console.log(`Created ${attachedOutput}`);
}

for (let i = 0; i < parts.length; i++) buildPart(parts[i], i);