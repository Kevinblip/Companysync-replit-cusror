const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function distributeWorkflows() {
  console.log('📋 Distributing all custom workflows to all companies...\n');
  
  // Get all unique company IDs from workflows already in the database
  const allCompanies = await pool.query(
    "SELECT DISTINCT company_id FROM generic_entities WHERE entity_type = 'Workflow' ORDER BY company_id"
  );
  const allCompanyIds = allCompanies.rows.map(r => r.company_id);
  console.log('Found companies:', allCompanyIds, '\n');
  
  // Get all 33+ custom workflows (those with workflow_name starting with capital letter after wf_custom_)
  const customWorkflows = await pool.query(
    "SELECT data FROM generic_entities WHERE entity_type = 'Workflow' AND company_id = 'yicn_roofing_001' AND data->>'workflow_name' IS NOT NULL AND data->>'workflow_name' NOT IN ('New Lead Welcome', 'Estimate Accepted — Job Kickoff', 'Invoice Payment Reminder Sequence', 'Invoice Paid — Thank You + Review Request', 'Job Completed — Review & Referral Sequence', 'Lead No-Contact Escalation (48h)', 'Inspection Appointment Reminder', 'Cold Lead Re-Engagement (30 & 60 Day)', 'Storm Damage Lead Outreach') ORDER BY data->>'workflow_name'"
  );
  
  const allWorkflows = await pool.query(
    "SELECT data FROM generic_entities WHERE entity_type = 'Workflow' AND company_id = 'yicn_roofing_001' ORDER BY data->>'workflow_name'"
  );
  
  console.log('Total workflows in yicn_roofing_001:', allWorkflows.rows.length);
  console.log('Custom workflows to distribute:', customWorkflows.rows.length, '\n');
  
  let totalInserted = 0;
  
  for (const companyId of allCompanyIds) {
    let inserted = 0, skipped = 0;
    
    for (const row of allWorkflows.rows) {
      const wf = row.data;
      const safeName = wf.workflow_name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').substring(0, 40);
      const wfId = `wf_custom_${safeName}_${companyId}`;
      
      // Check if already exists
      const exists = await pool.query(
        "SELECT id FROM generic_entities WHERE id = $1",
        [wfId]
      );
      
      if (exists.rows.length > 0) {
        skipped++;
        continue;
      }
      
      const wfData = JSON.stringify({
        ...wf,
        id: wfId,
        company_id: companyId
      });
      
      await pool.query(
        'INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date) VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())',
        [wfId, 'Workflow', companyId, wfData]
      );
      inserted++;
    }
    
    console.log(`  ${companyId}: +${inserted} workflows`);
    totalInserted += inserted;
  }
  
  // Show final counts
  const final = await pool.query("SELECT company_id, COUNT(*) as count FROM generic_entities WHERE entity_type = 'Workflow' GROUP BY company_id ORDER BY company_id");
  console.log('\n📊 Final workflow counts:');
  let grand = 0;
  final.rows.forEach(r => { console.log(`  ${r.company_id}: ${r.count}`); grand += parseInt(r.count); });
  console.log(`  TOTAL: ${grand}`);
  console.log(`\n✅ Done! Distributed ${totalInserted} workflows`);
}

distributeWorkflows().then(() => pool.end()).catch(e => { console.error('❌', e.message); pool.end(); });
