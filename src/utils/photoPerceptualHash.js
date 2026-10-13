/**
 * Small browser-side difference hash for uploaded photos.
 *
 * The hash is based on adjacent grayscale pixels rather than file bytes, so
 * resizing, metadata changes, and ordinary JPEG re-encoding do not create a
 * new identity. It is intentionally kept independent of an image library so
 * camera/gallery uploads work in the same browser bundle.
 */

const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode image'));
    };
    image.src = objectUrl;
  });
}

function closeBitmap(bitmap) {
  if (typeof bitmap?.close === 'function') bitmap.close();
}

/**
 * Return a 64-bit dHash as a 16-character hexadecimal string.
 * Failures are deliberately represented as null: hashing is an evidence
 * enhancement and must never prevent the photo from being uploaded.
 */
export async function computePhotoPerceptualHash(blob) {
  if (!blob) return null;

  let source = null;
  let canvas = null;
  try {
    source = typeof createImageBitmap === 'function'
      ? await createImageBitmap(blob)
      : await loadImage(blob);
    canvas = document.createElement('canvas');
    canvas.width = HASH_WIDTH;
    canvas.height = HASH_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(source, 0, 0, HASH_WIDTH, HASH_HEIGHT);
    const pixels = context.getImageData(0, 0, HASH_WIDTH, HASH_HEIGHT).data;

    let hash = '';
    for (let row = 0; row < HASH_HEIGHT; row++) {
      let byte = 0;
      for (let column = 0; column < HASH_WIDTH - 1; column++) {
        const left = (row * HASH_WIDTH + column) * 4;
        const right = left + 4;
        // Luma is sufficient for a difference hash and avoids color-channel
        // noise making identical photos look different.
        const leftGray = 0.299 * pixels[left]
          + 0.587 * pixels[left + 1]
          + 0.114 * pixels[left + 2];
        const rightGray = 0.299 * pixels[right]
          + 0.587 * pixels[right + 1]
          + 0.114 * pixels[right + 2];
        if (leftGray > rightGray) byte |= 1 << (7 - column);
      }
      hash += byte.toString(16).padStart(2, '0');
    }
    return hash;
  } catch (error) {
    console.debug('Could not compute photo perceptual hash:', error);
    return null;
  } finally {
    closeBitmap(source);
    canvas = null;
  }
}

export default computePhotoPerceptualHash;