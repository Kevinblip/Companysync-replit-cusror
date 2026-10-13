#!/usr/bin/env node
/**
 * Double-booking conflict gate source parity check.
 *
 * The dev and production handlers each contain a copy of
 * checkCalendarBookingConflict. Keep the function bodies byte-for-byte
 * identical so a guard fix cannot land in only one server path.
 *
 * Usage: node scripts/test-double-booking-parity.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEV_FILE = path.join(PROJECT_ROOT, 'vite-db-plugin.js');
const PROD_FILE = path.join(PROJECT_ROOT, 'db', 'prod-db.cjs');
const FUNCTION_START = 'async function checkCalendarBookingConflict(pool, data, excludeId = null) {';
const FUNCTION_END = '\nfunction checkIntraPayloadCalendarConflict';

function extractConflictFunction(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const start = source.indexOf(FUNCTION_START);
  if (start === -1) {
    throw new Error(`Could not find checkCalendarBookingConflict in ${path.relative(PROJECT_ROOT, filePath)}`);
  }

  const end = source.indexOf(FUNCTION_END, start);
  if (end === -1) {
    throw new Error(`Could not find the end marker after checkCalendarBookingConflict in ${path.relative(PROJECT_ROOT, filePath)}`);
  }

  return source.slice(start, end);
}

function firstDifference(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let i = 0; i < limit; i++) {
    if (left[i] !== right[i]) return i;
  }
  return left.length === right.length ? -1 : limit;
}

try {
  const devFunction = extractConflictFunction(DEV_FILE);
  const prodFunction = extractConflictFunction(PROD_FILE);
  const difference = firstDifference(devFunction, prodFunction);

  if (difference !== -1) {
    const contextStart = Math.max(0, difference - 40);
    const contextEnd = difference + 80;
    console.error('✗ checkCalendarBookingConflict differs between dev and production handlers');
    console.error(`  First difference at byte ${difference}`);
    console.error(`  Dev:  ${JSON.stringify(devFunction.slice(contextStart, contextEnd))}`);
    console.error(`  Prod: ${JSON.stringify(prodFunction.slice(contextStart, contextEnd))}`);
    process.exit(1);
  }

  console.log('✓ checkCalendarBookingConflict is byte-for-byte identical in dev and production handlers');
} catch (err) {
  console.error(`✗ Double-booking parity check failed: ${err.message}`);
  process.exit(1);
}