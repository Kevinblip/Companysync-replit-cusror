#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');

(async () => {
  const { photoSyncClientName, syncPhotoSyncClientNames } =
    await import('../src/utils/photoSyncCustomerName.js');
  const customer = { id: 'customer-1', company_id: 'company-1', name: 'Corrected Name' };
  const linked = { id: 'job-1', company_id: 'company-1', related_customer_id: 'customer-1', client_name: 'Old Name' };
  const otherCustomer = { ...linked, id: 'job-2', related_customer_id: 'customer-2' };
  const otherCompany = { ...linked, id: 'job-3', company_id: 'company-2' };
  const current = { ...linked, id: 'job-4', client_name: 'Corrected Name' };

  assert.equal(photoSyncClientName(linked, customer, 'company-1'), 'Corrected Name');
  assert.equal(photoSyncClientName(otherCustomer, customer, 'company-1'), 'Old Name');
  assert.equal(photoSyncClientName(otherCompany, customer, 'company-1'), 'Old Name');
  assert.equal(photoSyncClientName(linked, { ...customer, company_id: 'company-2' }, 'company-1'), 'Old Name');
  assert.equal(photoSyncClientName(linked, null, 'company-1'), 'Old Name');

  const writes = [];
  const entity = {
    filter: async (filter) => {
      assert.deepEqual(filter, { related_customer_id: customer.id, company_id: customer.company_id });
      return [linked, otherCustomer, otherCompany, current];
    },
    update: async (id, patch) => { writes.push({ id, patch }); },
  };
  assert.equal(await syncPhotoSyncClientNames(entity, customer, 'company-1'), 1);
  assert.deepEqual(writes, [{ id: 'job-1', patch: { client_name: 'Corrected Name' } }]);
  await assert.rejects(
    syncPhotoSyncClientNames(entity, customer, 'company-2'),
    /customer and company must be verified/,
  );
  await assert.rejects(
    syncPhotoSyncClientNames({
      filter: entity.filter,
      update: async () => { throw new Error('write failed'); },
    }, customer, 'company-1'),
    /linked PhotoSync job could not be updated/,
  );
  console.log('PhotoSync linked-customer name and tenant-scope checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });