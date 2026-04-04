'use strict';
/**
 * Import data from a base44 backup JSON file into the production database.
 * 
 * - Generates a deterministic ID for each record (sha256 of entity_type+data)
 *   so re-running is always safe (ON CONFLICT DO NOTHING).
 * - Never deletes or overwrites existing records.
 * 
 * Usage: node scripts/import-backup-json.cjs <path-to-backup.json>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const prodDb = require('../db/prod-db.cjs');

const backupPath = process.argv[2] || path.join(__dirname, '../attached_assets/april_4_2026_backup_2026-04-04_1775301639641.json');

console.log(`\n📂 Loading backup from: ${backupPath}`);
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
console.log(`✅ Backup loaded: "${backup.backup_name}" (${backup.total_records} total records)\n`);

function stableId(entityType, dataObj) {
  const stable = JSON.stringify(dataObj, Object.keys(dataObj).sort());
  return 'bk_' + crypto.createHash('sha256').update(entityType + '|' + stable).digest('hex').slice(0, 40);
}

async function run() {
  const pool = prodDb.getPool();
  const now = new Date().toISOString();
  const totals = { inserted: 0, skipped: 0 };

  const entityTypes = Object.keys(backup.backup_data).filter(t => backup.backup_data[t].length > 0);
  console.log(`📦 Entity types to import: ${entityTypes.join(', ')}\n`);

  for (const entityType of entityTypes) {
    const records = backup.backup_data[entityType];
    if (!records.length) continue;

    let typeInserted = 0;
    let typeSkipped = 0;
    const companyId = records[0]?.company_id || 'loc_mmdvp1h5_e8i9eb';

    for (const record of records) {
      const id = stableId(entityType, record);
      const recCompanyId = record.company_id || companyId;
      try {
        const result = await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id, entity_type) DO NOTHING`,
          [id, entityType, recCompanyId, JSON.stringify(record), now, now]
        );
        if (result.rowCount > 0) {
          typeInserted++;
          totals.inserted++;
        } else {
          typeSkipped++;
          totals.skipped++;
        }
      } catch (err) {
        console.warn(`  ⚠️  Error inserting ${entityType} record: ${err.message}`);
        typeSkipped++;
        totals.skipped++;
      }
    }

    const icon = typeInserted > 0 ? '✅' : '⏭️ ';
    console.log(`${icon} ${entityType.padEnd(28)} inserted: ${String(typeInserted).padStart(4)}  skipped: ${String(typeSkipped).padStart(4)}  (total: ${records.length})`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ IMPORT COMPLETE`);
  console.log(`   Inserted: ${totals.inserted}`);
  console.log(`   Skipped:  ${totals.skipped}`);
  console.log(`${'='.repeat(60)}\n`);

  await pool.end();
}

run().catch(err => {
  console.error('❌ Import failed:', err);
  process.exit(1);
});
