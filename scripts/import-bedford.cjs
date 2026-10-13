'use strict';
const { createPool } = require('./lib/db-pool.cjs');
const fs = require('fs');
const crypto = require('crypto');

const pool = createPool({ connectionString: process.env.DATABASE_URL });
const companyId = 'loc_mmdvp1h5_e8i9eb';

const csv = fs.readFileSync('/home/runner/workspace/attached_assets/ParcelAddresses_(4)_1785320474767.csv', 'utf8');
const lines = csv.trim().split('\n');
const header = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase());
console.log('Columns:', header);

const colIdx = (names) => {
  for (const n of names) {
    const i = header.findIndex(h => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
};

const iParcel = colIdx(['parcel']);
const iOwner  = colIdx(['owner', 'deed']);
const iAddr   = colIdx(['address', 'addr']);
const iCity   = colIdx(['city']);
const iState  = colIdx(['state']);
const iZip    = colIdx(['zip']);

console.log(`Indices — parcel:${iParcel} owner:${iOwner} addr:${iAddr} city:${iCity} state:${iState} zip:${iZip}`);

function parseRow(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  cols.push(cur.trim());
  return cols;
}

async function run() {
  let inserted = 0, skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseRow(lines[i]);
    const parcel  = iParcel >= 0 ? cols[iParcel] : '';
    const owner   = iOwner  >= 0 ? cols[iOwner]  : '';
    const addr    = iAddr   >= 0 ? cols[iAddr]   : '';
    const city    = iCity   >= 0 ? cols[iCity]   : '';
    const state   = iState  >= 0 ? cols[iState]  : '';
    const zip     = iZip    >= 0 ? cols[iZip]    : '';

    const street = addr.trim();
    const fullAddr = [street, city, state].filter(Boolean).join(', ');
    if (!street && !owner) { skipped++; continue; }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const data = JSON.stringify({
      full_name: owner,
      address: fullAddr,
      street_address: street,
      city,
      state,
      zip_code: zip,
      parcel_number: parcel,
      source: 'property_data',
      import_batch: 'bedford-44146',
      created_date: now,
    });

    try {
      await pool.query(
        `INSERT INTO leads (id, company_id, name, address, street, city, state, zip, source, status, data, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'property_data','new',$9::jsonb,NOW(),NOW())
         ON CONFLICT DO NOTHING`,
        [id, companyId, owner, fullAddr, street, city, state, zip, data]
      );
      inserted++;
    } catch (e) {
      console.error(`Row ${i} error:`, e.message);
      skipped++;
    }
  }
  console.log(`Done: ${inserted} inserted, ${skipped} skipped`);
  await pool.end();
}
run().catch(e => { console.error(e); process.exit(1); });
