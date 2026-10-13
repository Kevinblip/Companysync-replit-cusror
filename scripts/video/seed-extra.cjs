// Adds demo data for the 7 additional training-video topics on top of the base
// seed-demo.cjs data. Does NOT wipe existing demo company data — only adds/updates.
// Idempotent: deletes its own rows by a marker tag before re-inserting.
const crypto = require('crypto');
const { createPool } = require('../lib/db-pool.cjs');
const pool = createPool({ connectionString: process.env.DATABASE_URL });

const COMPANY_ID = 'loc_demo_video_001';
const uid = () => crypto.randomUUID();
const daysAgo = (n) => new Date(Date.now() - n * 864e5);

async function main() {
  // --- Clear previously-seeded extras (idempotent) ---
  await pool.query(
    `DELETE FROM generic_entities WHERE company_id=$1 AND entity_type IN ('CommissionRule','Workflow','Contract','ContractTemplate')`,
    [COMPANY_ID]
  );
  await pool.query(`DELETE FROM staff_profiles WHERE company_id=$1 AND user_email LIKE '%@summitpeakroofing.com' AND user_email != 'demo@summitpeakroofing.com'`, [COMPANY_ID]);

  // --- Staff Management: extra team members with roles ---
  const staff = [
    ['Casey Rivera', 'casey.rivera@summitpeakroofing.com', 'sales_rep', 8, false],
    ['Miguel Torres', 'miguel.torres@summitpeakroofing.com', 'crew_lead', 0, false],
    ['Dana Whitfield', 'dana.whitfield@summitpeakroofing.com', 'office_admin', 0, true],
  ];
  for (const [full_name, user_email, role, commission_rate, is_administrator] of staff) {
    await pool.query(
      `INSERT INTO staff_profiles (id, company_id, email, user_email, name, full_name, role, commission_rate, is_administrator, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$3,$4,$4,$5,$6,$7,true,NOW(),NOW())`,
      [uid(), COMPANY_ID, user_email, full_name, role, commission_rate, is_administrator]
    );
  }

  // --- Commission rules ---
  const rules = [
    {
      rule_name: 'Standard Sales Commission',
      description: 'Base commission for all closed residential roof sales.',
      base_rate_percentage: 8,
      applies_to_staff_email: 'casey.rivera@summitpeakroofing.com',
      priority: 1,
      is_active: true,
      tiered_rates: [
        { threshold_amount: 20000, rate_percentage: 8 },
        { threshold_amount: 50000, rate_percentage: 10 },
      ],
    },
    {
      rule_name: 'Commercial Deal Bonus',
      description: 'Higher rate for commercial contracts over $50k.',
      base_rate_percentage: 6,
      min_deal_amount: 50000,
      priority: 2,
      is_active: true,
      tiered_rates: [{ threshold_amount: 50000, rate_percentage: 6 }],
    },
  ];
  for (const r of rules) {
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1,'CommissionRule',$2,$3,NOW(),NOW())`,
      [uid(), COMPANY_ID, JSON.stringify(r)]
    );
  }

  // Give existing invoices a sale_agent + commission_splits so CommissionTracking has rows
  await pool.query(
    `UPDATE invoices SET sale_agent=$1 WHERE company_id=$2`,
    ['casey.rivera@summitpeakroofing.com', COMPANY_ID]
  );

  // --- Workflow automation ---
  const workflow = {
    workflow_name: 'New Estimate Follow-Up',
    description: 'Automatically follows up with customers after an estimate is sent.',
    trigger_type: 'estimate_created',
    is_active: true,
    execution_count: 14,
    folder: 'Sales',
    tags: ['estimates', 'follow-up'],
    actions: [
      { action_type: 'send_email', delay_minutes: 0, recipient: 'customer', template: 'Estimate Sent' },
      { action_type: 'create_task', delay_minutes: 2880, recipient: 'assigned_rep', template: 'Follow up on estimate' },
      { action_type: 'send_sms', delay_minutes: 4320, recipient: 'customer', template: 'Estimate reminder' },
    ],
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1,'Workflow',$2,$3,NOW(),NOW())`,
    [uid(), COMPANY_ID, JSON.stringify(workflow)]
  );

  // --- Contracts & e-signing ---
  // Hayes contract is SIGNED so the Contracts topic screenshot shows a real signed state.
  const contracts = [
    {
      contract_name: 'Roof Replacement Agreement — Hayes Residence',
      customer_name: 'Robert & Linda Hayes',
      status: 'signed',
      contract_type: 'residential',
      value: 18690,
      start_date: '2026-06-08',
      signed_at: new Date(Date.now() - 5 * 864e5).toISOString(),
      signer_name: 'Linda Hayes',
      signer_email: 'hayes.family@example.com',
      signed_ip: '72.14.92.1',
    },
    { contract_name: 'Multi-Building Roof Contract — Grandview HOA', customer_name: 'Grandview HOA', status: 'draft', contract_type: 'commercial', value: 128400, start_date: '2026-07-01' },
    { contract_name: 'Storm Repair Agreement — Nathan Brooks', customer_name: 'Nathan Brooks', status: 'expired', contract_type: 'residential', value: 15600, start_date: '2026-04-02', end_date: '2026-06-02' },
    { contract_name: 'Grandview HOA — Phase 2 Addendum', customer_name: 'Grandview HOA', status: 'sent', contract_type: 'commercial', value: 64000, start_date: '2026-08-01' },
  ];
  for (const c of contracts) {
    await pool.query(
      `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
       VALUES ($1,'Contract',$2,$3,NOW(),NOW())`,
      [uid(), COMPANY_ID, JSON.stringify(c)]
    );
  }

  const template = {
    template_name: 'Standard Residential Roofing Contract',
    description: 'Default agreement for residential roof replacement and repair jobs.',
    is_active: true,
    category: 'residential',
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1,'ContractTemplate',$2,$3,NOW(),NOW())`,
    [uid(), COMPANY_ID, JSON.stringify(template)]
  );

  // --- Completed invoice + payment for Hayes (supplements base seed-demo paid invoice) ---
  // seed-demo already seeds INV-2087 as 'paid'; add a second completed invoice for Franklin
  // so the Invoices/QuickBooks topics show multiple fully-paid rows.
  {
    const franklinId = await pool.query(`SELECT id FROM customers WHERE company_id=$1 AND name LIKE '%Franklin%' LIMIT 1`, [COMPANY_ID]);
    if (franklinId.rows.length) {
      const custId = franklinId.rows[0].id;
      const invId = uid();
      const paid = 63200;
      await pool.query(
        `INSERT INTO invoices (id, company_id, customer_id, customer_name, customer_email, invoice_number, status, total_amount, amount_paid, issue_date, due_date, items, created_at, updated_at)
         VALUES ($1,$2,$3,'Franklin Auto Group','facilities@franklinauto.example.com','INV-2090','paid',$4,$4,$5,$6,$7,$8,$8)
         ON CONFLICT (id) DO NOTHING`,
        [invId, COMPANY_ID, custId, paid, new Date(Date.now()-20*864e5).toISOString().slice(0,10), new Date(Date.now()-5*864e5).toISOString().slice(0,10), JSON.stringify([{code:'COM-FLAT',line:1,description:'Commercial flat roof recoat',quantity:1,unit:'LS',rate:paid,amount:paid}]), new Date(Date.now()-20*864e5)]
      );
      await pool.query(
        `INSERT INTO payments (id, company_id, invoice_id, invoice_number, customer_name, customer_id, amount, payment_method, payment_date, status, created_at, updated_at)
         VALUES ($1,$2,$3,'INV-2090','Franklin Auto Group',$4,$5,'check',$6,'completed',$6,$6)
         ON CONFLICT (id) DO NOTHING`,
        [uid(), COMPANY_ID, invId, custId, paid, new Date(Date.now()-18*864e5)]
      );
    }
  }

  // --- AI Estimator result (so AIEstimator beats show populated measurement data) ---
  await pool.query(
    `DELETE FROM generic_entities WHERE company_id=$1 AND entity_type='AIEstimatorResult'`,
    [COMPANY_ID]
  );
  const aiResult = {
    address: '330 Aspen Meadow Dr, Boulder, CO 80301',
    customer_name: 'Robert & Linda Hayes',
    status: 'complete',
    completed_at: new Date(Date.now() - 3 * 864e5).toISOString(),
    roof_area_sq: 28,
    pitch: '6/12',
    stories: 2,
    total_facets: 6,
    waste_factor_pct: 12,
    suggested_estimate_total: 18690,
    line_items: [
      { code: 'RFG-ARCH', description: 'Architectural asphalt shingles — 30yr', quantity: 28, unit: 'SQ', rate: 385, amount: 10780 },
      { code: 'RFG-TEAR', description: 'Tear-off & disposal (existing layer)', quantity: 28, unit: 'SQ', rate: 95, amount: 2660 },
      { code: 'RFG-UNDL', description: 'Synthetic underlayment', quantity: 28, unit: 'SQ', rate: 42, amount: 1176 },
      { code: 'RFG-DRIP', description: 'Drip edge (aluminum)', quantity: 336, unit: 'LF', rate: 3.2, amount: 1075 },
      { code: 'RFG-RIDGE', description: 'Ridge cap shingles', quantity: 28, unit: 'LF', rate: 5.5, amount: 154 },
      { code: 'RFG-FLASH', description: 'Step flashing & counter-flashing', quantity: 1, unit: 'LS', rate: 845, amount: 845 },
      { code: 'RFG-HAUL', description: 'Dumpster & haul-away', quantity: 1, unit: 'LS', rate: 650, amount: 650 },
    ],
    solar_data: {
      building_insights: { roofSegmentStats: [{ pitchDegrees: 26.6, azimuthDegrees: 180, stats: { areaMeters2: 145 } }, { pitchDegrees: 26.6, azimuthDegrees: 0, stats: { areaMeters2: 135 } }] },
    },
    notes: 'Satellite measurement via Google Solar API. Waste factor 12% applied for complex hip/valley geometry.',
  };
  await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1,'AIEstimatorResult',$2,$3,NOW(),NOW())`,
    [uid(), COMPANY_ID, JSON.stringify(aiResult)]
  );

  // --- Build Schedule deep-dive: add scope-of-work checklist to the Hayes build ---
  const { rows } = await pool.query(
    `SELECT id, data FROM generic_entities WHERE company_id=$1 AND entity_type='BuildSchedule' AND data->>'customer_name' = 'Robert & Linda Hayes' LIMIT 1`,
    [COMPANY_ID]
  );
  if (rows.length) {
    const data = rows[0].data;
    data.scope_of_work = [
      { id: uid(), description: 'Deliver dumpster & materials to site', completed: true, source: 'manual' },
      { id: uid(), description: 'Tear off existing shingles (2 layers)', completed: true, source: 'estimate_line' },
      { id: uid(), description: 'Install synthetic underlayment', completed: false, source: 'estimate_line' },
      { id: uid(), description: 'Install architectural shingles — 30yr', completed: false, source: 'estimate_line' },
      { id: uid(), description: 'Install drip edge & flashing', completed: false, source: 'estimate_line' },
      { id: uid(), description: 'Final cleanup & magnetic sweep', completed: false, source: 'manual' },
      { id: uid(), description: 'Customer walkthrough & sign-off', completed: false, source: 'manual' },
    ];
    await pool.query(`UPDATE generic_entities SET data=$1, updated_date=NOW() WHERE id=$2`, [JSON.stringify(data), rows[0].id]);
  }

  console.log('Seeded extra demo data for 7 topic videos.');
}

main().catch((e) => { console.error('SEED-EXTRA FAILED:', e); process.exit(1); }).finally(() => pool.end());
