const fs = require('fs');
const assert = require('assert');

for (const file of ['db/prod-integrations.cjs', 'vite-integrations-plugin.js']) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /const isDocumentAnalysis = fileUrls\.length > 0;/, `${file} should identify uploaded-document analysis`);
  assert.match(source, /timeoutMs: isDocumentAnalysis \? 150000 : 60000,\s*retries: isDocumentAnalysis \? 0 : 2/, `${file} should give documents one longer attempt instead of three short ones`);
  assert.match(source, /retryable: !timedOut/, `${file} should tell the browser not to duplicate a timed-out document request`);
}

console.log('Document AI timeout regression checks passed');