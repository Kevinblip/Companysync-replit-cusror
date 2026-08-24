import { createRequire } from 'module'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const { createGhlHandlers } = require('../../db/ghl-functions.cjs')

function mockReq() {
  return { headers: { cookie: '' } }
}

describe('GHL function auth', () => {
  it('rejects unauthenticated status, save, sync, and push calls', async () => {
    const handlers = createGhlHandlers({
      getPool: () => { throw new Error('pool should not be used when unauthorized') },
      getUserFromRequest: async () => null,
      generateEntityId: () => 'id_1',
    })

    const status = await handlers.getGHLStatus({}, null, mockReq())
    const save = await handlers.saveGHLSettings({ location_id: 'x' }, null, mockReq())
    const sync = await handlers.syncGHLContacts({}, null, mockReq())
    const push = await handlers.pushToGHL({ entityId: 'lead_1' }, null, mockReq())

    assert.equal(status.success, false)
    assert.equal(status.error, 'Unauthorized')
    assert.equal(save.error, 'Unauthorized')
    assert.equal(sync.error, 'Unauthorized')
    assert.equal(push.error, 'Unauthorized')
  })

  it('does not allow a user to save settings for a company they do not belong to', async () => {
    const queries = []
    const handlers = createGhlHandlers({
      getPool: () => ({
        async query(sql, params) {
          queries.push({ sql, params })
          if (sql.includes('staff_profiles')) return { rows: [{ company_id: 'co_own' }] }
          if (sql.includes('FROM companies')) return { rows: [{ id: 'co_own' }] }
          return { rows: [] }
        },
      }),
      getUserFromRequest: async () => ({ email: 'rep@example.com', is_super_admin: false }),
      generateEntityId: () => 'id_1',
    })

    const result = await handlers.saveGHLSettings({
      company_id: 'someone_elses_company',
      location_id: 'loc',
      api_key: 'pit-test',
    }, null, mockReq())

    assert.equal(result.success, false)
    assert.match(result.error, /Company not found/)
    assert.equal(queries.some((q) => /INSERT INTO generic_entities/.test(q.sql)), false)
  })
})
