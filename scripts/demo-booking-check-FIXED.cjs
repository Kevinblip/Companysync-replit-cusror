/**
 * DEMO SCRIPT — Booking Conflict Checker (FIXED)
 * Run: node scripts/demo-booking-check-FIXED.cjs
 */

const { createPool } = require('./lib/db-pool.cjs');

const pool = createPool({ connectionString: process.env.DATABASE_URL });

async function checkUpcomingConflicts(companyId) {
  // FIX: corrected 'start_tim' → 'start_time'
  const result = await pool.query(`
    SELECT
      a.id         AS event_a,
      b.id         AS event_b,
      a.assigned_to,
      a.start_time,
      a.end_time
    FROM calendar_events a
    JOIN calendar_events b
      ON a.assigned_to = b.assigned_to
      AND a.id <> b.id
      AND a.start_time < b.end_time
      AND a.end_time   > b.start_time
    WHERE a.company_id = $1
      AND COALESCE(a.status,'') NOT IN ('cancelled','tentative')
      AND COALESCE(b.status,'') NOT IN ('cancelled','tentative')
    LIMIT 10
  `, [companyId]);

  if (result.rows.length === 0) {
    console.log('✅ No double-bookings found.');
  } else {
    console.log(`⚠️  Found ${result.rows.length} conflict(s):`);
    result.rows.forEach(r => {
      console.log(`  ${r.assigned_to}: event ${r.event_a} overlaps ${r.event_b} at ${r.start_time}`);
    });
  }
}

checkUpcomingConflicts('loc_mmdvp1h5_e8i9eb')
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Error running conflict check:', err.message);
    process.exit(1);
  });
