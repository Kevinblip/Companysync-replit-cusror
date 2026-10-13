const assert = require('assert');
const fs = require('fs');

const root = process.cwd();
const read = (file) => fs.readFileSync(`${root}/${file}`, 'utf8');

// The model must be told to label reminders, and every scheduling path that
// performs conflict checks must explicitly exempt only that non-blocking type.
const sharedPrompt = read('lib/lexiSystemPrompt.cjs');
assert.match(sharedPrompt, /event_type "reminder"/);
assert.match(sharedPrompt, /'reminder'/);

const nativeVoice = read('vite-lexi-native-plugin.js');
assert.match(nativeVoice, /const isReminder = String\(args\.event_type \|\| ''\).*=== 'reminder'/);
assert.match(nativeVoice, /isReminder \? null : await lexiCheckCalendarConflict/);

const browserChat = read('vite-functions-plugin.js');
assert.match(browserChat, /const isReminder = String\(calArgs\.event_type \|\| ''\).*=== 'reminder'/);
assert.match(browserChat, /isReminder \? null : await lexiCheckCalendarConflict/);

const productionVoice = read('prod-server.cjs');
assert.match(productionVoice, /const isReminder = String\(a\.event_type \|\| ''\).*=== 'reminder'/);
assert.match(productionVoice, /const conflict = isReminder\s*\? \{ rowCount: 0, rows: \[\] \}/);

console.log('Lexi reminder conflict regression checks passed.');