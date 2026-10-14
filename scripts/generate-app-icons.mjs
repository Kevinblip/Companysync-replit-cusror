// Builds store icon and splash masters from the existing 512px logo.
// Replace assets/icon-only.png with a 1024px master before the final store upload.
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sourcePath = path.join(root, 'public/icons/icon-512.png');
const outDir = path.join(root, 'assets');
const background = '#1e3a5f';

fs.mkdirSync(outDir, { recursive: true });
const source = await loadImage(sourcePath);

function canvasOf(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, size, size);
  return { canvas, ctx };
}

const icon = canvasOf(1024);
icon.ctx.drawImage(source, 0, 0, 1024, 1024);
fs.writeFileSync(path.join(outDir, 'icon-only.png'), icon.canvas.toBuffer('image/png'));
fs.writeFileSync(path.join(outDir, 'icon-foreground.png'), icon.canvas.toBuffer('image/png'));

const splash = canvasOf(2732);
const logo = 900;
splash.ctx.drawImage(source, (2732 - logo) / 2, (2732 - logo) / 2, logo, logo);
fs.writeFileSync(path.join(outDir, 'splash.png'), splash.canvas.toBuffer('image/png'));
fs.writeFileSync(path.join(outDir, 'splash-dark.png'), splash.canvas.toBuffer('image/png'));

const backgroundCanvas = canvasOf(1024);
fs.writeFileSync(path.join(outDir, 'icon-background.png'), backgroundCanvas.canvas.toBuffer('image/png'));

console.log('[icons] Wrote assets/icon-only.png, icon-foreground.png, icon-background.png, splash.png');
