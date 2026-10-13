'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { serveStaticFile, selectEncoding } = require('../lib/static-file.cjs');

async function main() {
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(asset, 'Built entry JavaScript must exist');
  const filePath = path.join(__dirname, '../dist', asset);
  const original = fs.readFileSync(filePath);
  assert.equal(selectEncoding('br;q=0,gzip;q=0', filePath), undefined);
  assert.equal(selectEncoding('gzip;q=1,br;q=0.5', filePath).name, 'gzip');
  const server = http.createServer((req, res) =>
    serveStaticFile(req, res, filePath, 'application/javascript', false));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = (encoding, method = 'GET') => new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: server.address().port, path: '/', method,
        headers: encoding ? { 'Accept-Encoding': encoding } : {},
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
    for (const encoding of [null, 'gzip', 'br', 'br;q=0,gzip;q=0']) {
      const result = await request(encoding);
      assert.equal(result.status, 200);
      const actualEncoding = result.headers['content-encoding'];
      const decoded = actualEncoding === 'br' ? zlib.brotliDecompressSync(result.body)
        : actualEncoding === 'gzip' ? zlib.gunzipSync(result.body) : result.body;
      assert.deepEqual(decoded, original);
      assert.equal(Number(result.headers['content-length']), result.body.length);
      assert.equal(result.headers.vary, 'Accept-Encoding');
      assert.ok(result.headers['cache-control'].includes('immutable'));
      if (encoding === 'br' || encoding === 'gzip') {
        assert.equal(actualEncoding, encoding);
        assert.ok(result.body.length < original.length / 2);
      } else assert.equal(actualEncoding, undefined);
      console.log(`PASS ${encoding || 'identity'}: ${result.body.length} bytes; decoded content identical`);
    }
    const head = await request('br', 'HEAD');
    assert.equal(head.headers['content-encoding'], 'br');
    assert.equal(head.body.length, 0);
    console.log('PASS HEAD: correct compression headers, no body');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
