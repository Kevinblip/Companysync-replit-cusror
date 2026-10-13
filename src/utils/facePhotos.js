/**
 * facePhotos.js — collect the best available real photo per canonical wall face
 * (front/back/left/right) for the 3D viewer's photo-texture mode.
 *
 * Uploaded photos win over Street View for the same face (user-chosen angle).
 * Returns [{ face, url, source }] with at most one photo per face.
 */

/** Map a photo label / Street View direction to a canonical face token. */
export function canonicalFaceLabel(label) {
  const z = String(label || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (!z) return null;
  if (z.includes('front')) return 'front';
  if (z.includes('back') || z.includes('rear')) return 'back';
  if (z.includes('left')) return 'left';
  if (z.includes('right')) return 'right';
  return null;
}

export function buildFacePhotos({ housePhotos = [], elevationImages = [] } = {}) {
  const out = [];
  const seen = new Set();
  const add = (url, label, source) => {
    const face = canonicalFaceLabel(label);
    if (!url || !face || seen.has(face)) return;
    seen.add(face);
    out.push({ face, url, source });
  };
  for (const p of housePhotos) add(p?.url, p?.label, 'upload');
  for (const img of elevationImages) {
    if (!img?.available || !img?.imageUrl || img?._staticApiNotEnabled) continue;
    add(img.imageUrl, img.direction, 'street_view');
  }
  return out;
}
