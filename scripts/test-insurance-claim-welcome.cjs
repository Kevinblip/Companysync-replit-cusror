const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  SETTINGS_ENTITY_TYPE, SEND_ENTITY_TYPE, REQUIRED_ROLES,
  claimTransitionIsNew, customerClaimIsNew, settingsWriteGuard, sendInsuranceClaimWelcomeEmail,
} = require('../lib/insuranceClaimWelcome.cjs');

const fixtures = () => ({
  project: { id: 'project-test', company_id: 'tenant-test', title: 'Insurance project', customer_id: 'customer-test', data: { project_type: 'sedgwick_claim' } },
  settings: { enabled: true, roles: Object.fromEntries(REQUIRED_ROLES.map(({ key }) => [
    key, { staff_profile_id: key, public_phone: key === 'office_manager' ? '216-555-0101' : '', responsibilities: `Reviewed ${key} responsibilities` },
  ])) },
  customer: { id: 'customer-test', company_id: 'tenant-test', name: 'Test Homeowner', email: 'homeowner@example.test' },
  staff: REQUIRED_ROLES.map(({ key }) => ({
    id: key, company_id: 'tenant-test', full_name: `${key} Test`,
    avatar_url: `https://example.test/${key}.jpg`, is_active: true,
    cell_phone: '216-555-9999',
  })),
});

function mockPool(fixture) {
  const sends = new Map();
  return {
    sends,
    async query(sql, params) {
      if (/FROM projects/.test(sql)) {
        assert.equal(params[1], 'tenant-test');
        return { rows: fixture.project?.company_id === params[1] ? [fixture.project] : [] };
      }
      if (/SELECT data FROM generic_entities/.test(sql) && /WHERE entity_type = \$1/.test(sql)) {
        assert.equal(params[0], SETTINGS_ENTITY_TYPE);
        assert.equal(params[1], 'tenant-test');
        return { rows: fixture.settings ? [{ data: fixture.settings }] : [] };
      }
      if (/entity_type = 'TwilioSettings'/.test(sql)) {
        return { rows: fixture.twilio ? [{ data: fixture.twilio }] : [] };
      }
      if (/FROM customers/.test(sql)) {
        assert.equal(params[1], 'tenant-test');
        return { rows: fixture.customer?.id === params[0] && fixture.customer?.company_id === params[1] ? [fixture.customer] : [] };
      }
      if (/SELECT data FROM generic_entities/.test(sql)) {
        const provisional = sends.get(params[0]);
        const hasNumbered = [...sends.values()].some(send => send.customer_id === params[3] && send.claim_number);
        return { rows: provisional && !hasNumbered ? [{ data: provisional }] : [] };
      }
      if (/FROM staff_profiles/.test(sql)) {
        assert.equal(params[1], 'tenant-test');
        return { rows: fixture.staff.filter(staff => staff.id === params[0] && staff.company_id === params[1] && staff.is_active !== false) };
      }
      if (/INSERT INTO generic_entities/.test(sql)) {
        assert.match(sql, /ON CONFLICT \(id, entity_type\)/);
        assert.equal(params[1], SEND_ENTITY_TYPE);
        if (sends.has(params[0])) return { rows: [] };
        sends.set(params[0], JSON.parse(params[3]));
        return { rows: [{ id: params[0] }] };
      }
      if (/UPDATE generic_entities/.test(sql)) {
        assert.match(sql, /entity_type = 'InsuranceClaimWelcomeEmailSend'/);
        assert.equal(params[2], 'tenant-test');
        sends.set(params[0], { ...sends.get(params[0]), ...JSON.parse(params[1]) });
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

async function run() {
  let checks = 0;
  const fixture = fixtures();
  assert.equal(claimTransitionIsNew({ mutationType: 'create', project: fixture.project }), true);
  assert.equal(claimTransitionIsNew({ mutationType: 'update', previousProject: { project_type: 'standard' }, project: fixture.project }), true);
  assert.equal(claimTransitionIsNew({ mutationType: 'update', previousProject: fixture.project, project: fixture.project }), false);
  assert.equal(claimTransitionIsNew({ mutationType: 'update', project: fixture.project }), false);
  assert.equal(claimTransitionIsNew({ mutationType: 'create', project: { project_type: 'standard' } }), false);
  checks += 5;
  assert.equal(customerClaimIsNew({ mutationType: 'create', customer: { claim_number: 'TEST-123' } }), true);
  assert.equal(customerClaimIsNew({ mutationType: 'update', previousCustomer: {}, customer: { data: { insurance_claim_number: 'TEST-123' } } }), true);
  assert.equal(customerClaimIsNew({ mutationType: 'update', previousCustomer: { claim_number: 'TEST-123' }, customer: { claim_number: 'TEST-123' } }), false);
  assert.equal(customerClaimIsNew({ mutationType: 'update', previousCustomer: { claim_number: 'OLD' }, customer: { claim_number: 'CORRECTED' } }), false);
  checks += 4;

  const admin = { authenticated: true, administratorCompanyIds: new Set(['tenant-test']), allowedCompanyIds: new Set(['tenant-test']) };
  assert.equal(settingsWriteGuard(admin, SETTINGS_ENTITY_TYPE, { company_id: 'tenant-test' }).blocked, false);
  assert.equal(settingsWriteGuard(admin, SETTINGS_ENTITY_TYPE, { company_id: 'foreign-tenant' }).blocked, true);
  assert.equal(settingsWriteGuard({ ...admin, administratorCompanyIds: new Set() }, SETTINGS_ENTITY_TYPE, { company_id: 'tenant-test' }).blocked, true);
  assert.equal(settingsWriteGuard(admin, SETTINGS_ENTITY_TYPE, []).blocked, true);
  assert.equal(settingsWriteGuard({ ...admin, isImpersonating: true }, SETTINGS_ENTITY_TYPE, {}).blocked, true);
  checks += 5;

  let acceptedPayload;
  let providerCalls = 0;
  const pool = mockPool(fixture);
  const input = {
    pool, companyId: 'tenant-test', projectId: 'project-test', mutationType: 'create',
    executeEmail: async payload => { providerCalls++; acceptedPayload = payload; return { success: true }; },
  };
  const results = await Promise.all([sendInsuranceClaimWelcomeEmail(input), sendInsuranceClaimWelcomeEmail(input)]);
  assert.equal(providerCalls, 1);
  assert.equal(results.filter(result => result.sent).length, 1);
  assert.equal([...pool.sends.values()][0].status, 'accepted');
  assert.equal(acceptedPayload.entityData.customer_email, fixture.customer.email);
  assert.equal(acceptedPayload.entityData.title, 'Insurance project');
  assert.match(acceptedPayload.action.email_body, /Office Manager/);
  assert.match(acceptedPayload.action.email_body, /Production Manager/);
  assert.match(acceptedPayload.action.email_body, /Project Manager/);
  assert.match(acceptedPayload.action.email_body, /216-555-0101/);
  assert.doesNotMatch(acceptedPayload.action.email_body, /216-555-9999/);
  checks += 10;

  const lexiFixture = fixtures();
  lexiFixture.settings.lexi = {
    enabled: true,
    public_phone: '+12165550101',
    voice_enabled: true,
    voice_verified: true,
    sms_enabled: true,
    sms_verified: true,
  };
  lexiFixture.twilio = {
    main_phone_number: '+12165550101',
    enable_calling: true,
    enable_sms: true,
  };
  let lexiEmail;
  await sendInsuranceClaimWelcomeEmail({
    ...input,
    pool: mockPool(lexiFixture),
    executeEmail: async payload => { lexiEmail = payload; return { success: true }; },
  });
  assert.match(lexiEmail.action.email_body, /Lexi · AI Project Update Assistant/);
  assert.match(lexiEmail.action.email_body, /AI assistant, not a person/);
  assert.match(lexiEmail.action.email_body, /href="tel:\+12165550101"/);
  assert.match(lexiEmail.action.email_body, /href="sms:\+12165550101"/);
  assert.doesNotMatch(lexiEmail.action.email_body, /COO/);
  const mismatchedLexiFixture = fixtures();
  mismatchedLexiFixture.settings.lexi = lexiFixture.settings.lexi;
  mismatchedLexiFixture.twilio = { ...lexiFixture.twilio, main_phone_number: '+12165550202' };
  let mismatchedLexiEmail;
  await sendInsuranceClaimWelcomeEmail({
    ...input,
    pool: mockPool(mismatchedLexiFixture),
    executeEmail: async payload => { mismatchedLexiEmail = payload; return { success: true }; },
  });
  assert.doesNotMatch(mismatchedLexiEmail.action.email_body, /Lexi · AI Project Update Assistant/);
  checks += 6;

  const numberedFixture = fixtures();
  numberedFixture.customer.claim_number = 'Carrier-123';
  numberedFixture.customer.data = { insurance_company: 'Any Insurance Company' };
  const numberedPool = mockPool(numberedFixture);
  let numberedSends = 0;
  const numberedInput = {
    ...input, pool: numberedPool,
    executeEmail: async () => { numberedSends++; return { success: true }; },
  };
  const customerSend = await sendInsuranceClaimWelcomeEmail({
    ...numberedInput, entityType: 'Customer', projectId: 'customer-test',
  });
  const projectSend = await sendInsuranceClaimWelcomeEmail(numberedInput);
  assert.equal(customerSend.sent, true);
  assert.equal(projectSend.sent, false);
  assert.equal(numberedSends, 1);
  checks += 3;

  const provisionalFixture = fixtures();
  const provisionalPool = mockPool(provisionalFixture);
  let provisionalSends = 0;
  const provisionalInput = { ...input, pool: provisionalPool, executeEmail: async () => { provisionalSends++; return { success: true }; } };
  await sendInsuranceClaimWelcomeEmail(provisionalInput);
  provisionalFixture.customer.claim_number = 'Newly assigned claim number';
  const attached = await sendInsuranceClaimWelcomeEmail({
    ...provisionalInput, entityType: 'Customer', projectId: 'customer-test',
    mutationType: 'update', previousCustomer: { name: 'Test Homeowner' },
  });
  assert.equal(attached.sent, false);
  assert.equal(provisionalSends, 1);
  assert.equal(provisionalPool.sends.size, 2);
  checks += 3;

  const skipCases = [
    ['existing claim edit', f => f, { mutationType: 'update', previousProject: fixture.project }],
    ['disabled', f => { f.settings.enabled = false; }],
    ['missing configuration', f => { f.settings = null; }],
    ['missing email', f => { f.customer.email = ''; }],
    ['foreign customer', f => { f.customer.company_id = 'foreign'; }],
    ['unlinked project', f => { delete f.project.customer_id; }],
    ['conflicting customer links', f => { f.project.data.related_customer_id = 'different-customer'; }],
    ['foreign staff', f => { f.staff[0].company_id = 'foreign'; }],
    ['missing photo', f => { f.staff[0].avatar_url = ''; }],
    ['missing responsibilities', f => { f.settings.roles.office_manager.responsibilities = ''; }],
    ['only personal cell', f => { f.settings.roles.office_manager.public_phone = ''; }],
    ['inactive selected staff', f => { f.staff[0].is_active = false; }],
  ];
  for (const [name, mutate, extras = {}] of skipCases) {
    const f = fixtures();
    mutate(f);
    let called = false;
    const result = await sendInsuranceClaimWelcomeEmail({
      ...input, pool: mockPool(f), ...extras,
      executeEmail: async () => { called = true; return { success: true }; },
    });
    assert.equal(result.sent, false, name);
    assert.equal(called, false, name);
    checks++;
  }
  const failurePool = mockPool(fixtures());
  const failed = await sendInsuranceClaimWelcomeEmail({ ...input, pool: failurePool, executeEmail: async () => ({ success: false, reason: 'Provider unavailable' }) });
  assert.equal(failed.sent, false);
  assert.equal([...failurePool.sends.values()][0].status, 'failed');
  const undefinedResult = await sendInsuranceClaimWelcomeEmail({ ...input, pool: mockPool(fixtures()), executeEmail: async () => undefined });
  assert.equal(undefinedResult.sent, false);
  checks += 3;

  const malicious = fixtures();
  malicious.customer.name = '<script>evil()</script>';
  malicious.settings.roles.office_manager.responsibilities = '<img src=x onerror=evil()>';
  let html;
  await sendInsuranceClaimWelcomeEmail({ ...input, pool: mockPool(malicious), executeEmail: async payload => { html = payload.action.email_body; return { success: true }; } });
  assert.doesNotMatch(html, /<script>|onerror=evil\(\)>/);
  assert.match(html, /&lt;script&gt;/);
  checks += 2;

  const dev = fs.readFileSync('vite-db-plugin.js', 'utf8');
  const prod = fs.readFileSync('db/prod-db.cjs', 'utf8');
  assert.match(dev, /sendNewClaimWelcome\(pool, 'create', null, created, sdkName\)/);
  assert.match(dev, /sendNewClaimWelcome\(pool, 'update', existing, updated, sdkName\)/);
  assert.match(prod, /updated\.company_id, existing\)/);
  assert.match(prod, /previousProject: previousEntityData/);
  checks += 4;
  console.log(`PASS: ${checks} insurance-claim welcome checks (mock transport; no emails or database writes).`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
