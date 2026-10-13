const E164_REGEX = /^\+[1-9]\d{6,14}$/;

export function createPageUrl(pageName: string) {
    return '/' + pageName.replace(/ /g, '-');
}

/**
 * Attempts to convert a typed US phone number to E.164.
 * Strips non-digit characters, then:
 *   - 10 digits → "+1" + digits
 *   - 11 digits starting with "1" → "+" + digits
 * Returns the E.164 string on success, or null when the number
 * doesn't look like a recognisable US number.
 */
export function formatToE164(value: string): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

/**
 * Returns true when the value looks like a US phone number that
 * formatToE164 can convert, but is not yet in valid E.164 format.
 */
export function looksLikeFormattableUSPhone(value: string): boolean {
  if (!value) return false;
  if (E164_REGEX.test(value)) return false; // already valid E.164
  return formatToE164(value) !== null;
}

/**
 * Validates a phone number string.
 * Accepts any format with enough digits — plain 10-digit US numbers, formatted
 * numbers like (216) 555-0000, international numbers starting with +, etc.
 * Only rejects values that have too few digits to be a real phone number.
 * Returns an error message string if invalid, or null if valid (or empty).
 */
export function validateE164Phone(value: string): string | null {
    if (!value) return null;
    const cleaned = value.replace(/[\s\-().+]/g, '');
    if (!/^\d+$/.test(cleaned) || cleaned.length < 7) {
        return 'Enter a valid phone number (e.g. 2165550000 or +12165550000).';
    }
    return null;
}

/**
 * Compress an image file using Canvas before upload.
 * - Resizes to maxPx on the longest side (default 2048)
 * - Re-encodes as JPEG at `quality` (default 0.85)
 * - Videos and non-image files are returned unchanged
 */
export async function compressImage(
  file: File,
  maxPx = 2048,
  quality = 0.85
): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width: w, height: h } = img;
      if (w > maxPx || h > maxPx) {
        if (w >= h) { h = Math.round((h / w) * maxPx); w = maxPx; }
        else { w = Math.round((w / h) * maxPx); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], name, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
