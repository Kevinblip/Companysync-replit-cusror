#!/usr/bin/env node
const fs = require('fs');
const assert = require('assert');
const ui = fs.readFileSync('src/pages/IntegrationsHub.jsx', 'utf8');
const vite = fs.readFileSync('vite-functions-plugin.js', 'utf8');
const prod = fs.readFileSync('prod-server.cjs', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const term of ['HOVER', 'connectHover', 'checkHoverConnection', 'testHoverConnection', 'disconnectHover']) assert(ui.includes(term) || vite.includes(term), `missing ${term}`);
for (const term of ['HoverOAuthConnection', 'encryptApiKey', 'SESSION_SECRET', 'timingSafeEqual', 'expires_at', 'is_administrator', 'refresh_token_enc']) assert(vite.includes(term), `missing secure ${term}`);
assert(vite.includes('/api/hover-callback') && prod.includes('/api/hover-callback'), 'dev/prod callback parity missing');
assert(vite.includes('https://hover.to/oauth/authorize') && vite.includes('https://hover.to/oauth/token'), 'HOVER endpoints missing');
assert(vite.includes('https://hover.to/api/v2/webhooks?page=1'), 'documented HOVER connection probe missing');
assert(vite.includes('FROM companies WHERE id=$1') && prod.includes('FROM companies WHERE id=$1'), 'company owner callback authorization missing');
assert(vite.includes('BEGIN') && vite.includes('COMMIT') && vite.includes('ROLLBACK'), 'refresh rotation is not transactional');
assert(!vite.includes("IntegrationCredential.delete") || vite.includes('disconnectHover'), 'disconnect handler missing');
assert(pkg.scripts['test:hover-oauth'], 'npm script missing');
console.log('HOVER OAuth static regression checks passed');