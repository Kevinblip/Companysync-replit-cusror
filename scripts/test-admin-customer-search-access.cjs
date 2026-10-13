#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'components', 'hooks', 'useRoleBasedData.jsx'),
  'utf8',
);

let failed = 0;
function expect(name, condition) {
  if (condition) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

expect(
  'administrator access uses the explicit administrator flag or owner status',
  /myStaffProfile\?\.is_administrator === true[\s\S]*user\?\.is_administrator === true[\s\S]*isOwner/.test(source),
);
expect(
  'a profile role label does not grant administrative customer access',
  !/normalizedStaffRole|isAdminRole/.test(source),
);
expect(
  'customer filtering uses the corrected administrative access flag',
  /if \(isAdmin\) return allCustomers;/.test(source),
);

console.log(`\n${3 - failed}/3 assertions passed`);
process.exit(failed ? 1 : 0);