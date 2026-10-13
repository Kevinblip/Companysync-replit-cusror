#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'vite-functions-plugin.js'), 'utf8');
const handlerStart = source.indexOf('functionHandlers.generateColorVisualizationPublic = async');
const handlerEnd = source.indexOf('functionHandlers.deleteColorVisualization = async', handlerStart);

assert.notEqual(handlerStart, -1, 'public color visualization handler must exist');
assert.notEqual(handlerEnd, -1, 'public color visualization handler boundary must exist');

const handler = source.slice(handlerStart, handlerEnd);
const refundHelper = handler.match(
  /const refundUsesRemaining = async \(\) => ([^;]+);/,
);
assert.ok(refundHelper, 'handler must calculate the remaining tries after a refund');

const buildRefundUsesRemaining = new Function(
  'usesRemaining',
  'decrementUse',
  `return async () => ${refundHelper[1]};`,
);

(async () => {
  const capBoundaryRefund = buildRefundUsesRemaining(0, async () => true);
  assert.equal(
    await capBoundaryRefund(),
    1,
    'a failed save after reserving the tenth try must restore one retry',
  );

  const failedRefund = buildRefundUsesRemaining(0, async () => false);
  assert.equal(
    await failedRefund(),
    0,
    'the response must not claim a retry was restored when the refund failed',
  );

  const saveBlock = handler.slice(handler.indexOf('const vizRecord ='));
  assert.equal(
    (saveBlock.match(/usesRemaining:\s*await refundUsesRemaining\(\)/g) || []).length,
    2,
    'both zero-row and thrown database save failures must return the refunded count',
  );
  assert.match(
    handler,
    /const result = await pool\.query\([\s\S]*?return result\.rowCount > 0;[\s\S]*?return false;/,
    'the refund helper must report whether the database counter was decremented',
  );

  console.log('PASS: failed homeowner color preview saves restore the reserved try');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});