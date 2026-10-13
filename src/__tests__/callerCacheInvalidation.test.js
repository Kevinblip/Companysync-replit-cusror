/**
 * Caller-cache invalidation regression tests — Task #224
 *
 * Each test exercises an actual handler code path inside
 * db/prod-integrations.cjs (create_lead, create_customer,
 * manage_entity update/delete for Lead and Customer) and asserts that
 * the callerLookupCache entry for the affected phone number is evicted.
 *
 * If someone removes an invalidateCallerCache / invalidateCallerCacheForCompany
 * call from the handler, the corresponding test here will fail.
 *
 * Mocking strategy
 * ────────────────
 * `prod-integrations.cjs` calls require('./prod-db.cjs') lazily, inside
 * functions. Vitest's vi.mock() only intercepts Vitest-managed ESM imports,
 * not internal CJS require() calls from another CJS module.
 * We therefore inject a stub directly into Node.js require.cache
 * (using the resolved absolute path) before the first handler invocation.
 * This is the standard Node.js pattern for CJS mocking without extra tooling.
 *
 * fetch is patched via global.fetch (not vi.stubGlobal) so that the CJS
 * module, which accesses fetch through the Node.js global scope, receives
 * the stub.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { createRequire } from 'module'
import { EventEmitter } from 'events'

const require = createRequire(import.meta.url)

// ─── shared cache module (must be loaded before the handler module) ──────────
const {
  callerLookupCache,
  lookupCallerByCrmPhone,
} = require('../../lib/lookupCallerByCrmPhone.cjs')

// ─── inject prod-db.cjs mock into require.cache before first handler call ────
//
// Vitest's vi.mock() only intercepts Vitest-managed ESM imports, not internal
// CJS require() calls made from within another CJS module. We therefore inject
// a stub directly into Node.js require.cache using the resolved absolute path.
//
// We save any pre-existing cache entry for each module we shadow so that
// afterAll can restore them, preventing cross-test coupling if other files
// in the same worker depend on the real modules.

let mockPool = null

const prodDbPath = require.resolve('../../db/prod-db.cjs')
const _originalProdDb = require.cache[prodDbPath]
require.cache[prodDbPath] = {
  id: prodDbPath,
  filename: prodDbPath,
  loaded: true,
  exports: {
    getPool: () => mockPool,
    getCompanyGeminiKey: async () => null,
    getCompanyPlan: async () => 'pro',
    getDailyAIUsage: async () => 0,
    incrementDailyAIUsage: async () => {},
    initDatabase: async () => {},
    handleLocalDbRoute: () => {},
    getCallRouting: async () => null,
    syncEntityBatch: async () => ({ created: 0, updated: 0 }),
    getDashboardData: async () => ({}),
    encryptApiKey: k => k,
    decryptApiKey: k => k,
    maskApiKey: () => '***',
    detectSmtpSettings: async () => null,
    getCompanyTwilioConfig: async () => null,
    getCompanyEmailConfig: async () => null,
  },
}

// mock storm-functions.cjs and object-storage.cjs so they don't attempt
// side-effectful initialisation in the test runner
const stormPath = require.resolve('../../db/storm-functions.cjs')
const _originalStorm = require.cache[stormPath]
if (!require.cache[stormPath]) {
  require.cache[stormPath] = {
    id: stormPath, filename: stormPath, loaded: true, exports: {},
  }
}
const storagePath = require.resolve('../../db/object-storage.cjs')
const _originalStorage = require.cache[storagePath]
if (!require.cache[storagePath]) {
  require.cache[storagePath] = {
    id: storagePath, filename: storagePath, loaded: true, exports: {},
  }
}

// Restore the original cache entries after the entire suite so other test
// files in the same worker are not affected.
afterAll(() => {
  if (_originalProdDb !== undefined) {
    require.cache[prodDbPath] = _originalProdDb
  } else {
    delete require.cache[prodDbPath]
  }
  if (_originalStorm !== undefined) {
    require.cache[stormPath] = _originalStorm
  } else {
    delete require.cache[stormPath]
  }
  if (_originalStorage !== undefined) {
    require.cache[storagePath] = _originalStorage
  } else {
    delete require.cache[storagePath]
  }
})

// ─── load the handler AFTER the mock is in place ─────────────────────────────
const { handleFunctionInvoke, __setTestPluginAuthHelpers } = require('../../db/prod-integrations.cjs')

// ─── constants ────────────────────────────────────────────────────────────────
const COMPANY_ID = 'company-test-1'
const PHONE = '+15551234567'
const PHONE_DIGITS = '5551234567'   // normalized form used as cache key suffix

// handleLexiChat (and any other handler intercepted before the generic
// getFunctionHandlers() fallthrough) now requires a real authenticated,
// company-authorized caller (see ai-handler-audit-lessons memory). The real
// getUserFromRequest() needs a live session cookie/DB row, which this test
// suite intentionally avoids (see mocking strategy above) — so we inject a
// fake "authenticated owner of COMPANY_ID" caller via the same test-seam
// pattern used for prod-db.cjs. checkAIUsage/logUsageEvent are left as the
// real implementations: they query the (mocked) companies table via
// prod-db.cjs's getPool(), and fail open when the test company isn't found,
// which is the same behavior production relies on for brand-new companies.
__setTestPluginAuthHelpers({
  getUserFromRequest: async () => ({ email: 'owner@test-co.example', company_id: COMPANY_ID, is_super_admin: false }),
  checkAIUsage: async () => ({ allowed: true }),
  logUsageEvent: async () => {},
})

// ─── helper: fake HTTP request readable stream ────────────────────────────────
function makeReq(body) {
  const emitter = new EventEmitter()
  emitter.headers = {}
  setImmediate(() => {
    emitter.emit('data', JSON.stringify(body))
    emitter.emit('end')
  })
  return emitter
}

/** Fake HTTP response (only needs end/writeHead/setHeader). */
function makeRes() {
  return { writeHead: () => {}, setHeader: () => {}, end: () => {} }
}

/**
 * A pool mock that answers all the setup queries handleLexiChat fires before
 * it reaches the actual write.  Pass a writeHandler to intercept INSERT/UPDATE/
 * DELETE queries and return an appropriate result.
 */
function makeHandlerPool(writeHandler) {
  return {
    query: async (sql, params) => {
      if (sql.includes('FROM companies'))
        return { rows: [{ id: COMPANY_ID, company_name: 'Test Co' }] }
      if (sql.includes('FROM staff_profiles'))
        return { rows: [] }
      if (sql.includes('FROM customers') && sql.includes('ORDER BY created_at'))
        return { rows: [] }
      if (sql.includes("entity_type = 'AIMemory'"))
        return { rows: [] }
      if (writeHandler)
        return writeHandler(sql, params)
      return { rows: [{ id: 'auto-id' }] }
    },
  }
}

/**
 * Build a global.fetch stub that returns a Gemini response:
 * - call 1 → functionCall part (triggers the tool handler in handleLexiChat)
 * - call 2+ → plain text part (ends the tool-calling loop)
 */
function stubFetchWithToolCall(toolName, toolArgs) {
  let callCount = 0
  global.fetch = async () => {
    callCount++
    const body = callCount === 1
      ? {
          candidates: [{
            content: {
              parts: [{ functionCall: { name: toolName, args: toolArgs } }],
            },
          }],
        }
      : {
          candidates: [{
            content: { parts: [{ text: 'Done.' }] },
          }],
        }
    return { ok: true, json: async () => body }
  }
}

/** Warm the cache for PHONE under COMPANY_ID and return the cache key. */
async function warmCache() {
  const pool = {
    query: async (sql) => {
      if (sql.includes('FROM generic_entities')) return { rows: [] }
      if (sql.includes('FROM customers'))
        return { rows: [{ name: 'Cached Person', phone: PHONE }] }
      return { rows: [] }
    },
  }
  const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, PHONE)
  expect(result.name).toBe('Cached Person')
  const key = `${COMPANY_ID}::${PHONE_DIGITS}`
  expect(callerLookupCache.has(key)).toBe(true)
  return key
}

/** Drive a single lexiChat function invocation end-to-end. */
async function invokeLexiChat(message, companyId = COMPANY_ID) {
  const req = makeReq({
    functionName: 'lexiChat',
    params: { message, companyId, conversationHistory: [] },
  })
  await handleFunctionInvoke(req, makeRes())
}

// ─── test lifecycle ────────────────────────────────────────────────────────────

const originalFetch = global.fetch

beforeEach(() => {
  callerLookupCache.clear()
  process.env.GOOGLE_GEMINI_API_KEY = 'test-key-for-vitest'
})

afterEach(() => {
  global.fetch = originalFetch
  delete process.env.GOOGLE_GEMINI_API_KEY
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe('caller cache invalidation — handler regression tests', () => {

  // ── create_lead ─────────────────────────────────────────────────────────────
  describe('create_lead handler', () => {
    it('evicts cache entry for the new lead phone number', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [{ id: 'lead-1' }] }))
      stubFetchWithToolCall('create_lead', { name: 'Alice Lead', phone: PHONE })

      await invokeLexiChat('Create lead Alice Lead with phone +15551234567')

      expect(callerLookupCache.has(key)).toBe(false)
    })

    it('leaves cache untouched when create_lead has no phone', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [{ id: 'lead-2' }] }))
      stubFetchWithToolCall('create_lead', { name: 'No Phone Lead' })

      await invokeLexiChat('Create lead No Phone Lead')

      expect(callerLookupCache.has(key)).toBe(true)
    })
  })

  // ── create_customer ──────────────────────────────────────────────────────────
  describe('create_customer handler', () => {
    it('evicts cache entry for the new customer phone number', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [{ id: 'cust-1' }] }))
      stubFetchWithToolCall('create_customer', { name: 'Bob Customer', phone: PHONE })

      await invokeLexiChat('Create customer Bob Customer with phone +15551234567')

      expect(callerLookupCache.has(key)).toBe(false)
    })

    it('leaves cache untouched when create_customer has no phone', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [{ id: 'cust-2' }] }))
      stubFetchWithToolCall('create_customer', { name: 'No Phone Customer' })

      await invokeLexiChat('Create customer No Phone Customer')

      expect(callerLookupCache.has(key)).toBe(true)
    })
  })

  // ── manage_entity create ─────────────────────────────────────────────────────
  describe('manage_entity — create action', () => {
    it('evicts cache when creating a Lead with phone', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [{ id: 'me-lead-1' }] }))
      stubFetchWithToolCall('manage_entity', {
        entity_action: 'create',
        entity_name: 'Lead',
        entity_data: { name: 'Carol Lead', phone: PHONE },
      })

      await invokeLexiChat('Create Lead via manage_entity')

      expect(callerLookupCache.has(key)).toBe(false)
    })

    it('evicts cache when creating a Customer with phone', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [{ id: 'me-cust-1' }] }))
      stubFetchWithToolCall('manage_entity', {
        entity_action: 'create',
        entity_name: 'Customer',
        entity_data: { name: 'Dave Customer', phone: PHONE },
      })

      await invokeLexiChat('Create Customer via manage_entity')

      expect(callerLookupCache.has(key)).toBe(false)
    })

    it('does NOT evict cache when creating a non-contact entity (Estimate)', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [{ id: 'est-1' }] }))
      stubFetchWithToolCall('manage_entity', {
        entity_action: 'create',
        entity_name: 'Estimate',
        entity_data: { amount: 5000 },
      })

      await invokeLexiChat('Create Estimate via manage_entity')

      expect(callerLookupCache.has(key)).toBe(true)
    })
  })

  // ── manage_entity update ─────────────────────────────────────────────────────
  describe('manage_entity — update action', () => {
    it('evicts ALL company cache entries when updating a Lead', async () => {
      // Warm two distinct phone entries for the same company
      const pool2 = {
        query: async (sql) => {
          if (sql.includes('FROM generic_entities')) return { rows: [] }
          if (sql.includes('FROM customers'))
            return { rows: [{ name: 'Alpha', phone: '+15551111111' }] }
          return { rows: [] }
        },
      }
      const pool3 = {
        query: async (sql) => {
          if (sql.includes('FROM generic_entities')) return { rows: [] }
          if (sql.includes('FROM customers'))
            return { rows: [{ name: 'Beta', phone: '+15552222222' }] }
          return { rows: [] }
        },
      }
      await lookupCallerByCrmPhone(pool2, COMPANY_ID, '+15551111111')
      await lookupCallerByCrmPhone(pool3, COMPANY_ID, '+15552222222')
      const key1 = `${COMPANY_ID}::5551111111`
      const key2 = `${COMPANY_ID}::5552222222`
      expect(callerLookupCache.has(key1)).toBe(true)
      expect(callerLookupCache.has(key2)).toBe(true)

      mockPool = makeHandlerPool(() => ({ rows: [] }))
      stubFetchWithToolCall('manage_entity', {
        entity_action: 'update',
        entity_name: 'Lead',
        entity_id: '42',
        entity_data: { name: 'Updated Lead' },
      })

      await invokeLexiChat('Update Lead #42')

      expect(callerLookupCache.has(key1)).toBe(false)
      expect(callerLookupCache.has(key2)).toBe(false)
    })

    it('evicts ALL company cache entries when updating a Customer', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [] }))
      stubFetchWithToolCall('manage_entity', {
        entity_action: 'update',
        entity_name: 'Customer',
        entity_id: '99',
        entity_data: { phone: '+15559999999' },
      })

      await invokeLexiChat('Update Customer #99')

      expect(callerLookupCache.has(key)).toBe(false)
    })

    it('does NOT evict cache when updating a non-contact entity (Invoice)', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [] }))
      stubFetchWithToolCall('manage_entity', {
        entity_action: 'update',
        entity_name: 'Invoice',
        entity_id: '7',
        entity_data: { status: 'paid' },
      })

      await invokeLexiChat('Mark Invoice #7 as paid')

      expect(callerLookupCache.has(key)).toBe(true)
    })
  })

  // ── manage_entity delete ─────────────────────────────────────────────────────
  describe('manage_entity — delete action', () => {
    it('evicts ALL company cache entries when deleting a Lead', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [] }))
      stubFetchWithToolCall('manage_entity', {
        entity_action: 'delete',
        entity_name: 'Lead',
        entity_id: '55',
      })

      await invokeLexiChat('Delete Lead #55')

      expect(callerLookupCache.has(key)).toBe(false)
    })

    it('evicts ALL company cache entries when deleting a Customer', async () => {
      const key = await warmCache()
      mockPool = makeHandlerPool(() => ({ rows: [] }))
      stubFetchWithToolCall('manage_entity', {
        entity_action: 'delete',
        entity_name: 'Customer',
        entity_id: '88',
      })

      await invokeLexiChat('Delete Customer #88')

      expect(callerLookupCache.has(key)).toBe(false)
    })
  })

  // ── cross-company isolation ──────────────────────────────────────────────────
  describe('cross-company isolation', () => {
    it('create_lead does not evict cache of a different company', async () => {
      const OTHER = 'company-other'
      const otherPool = {
        query: async (sql) => {
          if (sql.includes('FROM generic_entities')) return { rows: [] }
          if (sql.includes('FROM customers'))
            return { rows: [{ name: 'Other Corp Person', phone: PHONE }] }
          return { rows: [] }
        },
      }
      await lookupCallerByCrmPhone(otherPool, OTHER, PHONE)
      const otherKey = `${OTHER}::${PHONE_DIGITS}`
      expect(callerLookupCache.has(otherKey)).toBe(true)

      // also warm our own company's entry
      const ownKey = await warmCache()

      mockPool = makeHandlerPool(() => ({ rows: [{ id: 'cross-lead' }] }))
      stubFetchWithToolCall('create_lead', { name: 'New Lead', phone: PHONE })

      await invokeLexiChat('Create lead New Lead with phone +15551234567', COMPANY_ID)

      // own company entry is evicted; the other company's entry must survive
      expect(callerLookupCache.has(ownKey)).toBe(false)
      expect(callerLookupCache.has(otherKey)).toBe(true)
    })
  })
})
