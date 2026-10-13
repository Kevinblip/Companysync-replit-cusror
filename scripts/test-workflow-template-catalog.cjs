const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function run() {
  const { getDefaultWorkflowCatalog } = require('../db/local-auth.cjs');
  const catalog = await getDefaultWorkflowCatalog();

  assert.strictEqual(catalog.length, 41, 'catalog should consolidate to 41 distinct workflow definitions');
  assert.strictEqual(
    new Set(catalog.map(item => item.workflow_name.toLowerCase())).size,
    catalog.length,
    'catalog workflow names must be unique'
  );
  assert.strictEqual(
    new Set(catalog.map(item => item.template_key)).size,
    catalog.length,
    'catalog template keys must be unique'
  );
  assert(catalog.every(item => item.is_catalog_template === true), 'all catalog entries must be marked as templates');
  assert(catalog.every(item => item.is_active === false), 'catalog entries must never be executable');

  const serialized = JSON.stringify(catalog);
  assert(!/yicnteam@gmail\.com/i.test(serialized), 'catalog must not leak a company email');
  assert(!/YICN Roofing|\bYICN\b/i.test(serialized), 'catalog must not leak company branding');
  assert(!/\bKevin Stone\b|\bVicky\b/i.test(serialized), 'catalog must not leak company-specific staff names');
  assert(!/\b216[-.\s]?(?:999[-.\s]?6222|238[-.\s]?6431)\b/.test(serialized), 'catalog must not leak company phone numbers');

  const handlers = read('vite-functions-plugin.js');
  const prodDb = read('db/prod-db.cjs');
  const localAuth = read('db/local-auth.cjs');
  const page = read('src/pages/Workflows.jsx');
  const subscriptionGate = read('src/components/SubscriptionGate.jsx');
  const viteConfig = read('vite.config.js');
  const prodIntegrations = read('db/prod-integrations.cjs');
  const prodServer = read('prod-server.cjs');

  assert(handlers.includes('async getWorkflowTemplateCatalog('), 'catalog read handler must exist');
  assert(handlers.includes('async setWorkflowTemplateActive('), 'activation handler must exist');
  assert(handlers.includes('source_template_key'), 'activation must retain stable template provenance');
  assert(handlers.includes('Company administrator access required'), 'activation must be admin protected');
  assert(handlers.includes('`${companyId}:${templateKey}`'), 'activation id must be deterministic per tenant/template');
  assert(handlers.includes('WORKFLOW_TRIGGER_ALIASES'), 'workflow trigger aliases must preserve compatibility between library and entity event names');
  assert(handlers.includes("data->>'trigger_type' = ANY($2::text[])"), 'workflow matching must support trigger aliases');
  assert(handlers.includes("d.status === 'completed' || d.completed_at"), 'completed inspections must trigger inspection workflows');
  assert(handlers.includes('Twilio is not configured for company'), 'SMS delivery must report missing Twilio configuration');
  assert(handlers.includes('Twilio rejected SMS'), 'SMS delivery must surface provider failures');
  assert(handlers.includes('Preview completed; no messages were sent because all send steps are delayed'), 'workflow preview must not claim delayed messages were sent');
  assert(prodDb.includes('WORKFLOW_TRIGGER_ALIASES'), 'production workflow triggers must use the same compatibility aliases');
  assert(prodDb.includes("data->>'trigger_type' = ANY($2::text[])"), 'production workflow matching must support trigger aliases');
  assert(prodDb.includes('InspectionJob'), 'production workflow trigger map must cover inspection events');
  assert(!/Using \$\{matchingWorkflows\.length\} platform_default/.test(handlers), 'dev trigger engine must not execute catalog defaults');
  assert(!/company_id = 'platform_default' AND data->>'trigger_type'/.test(prodDb), 'prod trigger engine must not execute catalog defaults');

  const setupReferences = (localAuth.match(/setupDefaultWorkflows\(pool,\s*companyId\)/g) || []).length;
  assert.strictEqual(setupReferences, 1, 'only the setup function declaration may reference pool/company; signup must not call it');
  assert(page.includes('CompanySync Workflow Library'), 'subscriber workflow library UI must exist');
  assert(page.includes("invoke('setWorkflowTemplateActive'"), 'library UI must use explicit activation');
  assert(page.includes('Available Templates'), 'page must distinguish available templates from tenant workflows');
  assert(page.includes('Your Workflows'), 'page must label tenant-owned workflow count clearly');
  assert(page.includes('Could not load the template library'), 'catalog failures must be visible instead of looking like an empty library');
  assert(page.includes('retryCatalog()'), 'catalog failure UI must offer a retry');
  assert(viteConfig.includes("'vite-functions-plugin.js'"), 'production build must package the shared function registry');
  assert(viteConfig.includes("fs.copyFileSync(path.join(dbDir, file), path.join(distDbDir, file))"), 'production build must package workflow catalog definitions');
  assert(prodIntegrations.includes("path.resolve(__dirname, '../vite-functions-plugin.js')"), 'production function invocations must load the packaged shared registry');
  assert(prodServer.includes("prodIntegrations.handleFunctionInvoke"), 'production invoke route must dispatch through the shared function registry');
  assert(subscriptionGate.match(/basic:\s*\[[\s\S]*?'workflows'/), 'Basic subscribers must have workflow access');

  console.log(`✓ ${catalog.length} unique templates are safe, opt-in, tenant-scoped, and available to all paid plans`);
}

run().catch(error => {
  console.error('Workflow template catalog test failed:', error);
  process.exit(1);
});