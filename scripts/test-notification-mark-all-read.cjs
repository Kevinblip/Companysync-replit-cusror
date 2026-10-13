const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('src/Layout.jsx', 'utf8');
const handlerStart = source.indexOf('const handleMarkAllAsRead = async () => {');
assert.notEqual(handlerStart, -1, 'mark-all-read handler exists');
const handlerEnd = source.indexOf('\n  };', handlerStart);
assert.notEqual(handlerEnd, -1, 'mark-all-read handler is closed');
const handler = source.slice(handlerStart, handlerEnd);

assert.match(handler, /Notification\.filter\([\s\S]*?10000/,
  'bulk action checks beyond the 100 notifications loaded in the bell');
assert.match(handler, /notification\.user_email === user\.email/,
  'only notifications for this user or company-wide notifications are changed');
assert.match(handler, /notification\.deferred_until/,
  'notifications that are not yet visible remain unread');
assert.match(handler, /Promise\.allSettled/,
  'one failed update does not stop the rest of the batch');
assert.match(handler, /successfullyReadIds\.add/,
  'successful updates are tracked separately from failures');
assert.match(handler, /queryClient\.invalidateQueries\(\{ queryKey: \['notifications', myCompany\.id\] \}\)/,
  'notification count and rows are refreshed after the bulk update');
assert.match(handler, /setNotificationsOpen\(false\)/,
  'the notification panel closes after successful completion');
assert.match(handler, /finally \{[\s\S]*?setIsMarkingAllRead\(false\)/,
  'the loading state resets after success or failure');

const buttonStart = source.indexOf('data-testid="button-mark-all-notifications-read"');
assert.notEqual(buttonStart, -1, 'mark-all-read button has a stable test id');
const buttonMarkup = source.slice(source.lastIndexOf('<Button', buttonStart), buttonStart + 200);
assert.match(buttonMarkup, /disabled=\{isMarkingAllRead\}/,
  'the button cannot start overlapping bulk updates');

console.log('Notification mark-all-read checks passed.');
