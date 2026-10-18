'use strict';

const assert = require('node:assert/strict');

async function main() {
const { applyPublicPageMeta, getPublicPageMeta } = await import('../lib/publicPageMeta.js');

const shell = `<!doctype html><html><head>
<title>CompanySync - Roofing Business Management</title>
<meta name="description" content="Default description" />
<meta property="og:title" content="CompanySync - Roofing Business Management" />
<meta property="og:description" content="Default og" />
<meta property="og:url" content="https://getcompanysync.com/" />
<link rel="canonical" href="https://getcompanysync.com/" />
</head><body></body></html>`;

const signup = applyPublicPageMeta(shell, '/signup?utm_source=meta', 'https://getcompanysync.com');
assert.match(signup, /<title>Start Your CompanySync Free Trial<\/title>/);
assert.match(signup, /name="description" content="Start your CompanySync free trial\. 14 days, no credit card required\."/);
assert.match(signup, /property="og:title" content="Start Your CompanySync Free Trial"/);
assert.match(signup, /property="og:image" content="https:\/\/getcompanysync\.com\/icons\/icon-512\.png"/);
assert.match(signup, /rel="canonical" href="https:\/\/getcompanysync\.com\/signup"/);
assert.equal(applyPublicPageMeta(shell, '/'), shell);
assert.equal(getPublicPageMeta('/feature').url, 'https://getcompanysync.com/features');
assert.equal(getPublicPageMeta('/login').title, 'Log in to CompanySync');
assert.equal(getPublicPageMeta('/PublicPricing').title, 'CompanySync Pricing');

console.log('PASS public page meta');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
