const assert = require('assert');
const { buildLexiToolFallback } = require('../lib/lexiToolFallback.cjs');

assert.equal(
  buildLexiToolFallback('find_subcontractors', {
    matched_count: 1,
    filter: { area: 'Lorain, Ohio' },
    subcontractors: [{ name: 'North Coast Roofing', specialty: 'Roofing', base_address: 'Lorain, OH' }],
  }),
  'I found 1 subcontractor in Lorain, Ohio: North Coast Roofing (Roofing — Lorain, OH).'
);

assert.equal(
  buildLexiToolFallback('find_subcontractors', {
    matched_count: 0,
    filter: { area: 'Lorain, Ohio' },
    subcontractors: [],
  }),
  "I couldn't find any subcontractors listed in Lorain, Ohio."
);

assert.equal(
  buildLexiToolFallback('find_subcontractors', {
    filter: { area: 'Lorain, Ohio' },
    subcontractors: [
      { name: 'A' }, { name: 'B' }, { name: 'C' },
      { name: 'D' }, { name: 'E' }, { name: 'F' },
    ],
  }),
  'I found 6 subcontractors in Lorain, Ohio: A; B; C; D; E. I found 1 more.'
);

console.log('Lexi tool fallback regression checks passed.');