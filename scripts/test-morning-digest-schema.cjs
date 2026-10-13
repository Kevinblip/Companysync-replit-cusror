#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const plugin = fs.readFileSync(path.join(root, 'vite-functions-plugin.js'), 'utf8');
const devSchema = fs.readFileSync(path.join(root, 'db', 'schema.js'), 'utf8');
const prodSchema = fs.readFileSync(path.join(root, 'db', 'prod-db.cjs'), 'utf8');
let passed = 0;
let failed = 0;

function expect(name, condition) {
  if (condition) {
    console.log(`✓ ${name}`);
    passed++;
  } else {
    console.error(`✗ ${name}`);
    failed++;
  }
}

expect(
  'morning digest reads lead temperature from its dedicated column or legacy JSONB',
  /COALESCE\(lead_temperature,\s*data->>'lead_temperature'\)\s+AS\s+lead_temperature/.test(plugin)
);
expect(
  'action-item SMS resolves the assigned staff member within the action item company',
  /FROM staff_profiles\s+WHERE company_id = \$1[\s\S]{0,180}LOWER\(user_email\) = LOWER\(\$2\)/.test(plugin)
);
expect(
  'action-item SMS prefers a staff cell phone and falls back to staff phone',
  /COALESCE\(NULLIF\(cell_phone, ''\), NULLIF\(phone, ''\)\) AS phone/.test(plugin)
);
expect(
  'morning digest creates an atomic local-day delivery claim before sending',
  /entity_type, company_id, data, created_date, updated_date\)\s+VALUES \(\$1, 'MorningDigestDelivery'[\s\S]{0,500}ON CONFLICT \(id,\s*entity_type\) DO NOTHING[\s\S]{0,900}digestClaim\.rowCount === 0/.test(plugin)
);
for (const [name, schema] of [['development', devSchema], ['production', prodSchema]]) {
  const genericTable = schema.split('CREATE TABLE IF NOT EXISTS generic_entities')[1]?.split(');')[0] || '';
  expect(`${name} generic entity schema supports the digest claim composite key`,
    /PRIMARY KEY \(id, entity_type\)/.test(genericTable));
}
expect(
  'morning digest claim is keyed by normalized phone before the email fallback',
  /const normalizedCellPhone = String\(staff\.cell_phone \|\| ''\)\.replace\(\/\\D\/g, ''\);[\s\S]{0,300}phone:\$\{normalizedCellPhone\}[\s\S]{0,200}email:\$\{String\(staff\.user_email/.test(plugin)
);
expect(
  'morning digest releases a claim only when both external channels failed',
  /if \(!emailDelivered && !smsDelivered && hasExternalChannel\) \{[\s\S]{0,300}DELETE FROM generic_entities WHERE id = \$1 AND entity_type = 'MorningDigestDelivery'/.test(plugin)
);
expect(
  'a failed morning digest does not set the four-hour fast-path timestamp',
  /if \(!emailDelivered && !smsDelivered && hasExternalChannel\) \{[\s\S]{0,500}DELETE FROM generic_entities[\s\S]{0,700}\} else \{[\s\S]{0,1300}last_morning_digest_sent/.test(plugin)
);
expect(
  'morning digest retry uses one deterministic in-app notification per recipient and local day',
  /const nId = `notif_digest_\$\{crypto\.createHash\('sha256'\)[\s\S]{0,260}\.update\(`\$\{staff\.company_id\}:\$\{recipientKey\}:\$\{localDigestDate\}`\)/.test(plugin)
);
expect(
  'profiles with no email or phone retain their digest claim as handled',
  /const hasExternalChannel = Boolean\(staff\.user_email \|\| staff\.cell_phone\);[\s\S]{0,160}if \(!emailDelivered && !smsDelivered && hasExternalChannel\)[\s\S]{0,900}status: hasExternalChannel \? 'delivered' : 'in_app_only'/.test(plugin)
);
expect(
  'morning digest updates only its typed delivery claim',
  /UPDATE generic_entities[\s\S]{0,260}WHERE id = \$2 AND entity_type = 'MorningDigestDelivery'/.test(plugin)
);
expect(
  'development cron skips real morning-digest delivery',
  /!isManual && process\.env\.REPLIT_DEPLOYMENT !== '1' && process\.env\.REPLIT_DEV_DOMAIN[\s\S]{0,250}development_delivery_disabled/.test(plugin)
);

for (const [name, source] of [['development schema', devSchema], ['production schema', prodSchema]]) {
  expect(`${name} creates leads.lead_temperature`, /lead_temperature TEXT/.test(source));
  expect(`${name} migrates existing leads.lead_temperature`, /ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_temperature TEXT/.test(source));
  expect(`${name} migrates existing users.phone`, /ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT/.test(source));
}

console.log(`\n${passed + failed} assertions: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);