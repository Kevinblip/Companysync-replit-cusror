// Smaller copy of a siding photo for the one timeout retry.
// pngjs and jpeg-js are pure JavaScript, so this loads on Node 20.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const MAX_EDGE = 1024;
const MIN_EDGE = 64;

function targetSize(width, height) {
  const long = Math.max(width, height);
  if (!(long > MIN_EDGE)) return { width, height };
  const scale = Math.min(0.5, MAX_EDGE / long);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function scaleRgba(src, sw, sh, dw, dh) {
  const dst = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y += 1) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const si = (sy * sw + sx) * 4;
      const di = (y * dw + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  return dst;
}

function decodeImage(buffer, mimeType) {
  const type = String(mimeType || '').toLowerCase();
  const isPng = type.includes('png') || (buffer[0] === 0x89 && buffer[1] === 0x50);
  if (isPng) {
    const png = PNG.sync.read(buffer);
    return { width: png.width, height: png.height, data: png.data, mimeType: 'image/png' };
  }
  const decoded = jpeg.decode(buffer, { maxMemoryUsageInMB: 128, formatAsRGBA: true });
  return {
    width: decoded.width,
    height: decoded.height,
    data: Buffer.from(decoded.data),
    mimeType: 'image/jpeg',
  };
}

function encodeImage(rgba, width, height, mimeType) {
  if (mimeType === 'image/png') {
    const png = new PNG({ width, height });
    rgba.copy(png.data);
    return PNG.sync.write(png);
  }
  return jpeg.encode({ data: rgba, width, height }, 60).data;
}

/**
 * Return a smaller base64 image for a timed-out Gemini read.
 * Falls back to the original bytes when the image cannot be decoded.
 */
export function shrinkPhotoForRetry(base64, mimeType = 'image/jpeg') {
  const input = Buffer.from(String(base64 || ''), 'base64');
  try {
    const decoded = decodeImage(input, mimeType);
    const next = targetSize(decoded.width, decoded.height);
    const rgba = next.width === decoded.width && next.height === decoded.height
      ? decoded.data
      : scaleRgba(decoded.data, decoded.width, decoded.height, next.width, next.height);
    let encoded = encodeImage(rgba, next.width, next.height, decoded.mimeType);
    if (encoded.length >= input.length && decoded.mimeType === 'image/jpeg') {
      encoded = jpeg.encode({ data: rgba, width: next.width, height: next.height }, 40).data;
    }
    if (encoded.length >= input.length) {
      return {
        imageData: String(base64 || ''),
        mimeType: decoded.mimeType,
        width: decoded.width,
        height: decoded.height,
        bytes: input.length,
        shrunk: false,
      };
    }
    return {
      imageData: Buffer.from(encoded).toString('base64'),
      mimeType: decoded.mimeType,
      width: next.width,
      height: next.height,
      bytes: encoded.length,
      shrunk: true,
    };
  } catch {
    return {
      imageData: String(base64 || ''),
      mimeType,
      width: 0,
      height: 0,
      bytes: input.length,
      shrunk: false,
    };
  }
}
