/**
 * Client-side photo quality pre-check using Canvas API.
 *
 * Runs two fast checks on a downscaled copy of the image:
 *   1. Brightness — average luminance; flags photos that are too dark.
 *   2. Blur (Laplacian variance) — low variance across the Laplacian of a
 *      grayscale image correlates strongly with out-of-focus / motion blur.
 *
 * The whole check runs in <100 ms on a typical mobile phone.
 *
 * @param {File} file  An image File object (JPEG/PNG/HEIC not yet converted).
 * @returns {Promise<{ ok: boolean, isDark: boolean, isBlurry: boolean, brightness: number, blurScore: number }>}
 */
export async function checkPhotoQuality(file) {
  // Only run on image files; skip videos and unconverted HEIC gracefully.
  if (!file.type.startsWith('image/')) {
    return { ok: true, isDark: false, isBlurry: false, brightness: 255, blurScore: 9999 };
  }

  const SAMPLE_SIZE = 200; // px — small enough to be fast, large enough for accuracy
  const DARK_THRESHOLD = 40;   // average luminance 0-255; below this = too dark
  const BLUR_THRESHOLD = 80;   // Laplacian variance; below this = blurry

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        // ── Draw to a small canvas ──────────────────────────────────────────
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const pixelCount = SAMPLE_SIZE * SAMPLE_SIZE;

        // ── Build grayscale buffer + measure brightness ─────────────────────
        const gray = new Float32Array(pixelCount);
        let brightnessSum = 0;
        for (let i = 0; i < pixelCount; i++) {
          const r = data[i * 4];
          const g = data[i * 4 + 1];
          const b = data[i * 4 + 2];
          // Perceptual luminance (ITU-R BT.601)
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          gray[i] = lum;
          brightnessSum += lum;
        }
        const brightness = brightnessSum / pixelCount;

        // ── Laplacian variance (blur detection) ─────────────────────────────
        // Kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0]
        const W = SAMPLE_SIZE;
        const H = SAMPLE_SIZE;
        let lapSum = 0;
        let lapSumSq = 0;
        let lapCount = 0;

        for (let y = 1; y < H - 1; y++) {
          for (let x = 1; x < W - 1; x++) {
            const idx = y * W + x;
            const lap =
              gray[idx - W] +     // top
              gray[idx + W] +     // bottom
              gray[idx - 1] +     // left
              gray[idx + 1] +     // right
              -4 * gray[idx];     // center
            lapSum += lap;
            lapSumSq += lap * lap;
            lapCount++;
          }
        }
        const lapMean = lapSum / lapCount;
        const blurScore = lapSumSq / lapCount - lapMean * lapMean; // variance

        const isDark = brightness < DARK_THRESHOLD;
        const isBlurry = blurScore < BLUR_THRESHOLD;

        resolve({ ok: !isDark && !isBlurry, isDark, isBlurry, brightness, blurScore });
      } catch (err) {
        // If anything goes wrong, allow the upload rather than blocking it.
        console.warn('[photoQualityCheck] canvas error (non-critical):', err);
        resolve({ ok: true, isDark: false, isBlurry: false, brightness: 255, blurScore: 9999 });
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      // Can't decode → let the upload proceed normally.
      resolve({ ok: true, isDark: false, isBlurry: false, brightness: 255, blurScore: 9999 });
    };

    img.src = url;
  });
}
