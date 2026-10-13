#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

(async () => {
  const { getPhotoShareEmailOutcome } = await import('../src/utils/photoShareEmailOutcome.js');

  assert.deepEqual(
    getPhotoShareEmailOutcome({
      data: {
        success: true,
        id: 'provider-message-1',
        provider: 'postmark',
        deliveryStatus: 'submitted',
        communicationId: 'communication-1',
      },
    }),
    {
      status: 'submitted',
      provider: 'postmark',
      communicationId: 'communication-1',
    },
    'provider acceptance must not be described as delivery',
  );

  assert.equal(
    getPhotoShareEmailOutcome({ success: true, id: 'provider-message-2', deliveryStatus: 'delivered' }).status,
    'delivered',
  );
  assert.equal(
    getPhotoShareEmailOutcome({ success: false, error: 'Provider rejected the request' }).status,
    'not-sent',
  );
  assert.equal(
    getPhotoShareEmailOutcome({ success: false, skipped: true }).status,
    'not-sent',
  );
  assert.equal(
    getPhotoShareEmailOutcome({ success: true }).status,
    'unconfirmed',
    'a missing provider receipt must remain an unknown outcome',
  );
  assert.equal(
    getPhotoShareEmailOutcome({ success: true, id: 'provider-message-3', delivery_status: 'bounced' }).status,
    'not-sent',
  );

  console.log('PhotoSync email outcome checks passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});