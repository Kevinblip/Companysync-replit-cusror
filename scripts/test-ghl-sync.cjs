const fs = require('fs');

const source = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const page = fs.readFileSync('src/pages/GoHighLevelSettings.jsx', 'utf8');
const prod = fs.readFileSync('prod-server.cjs', 'utf8');
const legacy = [
  'functions/syncGHLContacts.ts',
  'functions/testSyncOneGHL.ts',
  'functions/pushToGHL.ts',
  'functions/autoSyncGHL.ts',
  'functions/ghlAutoSyncCron.ts',
  'functions/ghlAutoSyncEndpoint.ts',
].map(file => fs.readFileSync(file, 'utf8')).join('\n');
const checks = [
  ['settings lookup is case-insensitive', "LOWER(COALESCE(data->>'integration_name', '')) = 'gohighlevel'"],
  ['manual callers require company admin access', 'Only a company owner or administrator can sync GoHighLevel contacts.'],
  ['GHL requests use the current LeadConnector API', 'https://services.leadconnectorhq.com/contacts/'],
  ['contact paging follows the provider next-page link', 'page.data?.meta?.nextPageUrl || page.data?.nextPageUrl'],
  ['contact matching includes phone', "REGEXP_REPLACE(COALESCE(data->>'phone', ''), '\\\\D', '', 'g')"],
  ['test sync is non-destructive', 'dryRun: true'],
  ['test UI describes a preview rather than an import', 'Would create a new lead'],
  ['production sync runs on startup', 'runGhlAutoSyncCron();'],
  ['OAuth app uses location-level authorization', "user_type: 'Location'"],
  ['OAuth tokens are encrypted at rest', 'access_token_enc: encryptApiKey(tokens.access_token)'],
  ['OAuth callback exists in development and production', '/api/ghl-oauth-callback'],
  ['company settings UI includes the connect control below Location ID', page.indexOf('GoHighLevel account authorization') > page.indexOf('<Label>Location ID')],
  ['sync and push handlers do not use the shared key', !/GHL_API_KEY/.test(source.slice(source.indexOf('async syncGHLContacts'), source.indexOf('// ---- JobNimbus')))],
  ['legacy GHL functions do not read the shared key', !/GHL_API_KEY/.test(legacy)],
];

let failures = 0;
for (const [label, needle] of checks) {
  const haystack = label.includes('UI') ? page : label.includes('production') || label.includes('callback') ? prod + source : source;
  const passed = typeof needle === 'boolean' ? needle : haystack.includes(needle);
  if (passed) console.log(`✓ ${label}`);
  else {
    console.error(`✗ ${label}`);
    failures++;
  }
}

if (failures) process.exit(1);
console.log(`\n${checks.length} GHL sync safeguards passed`);