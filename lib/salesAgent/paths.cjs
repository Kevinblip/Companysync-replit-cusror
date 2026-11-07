'use strict';

const fs = require('fs');
const path = require('path');

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function repoFile(rel) {
  return firstExisting([
    path.join(__dirname, '..', '..', rel),
    path.join(__dirname, '..', '..', '..', rel),
    path.join(process.cwd(), rel),
  ]);
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(repoFile(rel), 'utf8'));
}

function dataDir() {
  const dir = process.env.SALES_AGENT_DATA_DIR
    || path.join(process.cwd(), 'data', 'sales-agent');
  return dir;
}

module.exports = { repoFile, readJson, dataDir };
