// A report uses small JPEG derivatives, not the stored evidence originals.
// Keep at most three images (and their decoded previews) in flight at a time.
export const REPORT_PHOTO_CONCURRENCY = 3;
const MAX_REPORT_JPEG_BYTES = 2 * 1024 * 1024;

function readDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the prepared photo.'));
    reader.readAsDataURL(blob);
  });
}

function imageDimensions(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    const cleanup = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Photo decoding timed out.'));
    }, 15000);
    image.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = image;
      cleanup();
      if (!width || !height) reject(new Error('The prepared photo has no dimensions.'));
      else resolve({ width, height });
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('The prepared photo is not a readable image.'));
    };
    image.src = url;
  });
}

export async function loadReportPhoto(item, inspectionJobId, photoCount) {
  if (!item?.id || !inspectionJobId) throw new Error('The photo or inspection job is missing.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let response;
  try {
    response = await fetch(`/api/inspection-reports/photo?inspectionJobId=${encodeURIComponent(inspectionJobId)}&mediaId=${encodeURIComponent(item.id)}&photoCount=${encodeURIComponent(photoCount)}`, {
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Photo preparation failed (${response.status}).`);
    }
    const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (mime !== 'image/jpeg') throw new Error('The photo service returned an invalid image.');
    const blob = await response.blob();
    if (!blob.size || blob.size > MAX_REPORT_JPEG_BYTES) throw new Error('The prepared photo is empty or too large.');
    const [dimensions, dataUrl] = await Promise.all([imageDimensions(blob), readDataUrl(blob)]);
    return { ...dimensions, dataUrl };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Photo preparation timed out. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function createReportImageQueue(items, inspectionJobId, {
  loadPhoto = loadReportPhoto,
  onProgress = () => {},
  concurrency = REPORT_PHOTO_CONCURRENCY,
} = {}) {
  let nextToStart = 0;
  let nextToConsume = 0;
  const pending = new Map();
  const limit = Math.max(1, Math.min(3, Math.floor(concurrency) || 1));

  const fill = () => {
    while (pending.size < limit && nextToStart < items.length) {
      const index = nextToStart++;
      // Capture failures as values so a later prefetched failure cannot become
      // an unhandled rejection before the PDF builder reaches that photo.
      pending.set(index, Promise.resolve().then(() => loadPhoto(items[index], inspectionJobId, items.length))
        .then(value => ({ value }), error => ({ error })));
    }
  };
  fill();

  return {
    async next(item) {
      const index = nextToConsume;
      if (items[index] !== item || !pending.has(index)) throw new Error('Report photo order changed while building the PDF.');
      const result = await pending.get(index);
      pending.delete(index);
      nextToConsume++;
      fill();
      onProgress(nextToConsume, items.length);
      if (result.error) {
        const label = [item.section, item.caption].filter(Boolean).join(' / ') || 'untitled';
        throw new Error(`Photo ${index + 1} of ${items.length} (${label}) could not be prepared: ${result.error.message || result.error}. Check the original photo and try again. No incomplete report was sent.`);
      }
      return result.value;
    },
  };
}