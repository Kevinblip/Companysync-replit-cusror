'use strict';
const fs = require('node:fs');
const { gzipSync, brotliCompressSync, constants: zlibConstants } = require('node:zlib');

const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|xml|manifest\+json|wasm)|image\/svg\+xml)/i;
const RUNTIME_MAX_BYTES = 8 * 1024 * 1024;
const runtimeCache = new Map();

function encodingPreferences(header) {
  return new Map(String(header || '').toLowerCase().split(',').filter(Boolean).map(value => {
    const [name, ...params] = value.trim().split(';');
    const qParam = params.find(param => param.trim().startsWith('q='));
    const q = qParam ? Number(qParam.trim().slice(2)) : 1;
    return [name.trim(), Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
  }));
}

function preferredEncoding(header) {
  const quality = encodingPreferences(header);
  return [
    { name: 'br' },
    { name: 'gzip' },
  ].map(option => ({ ...option, q: quality.get(option.name) ?? quality.get('*') ?? 0 }))
    .filter(option => option.q > 0)
    .sort((a, b) => b.q - a.q)[0]?.name || null;
}

function compressBuffer(body, encoding) {
  if (encoding === 'br') {
    return brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 } });
  }
  if (encoding === 'gzip') return gzipSync(body);
  return body;
}

function cachedCompress(key, body, encoding) {
  const cacheKey = `${key}|${encoding}`;
  const hit = runtimeCache.get(cacheKey);
  if (hit) return hit;
  const compressed = compressBuffer(body, encoding);
  if (runtimeCache.size > 40) runtimeCache.clear();
  runtimeCache.set(cacheKey, compressed);
  return compressed;
}

// Sidecars are generated at build time: no compression CPU cost on the VM.
function selectEncoding(header, filePath) {
  const quality = encodingPreferences(header);
  return [
    { name: 'br', suffix: '.br' },
    { name: 'gzip', suffix: '.gz' },
  ].map(option => ({ ...option, q: quality.get(option.name) ?? quality.get('*') ?? 0 }))
    .filter(option => option.q > 0 && fs.existsSync(filePath + option.suffix))
    .sort((a, b) => b.q - a.q)[0];
}

function writePayload(req, res, payload, { contentType, cacheControl, encoding }) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': payload.length,
    'Cache-Control': cacheControl,
    'Vary': 'Accept-Encoding',
    ...(encoding ? { 'Content-Encoding': encoding } : {}),
  });
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  res.end(payload);
  return true;
}

function sendBody(req, res, body, { contentType, cacheControl }) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const encoding = buffer.length >= 1024 && COMPRESSIBLE.test(contentType)
    ? preferredEncoding(req.headers['accept-encoding'])
    : null;
  const payload = encoding ? compressBuffer(buffer, encoding) : buffer;
  return writePayload(req, res, payload, { contentType, cacheControl, encoding });
}

function serveStaticFile(req, res, filePath, mime, isHtml) {
  try {
    const encoding = isHtml ? null : selectEncoding(req.headers['accept-encoding'], filePath);
    const actualPath = encoding ? filePath + encoding.suffix : filePath;
    const stat = fs.statSync(actualPath);
    if (!encoding && COMPRESSIBLE.test(mime) && stat.size >= 1024 && stat.size <= RUNTIME_MAX_BYTES) {
      const runtimeEncoding = preferredEncoding(req.headers['accept-encoding']);
      if (runtimeEncoding) {
        const compressed = cachedCompress(`${filePath}:${stat.mtimeMs}`, fs.readFileSync(actualPath), runtimeEncoding);
        return writePayload(req, res, compressed, {
          contentType: mime,
          cacheControl: isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
          encoding: runtimeEncoding,
        });
      }
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=31536000, immutable',
      'Vary': 'Accept-Encoding',
      ...(encoding ? { 'Content-Encoding': encoding.name } : {}),
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    const stream = fs.createReadStream(actualPath);
    stream.on('error', error => {
      console.error('[Static] Stream error:', error.message);
      res.destroy(error);
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
    return true;
  } catch (error) {
    console.error('[Static] File serve error:', error.message, filePath);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
    return false;
  }
}

module.exports = { serveStaticFile, selectEncoding, sendBody, preferredEncoding };
