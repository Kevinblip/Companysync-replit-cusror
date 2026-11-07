const assert = require('node:assert/strict');
const fs = require('node:fs');
const bell = require('../lib/notificationBell.cjs');

function member(overrides = {}) {
  return {
    authenticated: true,
    email: 'Kevin@Example.com',
    isSuperAdmin: false,
    viaServiceToken: false,
    allowedCompanyIds: new Set(['co-kevin']),
    isImpersonating: false,
    impersonatedCompanyId: null,
    impersonationExpired: false,
    ...overrides,
  };
}

const countSql = bell.unreadCountSql();
assert.match(countSql, /SELECT COUNT\(\*\)::int AS count/);
assert.match(countSql, /FROM generic_entities/);
assert.match(countSql, /entity_type = 'Notification'/);
assert.match(countSql, /company_id = ANY\(\$1::text\[\]\)/);
assert.match(countSql, /COALESCE\(data->>'user_email', ''\) = ''/);
assert.match(countSql, /LOWER\(data->>'user_email'\) = LOWER\(\$2\)/);
assert.match(countSql, /LOWER\(COALESCE\(data->>'is_read', ''\)\) <> 'true'/);
assert.match(countSql, /deferred_until/);
assert.match(countSql, /::timestamptz <= NOW\(\)/);
assert.doesNotMatch(countSql, /\$\{/, 'the count query stays parameterized');

const deferredPattern = countSql.match(/~ '([^']+)'/);
assert.ok(deferredPattern, 'deferred timestamps are matched before they are cast');
const deferredRe = new RegExp(deferredPattern[1]);
assert.equal(deferredRe.test('2026-10-19T22:38:00.000Z'), true);
assert.equal(deferredRe.test('2026-10-19T22:38:00Z'), true);
assert.equal(deferredRe.test('tomorrow'), false);
assert.equal(deferredRe.test(''), false);

const listSql = bell.visibleListSql();
assert.match(listSql, /entity_type = 'Notification'/);
assert.match(listSql, /COALESCE\(data->>'user_email', ''\) = ''/);
assert.match(listSql, /LOWER\(data->>'user_email'\) = LOWER\(\$2\)/);
assert.match(listSql, /deferred_until/);
assert.match(listSql, /ORDER BY created_date DESC NULLS LAST/);
assert.match(listSql, /LIMIT \$3/);
assert.doesNotMatch(listSql, /is_read/, 'the dropdown still includes notifications that are already read');

assert.equal(bell.resolveBellCompanyIds({ authenticated: false, email: 'a@b.c' }, 'co-kevin').status, 401);
assert.equal(bell.resolveBellCompanyIds(member({ impersonationExpired: true }), 'co-kevin').status, 401);
assert.equal(bell.resolveBellCompanyIds(member({ email: '' }), 'co-kevin').status, 401);
assert.equal(bell.resolveBellCompanyIds(member(), '').status, 400);
assert.equal(bell.resolveBellCompanyIds(member(), 'co-other').status, 403);
assert.deepEqual(bell.resolveBellCompanyIds(member(), 'co-kevin'), {
  companyIds: ['co-kevin'],
  email: 'Kevin@Example.com',
});
assert.deepEqual(
  bell.resolveBellCompanyIds(member({ allowedCompanyIds: new Set(['co-kevin', 'co-other']) }), 'co-other').companyIds,
  ['co-other'],
);
assert.deepEqual(
  bell.resolveBellCompanyIds(member({ isSuperAdmin: true, allowedCompanyIds: new Set() }), 'co-any').companyIds,
  ['co-any'],
);
const impersonating = member({
  isSuperAdmin: true,
  allowedCompanyIds: new Set(['home']),
  isImpersonating: true,
  impersonatedCompanyId: 'co-target',
});
assert.equal(bell.resolveBellCompanyIds(impersonating, 'home').status, 403);
assert.deepEqual(bell.resolveBellCompanyIds(impersonating, 'co-target').companyIds, ['co-target']);

async function assertHandlerUsesScopedSql() {
  const queries = [];
  const pool = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)')) return { rows: [{ count: 27 }] };
      return {
        rows: [{
          id: 'n1',
          company_id: 'co-kevin',
          created_date: '2026-10-19T00:00:00.000Z',
          updated_date: '2026-10-19T00:00:00.000Z',
          data: { title: 'Mine', user_email: 'Kevin@Example.com', is_read: false },
        }],
      };
    },
  };

  const denied = await bell.handleBellRequest(pool, member(), {
    path: '/api/local/notifications/unread-count',
    companyId: 'co-other',
  });
  assert.equal(denied.status, 403);
  assert.equal(queries.length, 0, 'a rejected company never reaches SQL');

  const counted = await bell.handleBellRequest(pool, member(), {
    path: '/api/local/notifications/unread-count',
    companyId: 'co-kevin',
    limit: '100',
  });
  assert.equal(counted.status, 200);
  assert.equal(counted.body.count, 27);
  assert.match(queries[0].sql, /COUNT\(\*\)/);
  assert.deepEqual(queries[0].params, [['co-kevin'], 'Kevin@Example.com']);

  const listed = await bell.handleBellRequest(pool, member(), {
    path: '/api/local/notifications',
    companyId: 'co-kevin',
    limit: '5000',
  });
  assert.equal(listed.status, 200);
  assert.equal(listed.body[0].title, 'Mine');
  assert.equal(queries[1].params[2], 100, 'the dropdown stays capped at the newest 100 visible rows');
}

const dev = fs.readFileSync('vite-db-plugin.js', 'utf8');
const prod = fs.readFileSync('db/prod-db.cjs', 'utf8');
for (const source of [dev, prod]) {
  assert.match(source, /\/api\/local\/notifications\/unread-count/);
  assert.match(source, /notificationBell\.handleBellRequest/);
  assert.match(source, /tenantGuard\.resolveRequestContext/);
}

const layout = fs.readFileSync('src/Layout.jsx', 'utf8');
assert.match(layout, /\/api\/local\/notifications\/unread-count\?/);
assert.match(layout, /\/api\/local\/notifications\?\$\{params\}/);
assert.match(layout, /unreadCount > 99 \? '99\+' : unreadCount/);
assert.doesNotMatch(
  layout,
  /Notification\.filter\(\{\s*company_id: myCompany\.id\s*\}, "-created_date", 100\)/,
  'the bell no longer counts from the newest 100 company-wide rows',
);

function sliceBetween(source, startText, endText) {
  const start = source.indexOf(startText);
  const end = source.indexOf(endText, start);
  assert.notEqual(start, -1, startText);
  assert.notEqual(end, -1, endText);
  return source.slice(start, end);
}

const markRead = sliceBetween(layout, 'const handleNotificationClick', 'const handleCompleteActionFromNotification');
const markAll = sliceBetween(layout, 'const handleMarkAllAsRead', 'const handleDeleteAccount');
assert.match(markRead, /await refreshNotificationCount\(\)/);
assert.match(markAll, /await refreshNotificationCount\(\)/);
assert.match(markAll, /queryClient\.invalidateQueries\(\{ queryKey: \['notifications', myCompany\.id\] \}\)/);

assertHandlerUsesScopedSql().then(() => {
  console.log('Notification unread-count checks passed.');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
