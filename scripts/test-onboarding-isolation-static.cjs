#!/usr/bin/env node
/**
 * Non-mutating regression checks for onboarding integration truthfulness and
 * Twilio tenant isolation. This script reads source only: no HTTP, DB, Stripe,
 * Twilio, email, or SMS calls.
 */
const fs = require('fs');

const read = file => fs.readFileSync(file, 'utf8');
const quick = read('src/pages/QuickSetup.jsx');
const legacy = read('src/pages/SetupWizard.jsx');
const twilioSetup = read('src/components/settings/TwilioSetup.jsx');
const twilioGuard = read('lib/twilioTenantGuard.cjs');
const twilioDev = read('vite-twilio-ws-plugin.js');
const twilioProd = read('prod-server.cjs');
const stripeDev = read('vite-stripe-plugin.js');
const stripeHosted = read('functions/createConnectedAccount.ts');
const calendarDev = read('vite-functions-plugin.js');
const companySetup = read('src/pages/CompanySetup.jsx');

const checks = [
  ['Quick Setup resolves company through StaffProfile membership',
    quick.includes("StaffProfile.filter({ user_email: user.email })") &&
    !quick.includes("companies.find(c => String(c.created_by")],
  ['Company completion requires saved name and email',
    quick.includes("myCompany?.company_name?.trim() && myCompany?.email?.trim()")],
  ['Twilio completion requires this company SID and phone',
    quick.includes("setting?.company_id === myCompany?.id") &&
    quick.includes("setting?.account_sid?.trim().startsWith('AC')") &&
    quick.includes("setting?.main_phone_number?.trim()")],
  ['Quick Setup Twilio read is tenant-scoped and blanks junk SIDs',
    quick.includes("TwilioSettings.filter({ company_id: myCompany.id })") &&
    quick.includes("filter(setting => setting?.company_id === myCompany.id)") &&
    quick.includes("accountSid.startsWith('AC')") &&
    quick.includes("account_sid: hasRealAccountSid ? accountSid : ''") &&
    !quick.includes("process.env.TWILIO_ACCOUNT_SID")],
  ['Quick Setup Twilio fields resist browser credential autofill',
    quick.includes('name="twilio_account_sid"') &&
    quick.includes('name="twilio_auth_token"') &&
    quick.includes('autoComplete="new-password"') &&
    quick.includes('name="twilio_phone_number"') &&
    quick.includes('<form') &&
    quick.includes('autoComplete="off"')],
  ['Google completion uses the authenticated user connection check',
    quick.includes("invoke('checkUserGoogleCalendarConnection'") &&
    quick.includes("googleCalendarStatus?.connected === true")],
  ['Stripe completion uses actual onboarding completion',
    quick.includes("stripeStatus.onboarding_complete === true") &&
    !quick.includes("stripe_onboarding_status === 'complete' || myCompany?.stripe_account_id")],
  ['Skipping setup does not call completion mutation',
    quick.includes("onClick={() => navigate(createPageUrl('Dashboard'))}") &&
    quick.includes('Finish Later')],
  ['Legacy Setup Wizard only redirects',
    legacy.includes('/QuickSetup') && !legacy.includes('autoSetupCompany')],
  ['Company Settings cannot create a trial/company',
    companySetup.includes('Complete Quick Setup before editing company settings.') &&
    !companySetup.includes("plan: 'professional'")],
  ['Twilio Settings resolves tenant through staff membership',
    twilioSetup.includes("queryKey: ['twilio-setup-membership'") &&
    !twilioSetup.includes('companies[0]')],
  ['Twilio writes validate before entity save',
    twilioSetup.indexOf('validate_only: true') < twilioSetup.indexOf('saveMutation.mutateAsync')],
  ['Shared Twilio guard blocks protected tenants',
    twilioGuard.includes("id === 'companysync_master_001'") &&
    twilioGuard.includes("name.includes('yicn')") &&
    twilioGuard.includes("name.includes('insurance claims network')")],
  ['Shared Twilio guard rejects duplicate Account SIDs',
    twilioGuard.includes('This Twilio Account SID is already assigned to another company')],
  ['Development Twilio endpoints use shared tenant guard',
    (twilioDev.match(/authorizeTwilioTenant/g) || []).length >= 3],
  ['Production Twilio endpoints use shared tenant guard',
    (twilioProd.match(/authorizeTwilioTenant/g) || []).length >= 2],
  ['Stripe supports Quick Setup return and refresh URLs',
    stripeDev.includes("params?.return_to === '/QuickSetup'") &&
    stripeHosted.includes("body?.return_to === '/QuickSetup'")],
  ['Calendar OAuth state is signed and returns to Quick Setup',
    calendarDev.includes("params?.return_to === '/QuickSetup'") &&
    calendarDev.includes("createHmac('sha256', process.env.SESSION_SECRET") &&
    calendarDev.includes('callbackUser.email.toLowerCase()')],
];

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) console.log(`ok - ${name}`);
  else {
    failed += 1;
    console.error(`not ok - ${name}`);
  }
}

if (failed) {
  console.error(`\n${failed} onboarding isolation check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} onboarding isolation checks passed (source-only).`);