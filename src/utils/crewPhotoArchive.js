import JSZip from 'jszip';

const EXTENSION_BY_MIME_TYPE = {
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function datePart(photo) {
  const value = photo?.created_at || photo?.created_date;
  const timestamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString().slice(0, 10)
    : 'undated';
}

function slug(value, fallback) {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || fallback;
}

function extensionFor(url, contentType) {
  const mimeType = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (EXTENSION_BY_MIME_TYPE[mimeType]) return EXTENSION_BY_MIME_TYPE[mimeType];

  const path = String(url || '').split(/[?#]/, 1)[0];
  const match = path.match(/\.([a-z0-9]+)$/i);
  const extension = match?.[1]?.toLowerCase();
  if (extension === 'jpeg') return 'jpg';
  return ['avif', 'gif', 'heic', 'jpg', 'png', 'webp'].includes(extension)
    ? extension
    : 'jpg';
}

function archiveEntryName(photo, index, url, contentType) {
  const id = String(photo?.id || index + 1)
    .replace(/[^a-z0-9_-]/gi, '')
    .slice(-24) || String(index + 1);
  const caption = slug(photo?.caption, 'crew-photo');
  return `${String(index + 1).padStart(3, '0')}_${datePart(photo)}_${caption}_${id}.${extensionFor(url, contentType)}`;
}

/**
 * Fetch crew photos one at a time and return a ZIP only if every source file
 * was downloaded successfully. This prevents silently giving the user an
 * incomplete insurer package.
 */
export async function createCrewPhotoArchive(
  photos,
  { fetchImpl = globalThis.fetch, onProgress } = {},
) {
  const photoList = Array.isArray(photos) ? photos : [];
  if (photoList.length === 0) {
    throw new Error('There are no crew photos to download.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Photo downloads are not available in this browser.');
  }

  const zip = new JSZip();
  const failures = [];

  for (let index = 0; index < photoList.length; index += 1) {
    const photo = photoList[index];
    const url = photo?.file_url || photo?.url;

    try {
      if (!url) throw new Error('photo has no file URL');
      const response = await fetchImpl(url);
      if (!response?.ok) {
        throw new Error(`server returned ${response?.status || 'an error'}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) throw new Error('downloaded file was empty');
      const imageBytes = new Uint8Array(await blob.arrayBuffer());
      if (imageBytes.byteLength === 0) throw new Error('downloaded file was empty');
      zip.file(
        archiveEntryName(photo, index, url, response.headers?.get?.('content-type')),
        imageBytes,
      );
    } catch (error) {
      const label = photo?.caption || photo?.id || `photo ${index + 1}`;
      failures.push(`${label}: ${error.message || 'download failed'}`);
    } finally {
      onProgress?.({ completed: index + 1, total: photoList.length });
    }
  }

  if (failures.length > 0) {
    const details = failures.slice(0, 3).join('; ');
    const remaining = failures.length > 3 ? `; and ${failures.length - 3} more` : '';
    throw new Error(
      `Could not download ${failures.length} of ${photoList.length} photos, so no ZIP was created. ${details}${remaining}`,
    );
  }

  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}