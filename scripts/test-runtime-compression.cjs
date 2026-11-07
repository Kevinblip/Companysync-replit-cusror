'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const { sendBody, serveStaticFile } = require('../lib/static-file.cjs');

async function request(server, headers, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: '/',
      method,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const html = `<!doctype html><title>${'CompanySync '.repeat(120)}</title>`;
  const direct = http.createServer((req, res) => sendBody(req, res, html, {
    contentType: 'text/html; charset=utf-8',
    cacheControl: 'no-cache',
  }));
  await new Promise((resolve) => direct.listen(0, '127.0.0.1', resolve));
  try {
    const gzipped = await request(direct, { 'Accept-Encoding': 'gzip' });
    assert.equal(gzipped.headers['content-encoding'], 'gzip');
    assert.equal(zlib.gunzipSync(gzipped.body).toString(), html);
    assert.ok(gzipped.body.length < Buffer.byteLength(html));
    const identity = await request(direct, { 'Accept-Encoding': 'identity' });
    assert.equal(identity.headers['content-encoding'], undefined);
    assert.equal(identity.body.toString(), html);
    console.log(`PASS html gzip ${Buffer.byteLength(html)} -> ${gzipped.body.length}`);
  } finally {
    await new Promise((resolve) => direct.close(resolve));
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-static-'));
  const filePath = path.join(dir, 'app.js');
  fs.writeFileSync(filePath, `console.log(${JSON.stringify('x'.repeat(4000))});`);
  const fileServer = http.createServer((req, res) => serveStaticFile(req, res, filePath, 'application/javascript', false));
  await new Promise((resolve) => fileServer.listen(0, '127.0.0.1', resolve));
  try {
    const brotli = await request(fileServer, { 'Accept-Encoding': 'br, gzip' });
    assert.equal(brotli.headers['content-encoding'], 'br');
    assert.equal(zlib.brotliDecompressSync(brotli.body).toString(), fs.readFileSync(filePath, 'utf8'));
    assert.ok(!fs.existsSync(filePath + '.br'));
    console.log(`PASS runtime brotli without sidecar ${fs.statSync(filePath).size} -> ${brotli.body.length}`);
  } finally {
    await new Promise((resolve) => fileServer.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});