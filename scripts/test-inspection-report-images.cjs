#!/usr/bin/env node
// Deterministic 38/179-photo preparation + browser-PDF fixture. Never reads
// real customer photos or sends mail; reports transfer/decode timing separately
// from PDF assembly so regressions in either cost are visible.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createCanvas } = require('@napi-rs/canvas');
const { jsPDF } = require('jspdf');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const { createReportImageQueue } = await import('../src/utils/inspectionReportImages.js');
  for (const count of [38, 179]) {
    const photos = Array.from({ length: count }, (_, i) => ({
      id: `fixture-${i + 1}`,
      section: i % 2 ? 'Front Elevation' : 'Rear Elevation',
      caption: `Photo ${i + 1} evidence`,
    }));
    // Same fixed transfer/decode time on both paths, to isolate serial vs
    // bounded three-lane preparation. PDF assembly is measured separately.
    const mockLoad = async (photo) => {
      await sleep(18);
      return { width: 1200, height: 800, id: photo.id };
    };
    let started = performance.now();
    for (const photo of photos) await mockLoad(photo);
    const serialMs = performance.now() - started;
    started = performance.now();
    const queue = createReportImageQueue(photos, 'fixture-job', { loadPhoto: mockLoad });
    const received = [];
    for (const photo of photos) received.push((await queue.next(photo)).id);
    const preparedMs = performance.now() - started;
    assert.deepEqual(received, photos.map(photo => photo.id), 'each photo must retain its order');
    assert.ok(preparedMs < serialMs * 0.7, 'bounded preparation should be measurably faster than serial');

    const canvas = createCanvas(1200, 800);
    const ctx = canvas.getContext('2d');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    started = performance.now();
    for (let i = 0; i < count; i++) {
      const photo = photos[i];
      if (i) doc.addPage();
      ctx.fillStyle = `hsl(${(i * 41) % 360}, 55%, 55%)`;
      ctx.fillRect(0, 0, 1200, 800);
      ctx.fillStyle = '#111827';
      ctx.font = '36px sans-serif';
      ctx.fillText(photo.caption, 40, 70);
      const jpeg = canvas.toBuffer('image/jpeg', 72);
      doc.text(photo.section, 20, 25);
      doc.addImage(new Uint8Array(jpeg), 'JPEG', 20, 30, 170, 112);
      doc.text(photo.caption, 20, 151);
    }
    const pdf = Buffer.from(doc.output('arraybuffer'));
    assert.equal(doc.getNumberOfPages(), count);
    assert.equal(Object.keys(doc.internal.collections.addImage_images).length, count, 'one distinct image per photo');
    const text = pdf.toString('latin1');
    for (const photo of photos) {
      assert.ok(text.includes(photo.caption), `missing caption ${photo.caption}`);
      assert.ok(text.includes(photo.section), `missing section ${photo.section}`);
    }
    assert.ok(pdf.length < 48 * 1024 * 1024, 'full report must fit the private upload limit');
    console.log(`${count} photos: serial preparation ${Math.round(serialMs)}ms, bounded preparation ${Math.round(preparedMs)}ms (${(serialMs / preparedMs).toFixed(1)}x); PDF ${Math.round(performance.now() - started)}ms, ${(pdf.length / 1048576).toFixed(1)} MiB, ${count} images/pages/captions`);
  }

  const items = Array.from({ length: 38 }, (_, i) => ({ id: String(i), caption: `Failure ${i}` }));
  const failed = createReportImageQueue(items, 'fixture-job', {
    loadPhoto: async item => {
      if (item.id === '23') throw new Error('Stored original unavailable');
      return { dataUrl: 'test', width: 100, height: 100 };
    },
  });
  for (let i = 0; i < 23; i++) await failed.next(items[i]);
  await assert.rejects(failed.next(items[23]), /Photo 24 of 38.*Stored original unavailable.*No incomplete report was sent/);
  console.log('Missing-photo failure stops before any PDF upload/send.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });