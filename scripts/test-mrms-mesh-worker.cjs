#!/usr/bin/env node
'use strict';

// Offline regression for the worker's compressed-download and cached-GRIB
// paths. Never touches the live MRMS cache or calls NOAA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Worker } = require('node:worker_threads');
const { PNG } = require('pngjs');
let mesh;

const workerPath = path.join(__dirname, '../db/mrms-mesh-worker.cjs');

function section(number, length) {
  const buf = Buffer.alloc(length);
  buf.writeUInt32BE(length, 0);
  buf[4] = number;
  return buf;
}

function fixture() {
  const png = new PNG({ width: 2, height: 2 });
  for (const [index, value] of [0, 25, 50, 75].entries()) {
    png.data.set([value, value, value, 255], index * 4);
  }
  const pngBytes = PNG.sync.write(png);
  const identification = section(1, 21);
  identification.writeUInt16BE(2026, 12);
  identification[14] = 9;
  identification[15] = 29;
  identification[16] = 12;
  const grid = section(3, 72);
  grid.writeUInt16BE(0, 12);
  grid.writeUInt32BE(2, 30);
  grid.writeUInt32BE(2, 34);
  grid.writeInt32BE(40_000_000, 46);
  grid.writeUInt32BE(280_000_000, 50);
  grid.writeUInt32BE(1_000_000, 63);
  grid.writeUInt32BE(1_000_000, 67);
  const packing = section(5, 20);
  packing.writeUInt16BE(41, 9);
  packing[19] = 8;
  const values = section(7, 5 + pngBytes.length);
  pngBytes.copy(values, 5);
  const header = Buffer.alloc(16);
  header.write('GRIB');
  header[7] = 2;
  const parts = [header, identification, grid, packing, values, Buffer.from('7777')];
  header.writeBigUInt64BE(BigInt(parts.reduce((sum, part) => sum + part.length, 0)), 8);
  return Buffer.concat(parts);
}

function decode(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, {
      workerData,
      transferList: workerData.compressed ? [workerData.compressed] : [],
    });
    let settled = false;
    const finish = (error, grid) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(grid);
    };
    worker.once('message', ({ grid, error }) =>
      error ? finish(new Error(error)) : finish(null, grid));
    worker.once('error', (error) => finish(error));
    worker.once('exit', (code) => {
      if (!settled) finish(new Error(`worker exited before replying (${code})`));
    });
  });
}

function assertGrid(grid) {
  assert.equal(grid.ni, 2);
  assert.equal(grid.nj, 2);
  assert.deepEqual([...grid.data], [0, 25, 50, 75]);
  assert.equal(grid.validTime, '2026-09-29T12:00:00.000Z');
  assert.equal(mesh.sampleGrid(grid, 40, -80), 0);
  assert.ok(Math.abs(mesh.sampleGrid(grid, 39, -79) - 75 / 25.4) < 1e-9);
}

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mrms-worker-test-'));
  const cachePath = path.join(tmpDir, 'grid.grib2');
  const moduleCachePath = path.join(tmpDir, 'module-cache.grib2');
  const previousEnv = { nodeEnv: process.env.NODE_ENV, cachePath: process.env.MRMS_TEST_CACHE_PATH };
  try {
    process.env.NODE_ENV = 'test';
    process.env.MRMS_TEST_CACHE_PATH = moduleCachePath;
    const modulePath = require.resolve('../db/mrms-mesh.cjs');
    const loadFreshMesh = () => {
      delete require.cache[modulePath];
      return require(modulePath);
    };
    mesh = loadFreshMesh();
    const raw = fixture();
    assertGrid(mesh.parseGrib2(raw));
    const gz = zlib.gzipSync(raw);
    const compressed = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
    assertGrid(await decode({ compressed, cachePath }));
    assert.deepEqual(fs.readFileSync(cachePath), raw);
    assertGrid(await decode({ cachedPath: cachePath, cachePath }));
    await assert.rejects(
      decode({ cachedPath: path.join(tmpDir, 'missing.grib2'), cachePath }),
      /ENOENT/
    );
    const invalid = Buffer.from(raw);
    invalid.writeUInt32BE(40_000_000, 16 + 21 + 30);
    const invalidGz = zlib.gzipSync(invalid);
    await assert.rejects(
      decode({
        compressed: invalidGz.buffer.slice(invalidGz.byteOffset, invalidGz.byteOffset + invalidGz.byteLength),
        cachePath,
      }),
      /grid dimensions exceed supported limit/
    );
    assert.deepEqual(fs.readFileSync(cachePath), raw, 'an invalid feed must not replace the last good cache');

    let fetches = 0;
    const compressedFixture = zlib.gzipSync(raw);
    global.fetch = async () => {
      fetches += 1;
      return {
        ok: true,
        headers: new Map(),
        arrayBuffer: async () => compressedFixture.buffer.slice(
          compressedFixture.byteOffset, compressedFixture.byteOffset + compressedFixture.byteLength),
      };
    };
    const [first, concurrent] = await Promise.all([mesh.getMeshGrid(), mesh.getMeshGrid()]);
    assert.strictEqual(first, concurrent, 'simultaneous refreshes must share one decode');
    assertGrid(first);
    assert.equal(fetches, 1);
    assert.deepEqual(fs.readFileSync(moduleCachePath), raw);

    const oldDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    fs.utimesSync(moduleCachePath, oldDate, oldDate);
    fetches = 0;
    global.fetch = async () => { fetches += 1; throw new Error('offline test'); };
    const offlineMesh = loadFreshMesh();
    const fallback = await offlineMesh.getMeshGrid();
    assertGrid(fallback);
    assert.ok(Math.abs(fallback.fetchedAt - oldDate.getTime()) < 1000,
      'disk fallback must retain the original cache age');
    assert.strictEqual(await offlineMesh.getMeshGrid(), fallback);
    assert.equal(fetches, 1, 'download failure must back off instead of repeatedly decoding the fallback');

    const badFeedMesh = loadFreshMesh();
    const badGz = zlib.gzipSync(Buffer.from('invalid'));
    global.fetch = async () => ({
      ok: true,
      headers: new Map(),
      arrayBuffer: async () => badGz.buffer.slice(badGz.byteOffset, badGz.byteOffset + badGz.byteLength),
    });
    assert.equal(await badFeedMesh.getMeshGrid(), null);
    assert.deepEqual(fs.readFileSync(moduleCachePath), raw, 'a bad decode must keep the last good cache');

    const expired = new Date(Date.now() - 4 * 60 * 60 * 1000);
    fs.utimesSync(moduleCachePath, expired, expired);
    global.fetch = async () => { throw new Error('offline test'); };
    assert.equal(await loadFreshMesh().getMeshGrid(), null, 'expired disk cache must not be served');
    console.log('MRMS worker decode, refresh, cache age, and failure paths passed');
  } finally {
    if (previousEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv.nodeEnv;
    if (previousEnv.cachePath === undefined) delete process.env.MRMS_TEST_CACHE_PATH;
    else process.env.MRMS_TEST_CACHE_PATH = previousEnv.cachePath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});