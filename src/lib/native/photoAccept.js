const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic', 'heif', 'bmp']);

export function acceptsOnlyImages(accept) {
  const raw = String(accept || '').trim().toLowerCase();
  if (!raw) return false;
  const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((part) => {
    if (part === 'image/*') return true;
    if (part.startsWith('image/') && !part.includes('*')) return true;
    const ext = part.replace(/^\./, '');
    return IMAGE_EXTENSIONS.has(ext);
  });
}

function marker(input, name) {
  if (typeof input.getAttribute === 'function') return input.getAttribute(name);
  return input[name];
}

export function shouldUseNativePhotoPicker(input) {
  if (!input || input.type !== 'file' || input.disabled) return false;
  const flag = marker(input, 'data-native-photo');
  if (flag === '0') return false;
  if (flag === '1') return true;
  return acceptsOnlyImages(input.accept);
}
