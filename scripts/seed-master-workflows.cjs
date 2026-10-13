'use strict';
const { createPool } = require('./lib/db-pool.cjs');
const crypto = require('crypto');
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const MASTER_ID = '695944e3c1fb00b7ab716c6f';
const SOURCE_ID = 'yicn_roofing_001';

async function seed() {
  // Get all source workflows
  const { rows: source } = await pool.query(
    `SELECT id, data FROM generic_entities WHERE entity_type='Workflow' AND company_id=$1 ORDER BY created_date`,
    [SOURCE_ID]
  );

  // Get names already in master
  const { rows: existing } = await pool.query(
    `SELECT data->>'name' AS name FROM generic_entities WHERE entity_type='Workflow' AND company_id=$1`,
    [MASTER_ID]
  );
  const existingNames = new Set(existing.map(r => r.name));

  let added = 0;
  for (const row of source) {
    const d = row.data;
    if (existingNames.has(d.name)) continue;

    // Strip company-specific identity from the data payload
    const payload = {
      ...d,
      company_id: MASTER_ID,
      id: undefined,          // remove baked-in id
      created_by: 'platform', // mark as platform default
    };
    delete payload.id;

    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1, 'Workflow', $2, $3::jsonb, NOW(), NOW())`,
      [crypto.randomUUID(), MASTER_ID, JSON.stringify(payload)]
    );
    existingNames.add(d.name); // prevent dupes within same run
    added++;
    console.log(' ✓', d.name);
  }

  console.log(`\nWorkflows seeded to master: ${added} (${source.length - added} already existed)`);
  await pool.end();
}

seed().catch(e => { console.error(e.message); process.exit(1); });
