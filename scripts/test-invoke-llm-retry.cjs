const fs = require('fs');
const assert = require('assert');

const source = fs.readFileSync('src/api/base44Client.js', 'utf8');

assert.match(source, /const maxAttempts = 2;/, 'InvokeLLM should make at most two attempts');
assert.match(source, /status === 500[\s\S]*status === 502[\s\S]*status === 503[\s\S]*status === 504/, 'transient server failures should retry');
assert.match(source, /attempt < maxAttempts && transient/, 'only transient failures should be retried');
assert.match(source, /result\.response === undefined \|\| result\.response === null/, 'empty successful responses should be rejected');
assert.doesNotMatch(source, /status === 429[\s\S]{0,100}transient/, 'usage-limit responses must not be retried');
assert.match(source, /err\.retryable !== false/, 'server-declared non-retryable failures should not repeat');

console.log('InvokeLLM retry regression checks passed');