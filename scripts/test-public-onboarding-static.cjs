#!/usr/bin/env node
/**
 * Static regression checks for the logged-out subscriber signup path.
 *
 * This deliberately does not start the app, call /api/functions/invoke, touch
 * the database, invoke Stripe, or send email/SMS. It verifies the wiring that
 * makes the isolated browser flow safe to exercise locally.
 */
const fs = require('fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const app = read('src/App.jsx');
const onboarding = read('src/pages/OnboardingWizard.jsx');
const pricing = read('src/pages/PublicPricing.jsx');
const signup = read('src/pages/SignupPage.jsx');
const quickSetup = read('src/pages/QuickSetup.jsx');
const setupWizard = read('src/pages/SetupWizard.jsx');
const privacy = read('src/pages/PrivacyPolicy.jsx');
const terms = read('src/pages/TermsOfService.jsx');
const legalLayout = read('src/pages/LegalPageLayout.jsx');
const login = read('src/pages/LoginPage.jsx');
const onboardingWizard = read('src/pages/OnboardingWizard.jsx');
const localAuth = read('db/local-auth.cjs');
const functions = read('vite-functions-plugin.js');
const publicFunction = read('functions/publicSignupInvite.ts');

const checks = [
  ['pricing has a public route', app.includes('path="/PublicPricing"')],
  ['onboarding has a public route', app.includes('path="/OnboardingWizard"')],
  ['pricing preserves the selected plan', pricing.includes('sessionStorage.setItem(\'selected_plan\'')],
  ['onboarding calls the public signup function', onboarding.includes("invoke('publicSignupInvite'")],
  ['onboarding continues through the normal signup page', onboarding.includes('navigate(`/signup?onboarding=true')],
  ['onboarding defaults to Basic', onboarding.includes(": 'basic'")],
  ['signup restores onboarding company data', signup.includes('sessionStorage.getItem("onboarding_data")')],
  ['signup forwards the selected plan', signup.includes('selected_plan: selectedPlan')],
  ['signup redirects to Quick Setup', signup.includes('/QuickSetup?plan=')],
  ['local signup links an invited owner profile', localAuth.includes('existingStaffProfile')],
  ['local signup starts pending-company trials server-side', localAuth.includes("subscription_status || '').toLowerCase() === 'pending'")],
  ['public local handler creates a pending company', functions.includes('async publicSignupInvite') && functions.includes("subscription_status, setup_completed") && functions.includes("'pending'")],
  ['public local handler creates the owner profile', functions.includes("position,") && functions.includes("'Owner'")],
  ['public handler carries onboarding data', publicFunction.includes('onboarding_data')],
  ['legacy setup wizard redirects to Quick Setup', setupWizard.includes('navigate(`/QuickSetup${window.location.search')],
  ['new-user redirect uses the canonical route casing', !read('src/pages/Dashboard.jsx').includes("'/quick-setup")],
  ['privacy and terms are public with lowercase aliases', app.includes('path="/privacy"') &&
    app.includes('path="/terms"') &&
    app.includes('path="/Privacy"') &&
    app.includes('path="/Terms"') &&
    app.includes('to="/privacy"') &&
    app.includes('to="/terms"')],
  ['privacy policy contains required plain-English disclosures', privacy.includes('CompanySync CRM') &&
    privacy.includes('getcompanysync.com') &&
    privacy.includes('io.companysync@gmail.com') &&
    privacy.includes('calendar.events') &&
    privacy.includes('Twilio phone and SMS') &&
    privacy.includes('Stripe payments') &&
    privacy.includes('Postmark or Amazon SES') &&
    privacy.includes('We do not sell personal information') &&
    legalLayout.includes('September 2, 2026') &&
    !privacy.includes('Resend')],
  ['terms contain trial, ownership, acceptable-use, and suspension terms', terms.includes('14-day free trial') &&
    terms.includes('No credit card is required') &&
    terms.includes('You own the customer') &&
    terms.includes('Acceptable use') &&
    terms.includes('suspend') &&
    terms.includes('io.companysync@gmail.com') &&
    legalLayout.includes('September 2, 2026')],
  ['signup, login, onboarding, and pricing link to legal pages', signup.includes('to="/terms"') &&
    signup.includes('to="/privacy"') &&
    login.includes('to="/terms"') &&
    login.includes('to="/privacy"') &&
    onboardingWizard.includes('to="/terms"') &&
    onboardingWizard.includes('to="/privacy"') &&
    pricing.includes('href="/privacy"') &&
    pricing.includes('href="/terms"')],
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
  console.error(`\n${failed} public onboarding check(s) failed.`);
  process.exit(1);
}
console.log(`\n${checks.length} public onboarding checks passed (static/local only).`);