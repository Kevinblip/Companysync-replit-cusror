const assert = require('assert');
const fs = require('fs');

const source = fs.readFileSync('src/pages/AIAssistant.jsx', 'utf8');

assert.match(
  source,
  /const interruptLexi[\s\S]*?currentRequestIdRef\.current \+= 1;[\s\S]*?isSubmittingRef\.current = false;/,
  'interrupting Lexi must invalidate the old request and release the composer lock'
);
assert.match(
  source,
  /let requestId = null;[\s\S]*?finally \{[\s\S]*?isSubmittingRef\.current = false;/,
  'all active Lexi request exits, including confirmation prompts, must release the composer lock'
);
assert.match(
  source,
  /currentRequestIdRef\.current === requestId/,
  'an older request must not clear a newer request’s loading state'
);

console.log('PASS: Lexi conversation recovery — interrupt and confirmation paths release the composer');