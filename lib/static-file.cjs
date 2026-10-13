'use strict';
const fs = require('node:fs');

// Sidecars are generated at build time: no compression CPU cost on the VM.
function selectEncoding(header, filePath) {
  const quality = new Map(String(header || '').toLowerCase().split(',').filter(Boolean).map(value => {
    const [name, ...params] = value.trim().split(';');
    const qParam = params.find(param => param.trim().startsWith('q='));
    const q = qParam ? Number(qParam.trim().slice(2)) : 1;
    return [name.trim(), Number.isFinite(q) && q >= 0 && q <= 1 ? q : 0];
  }));
  return [
    { name: 'br', suffix: '.br' },
    { name: 'gzip', suffix: '.gz' },
  ].map(option => ({ ...option, q: quality.get(option.name) ?? quality.get('*') ?? 0 }))
    .filter(option => option.q > 0 && fs.existsSync(filePath + option.suffix))
    .sort((a, b) => b.q - a.q)[0];
}

function serveStaticFile(req, res, filePath, mime, isHtml) {
  try {
    const encoding = isHtml ? null : selectEncoding(req.headers['accept-encoding'], filePath);
    const actualPath = encoding ? filePath + encoding.suffix : filePath;
    const stat = fs.statSync(actualPath);
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

module.exports = { serveStaticFile, selectEncoding };
