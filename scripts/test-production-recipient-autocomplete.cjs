const assert = require('node:assert/strict');

async function main() {
  const {
    findStaffRecipient,
    getStaffDisplayName,
    getStaffEmail,
    isValidRecipientEmail,
  } = await import('../src/utils/productionRecipient.js');

  const staff = [
    { full_name: 'Kevin Stone', user_email: 'kevin@example.com', is_active: true },
    { full_name: 'Inactive Rep', user_email: 'inactive@example.com', is_active: false },
    { first_name: 'Maria', last_name: 'Lopez', email: 'maria@example.com' },
  ];

  assert.equal(getStaffDisplayName(staff[0]), 'Kevin Stone');
  assert.equal(getStaffDisplayName(staff[2]), 'Maria Lopez');
  assert.equal(getStaffEmail(staff[0]), 'kevin@example.com');
  assert.equal(findStaffRecipient(staff, 'Kevin Stone')?.user_email, 'kevin@example.com');
  assert.equal(findStaffRecipient(staff, 'MARIA LOPEZ')?.email, 'maria@example.com');
  assert.equal(findStaffRecipient(staff, 'inactive@example.com'), null);
  assert.equal(findStaffRecipient(staff, 'unknown person'), null);
  assert.equal(isValidRecipientEmail('kevin@example.com'), true);
  assert.equal(isValidRecipientEmail('Kevin Stone'), false);

  console.log('Production recipient autocomplete checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});