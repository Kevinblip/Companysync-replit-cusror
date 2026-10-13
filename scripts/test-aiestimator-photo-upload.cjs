#!/usr/bin/env node
/**
 * Regression checks for mobile AI Estimator photo slots:
 * - Camera/gallery selection persists through an Android tab remount.
 * - capture="environment" is emitted only for live-camera mode.
 * - A rejected or stalled UploadFile never prevents successful photos from
 *   returning, and the upload operation itself always settles.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const {
    AI_ESTIMATOR_CAPTURE_MODE_KEY,
    persistCaptureMode,
    readCaptureMode,
    slotPickerAttributes,
  } = await import('../src/utils/photoCaptureMode.js');
  const { uploadBatchPhotos } = await import('../src/utils/batchPhotoUpload.js');

  let pass = 0;
  const ok = (condition, label) => {
    assert.ok(condition, label);
    pass++;
    console.log(`  ✓ ${label}`);
  };

  const storage = new Map();
  const sessionStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  ok(readCaptureMode(sessionStorage) === 'upload', 'gallery mode is the safe default');
  persistCaptureMode('camera', sessionStorage);
  ok(storage.get(AI_ESTIMATOR_CAPTURE_MODE_KEY) === 'camera', 'camera choice is saved before camera launch');
  ok(readCaptureMode(sessionStorage) === 'camera', 'saved camera choice restores after a remount');
  persistCaptureMode('upload', sessionStorage);
  ok(readCaptureMode(sessionStorage) === 'upload', 'gallery choice restores after a remount');

  const cameraInput = slotPickerAttributes('camera');
  const galleryInput = slotPickerAttributes('upload');
  ok(cameraInput.capture === 'environment' && cameraInput.accept === 'image/*',
    'camera slots request the rear camera');
  ok(!Object.hasOwn(galleryInput, 'capture')
    && galleryInput.accept === 'image/jpeg,image/png,image/heic,image/heif,image/webp',
  'gallery slots omit capture and use explicit image MIME types');

  const estimatorSource = fs.readFileSync(
    path.join(__dirname, '../src/pages/AIEstimator.jsx'),
    'utf8',
  );
  ok(/data-testid=\{`photo-preview-/.test(estimatorSource)
    && /className="w-full h-full object-contain bg-slate-950 absolute inset-0"/.test(estimatorSource),
  'measurement thumbnails show the complete photo instead of center-cropping rooflines');
  ok(/little sky above the roof peak/.test(estimatorSource)
    && /ground line visible/.test(estimatorSource),
  'capture guidance asks for both the roof peak and ground line');

  const files = ['fast.jpg', 'rejected.jpg', 'stalled.jpg', 'late-success.jpg']
    .map(name => ({ name }));
  const progress = [];
  let waitingForSlowUploads = false;
  const UploadFile = ({ name }) => {
    if (name === 'fast.jpg') return Promise.resolve({ file_url: 'https://files/fast' });
    if (name === 'rejected.jpg') return Promise.reject(new Error('network failed'));
    if (name === 'late-success.jpg') {
      return new Promise(resolve => setTimeout(() => resolve({ file_url: 'https://files/late' }), 12));
    }
    return new Promise(() => {}); // A real stalled mobile upload: never resolves.
  };
  const startedAt = Date.now();
  const result = await Promise.race([
    uploadBatchPhotos({
      files,
      compress: async (file) => file,
      upload: (file) => UploadFile(file),
      createPreview: (file) => `blob:${file.name}`,
      onProgress: (done, total) => progress.push([done, total]),
      onWaiting: () => { waitingForSlowUploads = true; },
      timeoutMs: 5,
      graceMs: 30,
      concurrency: 2,
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('batch upload wedged')), 250)),
  ]);
  const elapsed = Date.now() - startedAt;
  ok(elapsed < 250, 'stalled UploadFile settles within the bounded timeout/grace window');
  ok(result.uploads.map(upload => upload.name).join(',') === 'fast.jpg,late-success.jpg',
    'successful and late-success uploads survive partial failures');
  ok(result.failedCount === 2, 'rejected and permanently stalled uploads are reported as failures');
  ok(waitingForSlowUploads, 'the UI can report that it is waiting on slow uploads');
  ok(progress.length === files.length && progress.at(-1)[0] === files.length,
    'progress completes even when individual uploads fail or stall');

  console.log(`\n${pass} passed`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});