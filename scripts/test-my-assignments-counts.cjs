#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const layout = fs.readFileSync(path.join(__dirname, '..', 'src', 'Layout.jsx'), 'utf8');
let failed = 0;

function expect(name, condition) {
  if (condition) console.log(`✓ ${name}`);
  else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

expect(
  'sidebar loads assignments for the active company',
  /queryKey: \["sidebar-my-assignments-customers", _badgeEmail, _badgeCompanyId\]/.test(layout) &&
    /base44\.entities\.Customer\.filter\(filters, "-created_date", 500\)/.test(layout)
);
expect(
  'sidebar customer query accepts email or staff name assignments',
  /filters\.assigned_to = \{ \$in: \[_badgeEmail, _badgeName\] \}/.test(layout)
);
expect(
  'sidebar total includes open customer assignments',
  /const openCustomers = sidebarCustomers\.filter\(c => !\["completed", "inactive", "closed"\]\.includes\(c\.status\)\)\.length/.test(layout) &&
    /openTasks \+ openLeads \+ openCustomers \+ openProjects/.test(layout)
);

console.log(`\n${3 - failed}/3 assertions passed`);
process.exit(failed ? 1 : 0);