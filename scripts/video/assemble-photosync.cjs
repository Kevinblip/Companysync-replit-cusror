#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const SHOTS = path.join(ROOT, 'shots-photosync');
const AUDIO = path.join(ROOT, 'audio-photosync');
const CLIPS = path.join(ROOT, 'clips-photosync');
const DEST = path.join(ROOT, '..', '..', 'public', 'videos', 'clip22-photos.mp4');
const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 1920, H = 1080, FPS = 30;
const labels = [
  'PhotoSync Dashboard', 'Job Evidence', 'Capture by Section', 'AI Damage Analysis',
  'Review and Correct', 'AI Scope of Work', 'Share Evidence', 'Review the Report Set', 'Generate the Damage Report',
];
const focal = [
  ['iw/2-(iw/zoom/2)', 'ih/2-(ih/zoom/2)'], ['0', '0'], ['iw-(iw/zoom)', '0'],
  ['iw/2-(iw/zoom/2)', 'ih-(ih/zoom)'], ['iw-(iw/zoom)', 'ih-(ih/zoom)'], ['0', 'ih-(ih/zoom)'],
];
const escapeText = (value) => value.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019').replace(/,/g, '\\,');
const duration = (file) => parseFloat(execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

fs.mkdirSync(CLIPS, { recursive: true });
for (let index = 0; index < labels.length; index += 1) {
  const number = String(index + 1).padStart(2, '0');
  const image = path.join(SHOTS, `photos-${number}.png`);
  const audio = path.join(AUDIO, `seg${number}.wav`);
  const clip = path.join(CLIPS, `photos-${number}.mp4`);
  if (!fs.existsSync(image) || !fs.existsSync(audio)) throw new Error(`Missing PhotoSync source for beat ${number}`);
  const seconds = duration(audio) + 0.5;
  const frames = Math.ceil(seconds * FPS);
  const [x, y] = focal[index % focal.length];
  const fadeOut = Math.max(0.4, seconds - 0.35).toFixed(2);
  const vf = [
    `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase`, `crop=${W * 2}:${H * 2}`,
    `zoompan=z='min(zoom+0.0005,1.10)':d=${frames}:x='${x}':y='${y}':s=${W}x${H}:fps=${FPS}`,
    'setsar=1', `drawtext=fontfile=${FONT}:text='${escapeText(labels[index])}':fontcolor=white:fontsize=48:box=1:boxcolor=0x1e3a8a@0.88:boxborderw=24:x=72:y=h-140:shadowcolor=black@0.4:shadowx=2:shadowy=2`,
    'fade=t=in:st=0:d=0.35', `fade=t=out:st=${fadeOut}:d=0.35`,
  ].join(',');
  execFileSync('ffmpeg', ['-y', '-loop', '1', '-i', image, '-i', audio, '-filter_complex', `[0:v]${vf}[v];[1:a]afade=t=out:st=${fadeOut}:d=0.35[a]`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-t', seconds.toFixed(2), '-r', String(FPS), clip], { stdio: ['ignore', 'ignore', 'inherit'] });
}

const list = path.join(CLIPS, 'concat-photosync.txt');
fs.writeFileSync(list, labels.map((_, index) => `file '${path.join(CLIPS, `photos-${String(index + 1).padStart(2, '0')}.mp4`)}'`).join('\n'));
execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', DEST], { stdio: 'inherit' });
console.log(`Created ${DEST}`);