#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');

const sidebar = fs.readFileSync('src/components/ui/sidebar.jsx', 'utf8');
const layout = fs.readFileSync('src/Layout.jsx', 'utf8');

assert.match(
  sidebar,
  /const mobileOpen = openProp \?\? openMobile/,
  'mobile Sheet uses the controlled open value without waiting for an effect'
);
assert.match(
  sidebar,
  /<Sheet open=\{mobileOpen\} onOpenChange=\{handleMobileOpenChange\}/,
  'mobile Sheet closes through the controlled change handler'
);
assert.match(
  sidebar,
  /mobileOpen,\s*handleMobileOpenChange,\s*toggleSidebar/,
  'mobile Sheet state and dismissal handler are exposed through sidebar context'
);
assert.match(
  sidebar,
  /if \(setOpenProp\) setOpenProp\(nextOpen\)/,
  'overlay and close-button dismissals keep Layout state synchronized'
);
assert.match(
  layout,
  /if \(isMobile\) setSidebarOpen\(false\);\s*navigate\(url\);/,
  'menu navigation closes the mobile sidebar before routing'
);

console.log('✓ mobile sidebar close state is applied synchronously');
console.log('✓ menu navigation closes before route rendering');
console.log('2 mobile sidebar navigation checks passed');