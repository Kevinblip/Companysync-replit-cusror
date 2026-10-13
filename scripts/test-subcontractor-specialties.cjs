const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/utils/subcontractorSpecialties.js'), 'utf8');
  const { getSpecialtyOptions, DEFAULT_SUBCONTRACTOR_SPECIALTIES } = await import(
    `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  );
  assert.deepEqual(getSpecialtyOptions(), DEFAULT_SUBCONTRACTOR_SPECIALTIES);
  const saved = [{ specialty: ['Decks', ' roofing ', 'Concrete   Work', null] }, { specialty: ['decks', '', 5] }];
  assert.deepEqual(
    getSpecialtyOptions(saved, ['Fencing', 'CONCRETE WORK']).slice(DEFAULT_SUBCONTRACTOR_SPECIALTIES.length),
    ['Decks', 'Concrete Work', 'Fencing']
  );
  assert.ok(getSpecialtyOptions([{ specialty: ['Decks'] }]).includes('Decks'), 'saved categories must survive reopening');
  assert.ok(!getSpecialtyOptions([{ specialty: ['Fencing'] }]).includes('Decks'), 'another company must not inherit custom categories');
  assert.deepEqual(getSpecialtyOptions([{ specialty: null }, {}], null), DEFAULT_SUBCONTRACTOR_SPECIALTIES);
  console.log('PASS: defaults, custom categories, duplicate normalization, reopening, and company isolation');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});