export const WORK_PHOTO_MAX_BYTES = 350 * 1024;
export const WORK_PHOTO_MAX_EDGE = 1600;
export const WORK_PHOTO_LIMIT = 12;

/** Compress before transport; never silently upload an uncompressed original. */
export async function compressWorkPhoto(file) {
  if (!file || !/^image\/(jpeg|png|webp|avif)$/i.test(file.type)) {
    throw new Error('Choose a JPEG, PNG, WebP, or AVIF photo. Convert HEIC photos to JPEG first.');
  }
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('This photo is too large to process. Choose a photo under 25 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      const timer = setTimeout(() => reject(new Error('Photo processing timed out. Please try a smaller photo.')), 30000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); reject(new Error('This photo could not be opened. Choose a different photo.')); };
      img.src = url;
    });
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('This photo has invalid dimensions.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Photo compression is unavailable in this browser.');
    let edge = Math.min(WORK_PHOTO_MAX_EDGE, Math.max(image.naturalWidth, image.naturalHeight));
    for (let resize = 0; resize < 6; resize++) {
      const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.78, 0.65, 0.52]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob || blob.type !== 'image/jpeg') throw new Error('Photo compression failed. Please try again.');
        if (blob.size <= WORK_PHOTO_MAX_BYTES) {
          const name = (file.name || 'work-photo').replace(/\.[^.]+$/, '') + '.jpg';
          return new File([blob], name, { type: 'image/jpeg' });
        }
      }
      edge = Math.round(edge * 0.8);
    }
    throw new Error('This photo could not be compressed small enough. Please choose a smaller photo.');
  } finally {
    URL.revokeObjectURL(url);
  }
}