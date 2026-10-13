// Builds per-beat clips then concatenates by topic into final MP4s (topics 7-16).
// Usage: node assemble-v2.cjs [START_IDX] [END_IDX]
//        node assemble-v2.cjs concat <topic> <outNum>
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const all = require('./segments-v2.cjs');

const DIR   = __dirname;
const SHOTS = path.join(DIR, 'shots-live');
const AUDIO = path.join(DIR, 'audio-v2');
const CLIPS = path.join(DIR, 'clips-v2');
const DEST  = path.join(DIR, '..', '..', 'public', 'videos');
const FONT  = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const FPS = 30, W = 1920, H = 1080;

fs.mkdirSync(CLIPS, { recursive: true });
fs.mkdirSync(DEST,  { recursive: true });

function probeDur(file) {
  return parseFloat(execFileSync('ffprobe',['-v','quiet','-show_entries','format=duration','-of','csv=p=0',file]).toString().trim());
}
function esc(t) { return t.replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,'\u2019').replace(/,/g,'\\,'); }

const FOCAL = [
  { x:"iw/2-(iw/zoom/2)", y:"ih/2-(ih/zoom/2)" },
  { x:"0",                y:"0"                  },
  { x:"iw-(iw/zoom)",     y:"0"                  },
  { x:"iw/2-(iw/zoom/2)", y:"ih-(ih/zoom)"        },
  { x:"iw-(iw/zoom)",     y:"ih-(ih/zoom)"        },
  { x:"0",                y:"ih-(ih/zoom)"        },
];

// ── Concat mode ───────────────────────────────────────────────────────────────
if (process.argv[2] === 'concat') {
  const topic  = process.argv[3];
  const outNum = process.argv[4];
  if (!topic || !outNum) { console.error('Usage: concat <topic> <outNum>'); process.exit(1); }
  const beats = all.filter(s => s.topic === topic);
  const missing = beats.filter(s => !fs.existsSync(path.join(CLIPS, `clip${s.id}.mp4`)));
  if (missing.length) { console.error('Missing clips:', missing.map(s=>s.id).join(', ')); process.exit(1); }
  const listFile = path.join(CLIPS, `concat-${topic}.txt`);
  fs.writeFileSync(listFile, beats.map(s => `file '${path.join(CLIPS,`clip${s.id}.mp4`)}'`).join('\n'));
  const out = path.join(DEST, `clip${outNum}-${topic}.mp4`);
  console.log(`concat ${topic} (${beats.length} clips) → ${path.basename(out)}`);
  execFileSync('ffmpeg',['-y','-f','concat','-safe','0','-i',listFile,'-c','copy',out],{stdio:'inherit'});
  console.log(`Done → ${out}`);
  process.exit(0);
}

// ── Build clips ───────────────────────────────────────────────────────────────
const startIdx = parseInt(process.argv[2] ?? '0', 10);
const endIdx   = parseInt(process.argv[3] ?? String(all.length), 10);
const segments = all.slice(startIdx, endIdx);
console.log(`Building clips ${startIdx}–${endIdx-1} (${segments.length} beats)`);

segments.forEach((seg, localI) => {
  const globalI = startIdx + localI;
  const img  = path.join(SHOTS, seg.img);
  const wav  = path.join(AUDIO, `seg${seg.id}.wav`);
  const clip = path.join(CLIPS, `clip${seg.id}.mp4`);
  if (!fs.existsSync(wav))  { console.log(`${seg.id}: no audio, skip`); return; }
  if (fs.existsSync(clip) && !process.env.FORCE) { console.log(`${seg.id}: exists, skip`); return; }
  const dur    = probeDur(wav) + 0.5;
  const frames = Math.ceil(dur * FPS);
  const t      = FOCAL[globalI % FOCAL.length];
  const vf = [
    `scale=${W*2}:${H*2}:force_original_aspect_ratio=increase`,
    `crop=${W*2}:${H*2}`,
    `zoompan=z='min(zoom+0.0005,1.10)':d=${frames}:x='${t.x}':y='${t.y}':s=${W}x${H}:fps=${FPS}`,
    `setsar=1`,
    `drawtext=fontfile=${FONT}:text='${esc(seg.caption)}':fontcolor=white:fontsize=48:box=1:boxcolor=0x1e3a8a@0.88:boxborderw=24:x=72:y=h-140:shadowcolor=black@0.4:shadowx=2:shadowy=2`,
    `fade=t=in:st=0:d=0.35`,
    `fade=t=out:st=${(dur-0.35).toFixed(2)}:d=0.35`,
  ].join(',');
  console.log(`clip ${seg.id} [${seg.topic}]: building (${dur.toFixed(1)}s)...`);
  execFileSync('ffmpeg',['-y','-loop','1','-i',img,'-i',wav,'-filter_complex',`[0:v]${vf}[v];[1:a]afade=t=out:st=${(dur-0.35).toFixed(2)}:d=0.35[a]`,'-map','[v]','-map','[a]','-c:v','libx264','-preset','veryfast','-crf','22','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-ar','48000','-t',dur.toFixed(2),'-r',String(FPS),clip],{stdio:['ignore','ignore','inherit']});
  console.log(`  → ${clip}`);
});
console.log('Batch done.');
