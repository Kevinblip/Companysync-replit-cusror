#!/usr/bin/env node
'use strict';

// Unit test for the HMAC signed-URL helper used to protect public estimate
// pages. Run via `node scripts/test-estimate-token.cjs`.

process.env.ESTIMATE_LINK_SECRET = 'test-secret-do-not-use-in-prod';
delete process.env.ESTIMATE_REQUIRE_TOKEN;

const path = require('path');
const {
  signEstimateToken,
  verifyEstimateToken,
  appendToken,
  checkEstimateAccess,
  isTokenRequired,
} = require(path.join('..', 'lib', 'estimateToken.cjs'));

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.log(`  \u2717 ${name}`); failed++; }
}

console.log('[estimate-token] running tests...');

// 1. Determinism: same id+secret => same token.
const t1 = signEstimateToken('estimate-abc');
const t2 = signEstimateToken('estimate-abc');
ok('signEstimateToken is deterministic', t1 && t1 === t2);

// 2. Different ids produce different tokens.
const tDiff = signEstimateToken('estimate-xyz');
ok('different ids produce different tokens', tDiff && tDiff !== t1);

// 3. base64url charset: no '+' '/' or '=' padding.
ok('token is base64url (no +,/,=)', /^[A-Za-z0-9_-]+$/.test(t1));

// 4. Verification accepts valid token.
ok('verify accepts valid token', verifyEstimateToken('estimate-abc', t1) === true);

// 5. Verification rejects token bound to a different id.
ok('verify rejects mismatched id', verifyEstimateToken('estimate-xyz', t1) === false);

// 6. Verification rejects empty/missing token.
ok('verify rejects empty token', verifyEstimateToken('estimate-abc', '') === false);
ok('verify rejects null token', verifyEstimateToken('estimate-abc', null) === false);

// 7. Verification rejects wrong-length tampered token.
ok('verify rejects truncated token', verifyEstimateToken('estimate-abc', t1.slice(0, -2)) === false);

// 8. Verification rejects same-length but altered token (constant-time path).
const tampered = (t1[0] === 'A' ? 'B' : 'A') + t1.slice(1);
ok('verify rejects altered same-length token', verifyEstimateToken('estimate-abc', tampered) === false);

// 9. appendToken adds ?t= or &t= correctly.
ok('appendToken with no qs uses ?', appendToken('/ViewEstimate', 'abc').startsWith('/ViewEstimate?t='));
ok('appendToken with qs uses &', appendToken('/ViewEstimate?id=abc', 'abc').includes('&t='));

// 10. MONITOR mode: missing token allowed; bad token always rejected.
ok('isTokenRequired defaults false', isTokenRequired() === false);
const mMissing = checkEstimateAccess('estimate-abc', null, 'unit');
ok('monitor mode allows missing token', mMissing.ok === true && mMissing.mode === 'monitor');
const mBad = checkEstimateAccess('estimate-abc', 'totally-bogus', 'unit');
ok('monitor mode still rejects invalid token', mBad.ok === false && mBad.reason === 'invalid_token');
const mGood = checkEstimateAccess('estimate-abc', t1, 'unit');
ok('valid token always passes', mGood.ok === true && mGood.reason === 'valid');

// 11. ENFORCED mode: missing token rejected.
process.env.ESTIMATE_REQUIRE_TOKEN = '1';
const eMissing = checkEstimateAccess('estimate-abc', null, 'unit');
ok('enforced mode rejects missing token', eMissing.ok === false && eMissing.reason === 'missing_token');
const eGood = checkEstimateAccess('estimate-abc', t1, 'unit');
ok('enforced mode accepts valid token', eGood.ok === true);
delete process.env.ESTIMATE_REQUIRE_TOKEN;

// 12. Different secrets produce different tokens.
process.env.ESTIMATE_LINK_SECRET = 'a-different-secret';
const tOther = signEstimateToken('estimate-abc');
ok('different secret => different token', tOther !== t1);
process.env.ESTIMATE_LINK_SECRET = 'test-secret-do-not-use-in-prod';

console.log(`\n[estimate-token] Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
