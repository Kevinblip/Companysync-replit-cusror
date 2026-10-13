const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const esbuild = require('esbuild');
const { chromium } = require('playwright');

(async () => {
  const bundle = await esbuild.build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'jsx',
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
        import { base44 } from './src/api/base44Client.js';
        import Gallery from './src/components/subcontractors/SubcontractorWorkPhotosDialog.jsx';
        import { compressWorkPhoto, WORK_PHOTO_MAX_BYTES } from './src/utils/subcontractorWorkPhotos.js';
        window.verifyPhotos = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 2560; canvas.height = 1800;
          const ctx = canvas.getContext('2d');
          const pixels = ctx.createImageData(canvas.width, canvas.height);
          let seed = 123456789;
          for (let i = 0; i < pixels.data.length; i += 4) {
            seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
            pixels.data[i] = seed & 255;
            pixels.data[i + 1] = (seed >>> 8) & 255;
            pixels.data[i + 2] = (seed >>> 16) & 255;
            pixels.data[i + 3] = 255;
          }
          ctx.putImageData(pixels, 0, 0);
          const source = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          const compressed = await compressWorkPhoto(new File([source], 'noise.png', {type:'image/png'}));
          if (compressed.size > WORK_PHOTO_MAX_BYTES) throw new Error('Compression exceeded the byte cap');
          const bitmap = await createImageBitmap(compressed);
          const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
          const photoURL = URL.createObjectURL(compressed);
          base44.entities.SubcontractorWorkPhoto.filter = async filters => {
            if (filters.company_id !== 'fixture-company' || filters.subcontractor_id !== 'fixture-sub') {
              throw new Error('Missing company/subcontractor scope');
            }
            return [{id:'fixture-photo', company_id:'fixture-company', subcontractor_id:'fixture-sub',
              file_url:photoURL, file_name:'Compressed work example', size_bytes:compressed.size}];
          };
          let formatError = '';
          try { await compressWorkPhoto(new File(['not a photo'], 'file.pdf', {type:'application/pdf'})); }
          catch (e) { formatError = e.message; }
          let corruptError = '';
          try { await compressWorkPhoto(new File(['broken'], 'broken.jpg', {type:'image/jpeg'})); }
          catch (e) { corruptError = e.message; }
          createRoot(document.getElementById('root')).render(
            React.createElement(QueryClientProvider, {client:new QueryClient()},
              React.createElement(Gallery, {open:true, onOpenChange:()=>{},
                companyId:'fixture-company',subcontractor:{id:'fixture-sub',name:'Test crew'}})
            )
          );
          return {size:compressed.size, originalSize:source.size, type:compressed.type, dimensions, formatError, corruptError};
        };
      `,
    },
    alias: { '@': path.resolve('src') },
    bundle: true, write: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  let executablePath;
  try { executablePath = execSync('command -v chromium || command -v chromium-browser', { encoding: 'utf8' }).trim(); } catch {}
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    const cssFile = fs.readdirSync('dist/assets').find(name => /^index-.*\.css$/.test(name));
    assert.ok(cssFile, 'Build the app before this render check so its real styles are available');
    await page.addStyleTag({ content: fs.readFileSync(path.join('dist/assets', cssFile), 'utf8') });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const result = await page.evaluate(() => window.verifyPhotos());
    assert.equal(result.type, 'image/jpeg');
    assert.ok(result.size <= 350 * 1024 && result.size < result.originalSize);
    assert.ok(Math.max(...result.dimensions) <= 1600);
    assert.match(result.formatError, /Choose a JPEG/);
    assert.match(result.corruptError, /could not be opened/);
    await page.waitForFunction(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.length === 2 && imgs.every(img => img.complete && img.naturalWidth > 0);
    });
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'View Compressed work example' }).click();
    await page.screenshot({ path: '/tmp/subcontractor-work-photo-render.png' });
    assert.deepEqual(errors, []);
    console.log(`PASS: real preview/thumbnail rendering, phone layout, compression (${result.originalSize} -> ${result.size} bytes, ${result.dimensions.join('x')}), and explicit invalid-photo rejection`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });