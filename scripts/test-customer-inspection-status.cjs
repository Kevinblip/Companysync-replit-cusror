const assert = require('node:assert/strict');
const { test } = require('node:test');
const helpers = import('../src/utils/customerInspectionStatus.js');

test('completed jobs and manual marks both count as inspected', async () => {
  const { isCustomerInspected } = await helpers;
  assert.equal(isCustomerInspected({}, null), false);
  assert.equal(isCustomerInspected({}, { status: 'scheduled' }), false);
  assert.equal(isCustomerInspected({}, { status: 'completed' }), true);
  assert.equal(isCustomerInspected({ manual_inspected_date: '2026-09-01' }, null), true);
  assert.equal(isCustomerInspected({ manual_inspected_date: 'null' }, null), false);
});

test('selected customers are updated by ID without creating inspection jobs', async () => {
  const { saveCustomerInspectionMarks } = await helpers;
  const writes = [];
  const result = await saveCustomerInspectionMarks({
    customers: [{ id: 'a', name: 'Same Name' }, { id: 'b', name: 'Same Name' }, { id: 'a' }],
    date: '2026-09-01', email: 'staff@example.test',
    update: async (id, data) => writes.push({ id, data }),
  });
  assert.equal(result.successCount, 2);
  assert.deepEqual(writes.map(row => row.id).sort(), ['a', 'b']);
  assert.deepEqual(writes[0].data, { manual_inspected_date: '2026-09-01', manual_inspected_by: 'staff@example.test' });
});

test('failed updates are identified for retry, not reported as saved', async () => {
  const { saveCustomerInspectionMarks } = await helpers;
  const result = await saveCustomerInspectionMarks({
    customers: [{ id: 'a' }, { id: 'b' }], date: '2026-09-01', email: 'staff@example.test',
    update: async id => { if (id === 'b') throw new Error('Permission denied'); },
  });
  assert.equal(result.successCount, 1);
  assert.equal(result.failed[0].customer.id, 'b');
  assert.equal(result.failed[0].error, 'Permission denied');
});

test('invalid and future dates cause no writes', async () => {
  const { saveCustomerInspectionMarks } = await helpers;
  for (const date of ['', '2026-02-30', '2999-01-01']) {
    let writes = 0;
    await assert.rejects(saveCustomerInspectionMarks({
      customers: [{ id: 'a' }], date, update: async () => { writes++; },
    }));
    assert.equal(writes, 0);
  }
});

test('clearing a manual mark preserves actual completed inspection evidence', async () => {
  const { saveCustomerInspectionMarks, isCustomerInspected } = await helpers;
  let saved;
  await saveCustomerInspectionMarks({ customers: [{ id: 'a' }], clear: true,
    update: async (_id, data) => { saved = data; },
  });
  assert.deepEqual(saved, { manual_inspected_date: null, manual_inspected_by: null });
  assert.equal(isCustomerInspected(saved, null), false);
  assert.equal(isCustomerInspected(saved, { status: 'completed' }), true);
});
