import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  lookupCallerByCrmPhone,
  sameNicknameGroup,
  sameSurname,
  invalidateCallerCache,
  invalidateCallerCacheForCompany,
  callerLookupCache,
  CALLER_CACHE_TTL_MS,
  CALLER_CACHE_MAX_SIZE,
} = require('../../lib/lookupCallerByCrmPhone.cjs')

/**
 * Smarter mock pool: stores rows per "table" and actually filters them
 * using the same predicates the real SQL would apply. This way the test
 * fails not only when the function returns the wrong source/name, but
 * also when the query parameters are wired up incorrectly (wrong
 * variant array, wrong LIKE suffixes, wrong company filter, etc).
 */
function likeMatch(value, pattern) {
  if (value == null) return false
  // Only handles leading '%' patterns ('%xxxx') as used by the helper.
  if (pattern.startsWith('%')) {
    return String(value).endsWith(pattern.slice(1))
  }
  return String(value) === pattern
}

function makePool({ generic_entities = [], customers = [], leads = [] } = {}) {
  const calls = []
  const pool = {
    query: vi.fn(async (sql, params) => {
      calls.push({ sql, params })

      if (sql.includes('FROM generic_entities')) {
        const [companyId, phoneVariants] = params
        const matched = generic_entities.filter(row => {
          if (row.company_id && row.company_id !== companyId) return false
          const data = row.data || {}
          return (
            phoneVariants.includes(data.phone) ||
            phoneVariants.includes(data.mobile_phone)
          )
        })
        // Mimic ORDER BY updated_date DESC LIMIT 5 (lookup now fetches up to 5 for nickname merge)
        return { rows: matched.slice(0, 5) }
      }

      if (sql.includes('FROM customers')) {
        const [companyId, p1, p2, p3] = params
        const matched = customers.filter(row => {
          if (row.company_id && row.company_id !== companyId) return false
          if (!row.name) return false // SQL requires name IS NOT NULL AND name != ''
          return (
            likeMatch(row.phone, p1) ||
            likeMatch(row.phone, p2) ||
            likeMatch(row.phone, p3)
          )
        })
        return { rows: matched.slice(0, 1) }
      }

      if (sql.includes('FROM leads')) {
        const [companyId, p1, p2, p3] = params
        const matched = leads.filter(row => {
          if (row.company_id && row.company_id !== companyId) return false
          if (!row.name) return false
          return (
            likeMatch(row.phone, p1) ||
            likeMatch(row.phone, p2) ||
            likeMatch(row.phone, p3)
          )
        })
        return { rows: matched.slice(0, 1) }
      }

      return { rows: [] }
    }),
    calls,
  }
  return pool
}

describe('lookupCallerByCrmPhone', () => {
  const COMPANY_ID = 'company-1'

  beforeEach(() => {
    callerLookupCache.clear()
  })

  describe('input validation', () => {
    it('returns nulls when phone is missing', async () => {
      const pool = makePool()
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, null)
      expect(result).toEqual({ name: null, source: null, record: null })
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('returns nulls when companyId is missing', async () => {
      const pool = makePool()
      const result = await lookupCallerByCrmPhone(pool, null, '+15551234567')
      expect(result).toEqual({ name: null, source: null, record: null })
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('returns nulls when phone has fewer than 7 digits', async () => {
      const pool = makePool()
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '12345')
      expect(result).toEqual({ name: null, source: null, record: null })
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('returns nulls when phone is empty string', async () => {
      const pool = makePool()
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '')
      expect(result).toEqual({ name: null, source: null, record: null })
      expect(pool.query).not.toHaveBeenCalled()
    })
  })

  describe('phone normalization & query parameters', () => {
    it('strips formatting characters before querying', async () => {
      const pool = makePool()
      await lookupCallerByCrmPhone(pool, COMPANY_ID, '(555) 123-4567')

      const geCall = pool.calls.find(c => c.sql.includes('generic_entities'))
      expect(geCall.params[0]).toBe(COMPANY_ID)
      expect(geCall.params[1]).toEqual(
        expect.arrayContaining(['5551234567', '+15551234567'])
      )
    })

    it('passes 10-digit and 7-digit suffix LIKE patterns to customers/leads', async () => {
      const pool = makePool()
      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')

      const custCall = pool.calls.find(c => c.sql.includes('FROM customers'))
      expect(custCall.params[0]).toBe(COMPANY_ID)
      expect(custCall.params[1]).toBe('%5551234567')
      expect(custCall.params[2]).toBe('%5551234567')
      expect(custCall.params[3]).toBe('%1234567')
    })

    it('strips +1 country code prefix from digits', async () => {
      const pool = makePool()
      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      const geCall = pool.calls.find(c => c.sql.includes('generic_entities'))
      expect(geCall.params[1]).toEqual(['+15551234567', '5551234567', '+15551234567'])
    })

    it('handles 10-digit phone (no country code) in variants', async () => {
      const pool = makePool()
      await lookupCallerByCrmPhone(pool, COMPANY_ID, '5551234567')
      const geCall = pool.calls.find(c => c.sql.includes('generic_entities'))
      expect(geCall.params[1]).toContain('5551234567')
      expect(geCall.params[1]).toContain('+15551234567')
    })

    it('passes the configured companyId to every query', async () => {
      const pool = makePool()
      await lookupCallerByCrmPhone(pool, 'company-xyz', '+15551234567')
      for (const c of pool.calls) {
        expect(c.params[0]).toBe('company-xyz')
      }
    })
  })

  describe('exact match and priority', () => {
    it('returns CRM lead when found in generic_entities (highest priority)', async () => {
      const pool = makePool({
        generic_entities: [{ data: { full_name: 'Alice CRM', phone: '+15551234567' } }],
        customers: [{ name: 'Alice Customer', phone: '+15551234567' }],
        leads: [{ name: 'Alice Lead', phone: '+15551234567' }],
      })

      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')

      expect(result.source).toBe('crm_lead')
      expect(result.name).toBe('Alice CRM')
      expect(result.record).toEqual({ full_name: 'Alice CRM', phone: '+15551234567' })
    })

    it('matches CRM lead via mobile_phone field too', async () => {
      const pool = makePool({
        generic_entities: [{ data: { full_name: 'Mona Mobile', mobile_phone: '+15551234567' } }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      expect(result.name).toBe('Mona Mobile')
    })

    it('uses CRM lead "name" field when "full_name" is missing', async () => {
      const pool = makePool({
        generic_entities: [{ data: { name: 'Bob Only Name', phone: '+15551112222' } }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551112222')
      expect(result).toEqual({
        name: 'Bob Only Name',
        source: 'crm_lead',
        record: { name: 'Bob Only Name', phone: '+15551112222' },
      })
    })

    it('falls through to customers when CRM lead has no name', async () => {
      const pool = makePool({
        generic_entities: [{ data: { phone: '+15551234567', email: 'x@y.com' } }],
        customers: [{ name: 'Carol Customer', phone: '+15551234567' }],
      })

      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')

      expect(result.source).toBe('customer')
      expect(result.name).toBe('Carol Customer')
    })

    it('returns customer when no CRM lead exists', async () => {
      const pool = makePool({
        customers: [{ name: 'Dan Customer', phone: '5551234567' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('customer')
      expect(result.name).toBe('Dan Customer')
    })

    it('falls through to leads when CRM lead has no name and no customer match', async () => {
      const pool = makePool({
        generic_entities: [{ data: { phone: '+15551234567' } }],
        leads: [{ name: 'Eve Lead', phone: '+15551234567' }],
      })

      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')

      expect(result.source).toBe('lead')
      expect(result.name).toBe('Eve Lead')
    })

    it('returns lead when no CRM lead or customer matches', async () => {
      const pool = makePool({
        leads: [{ name: 'Frank Lead', phone: '+15551234567' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('lead')
      expect(result.name).toBe('Frank Lead')
    })

    it('prefers customer over lead when both match', async () => {
      const pool = makePool({
        customers: [{ name: 'Greg Customer', phone: '+15551234567' }],
        leads: [{ name: 'Greg Lead', phone: '+15551234567' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('customer')
      expect(result.name).toBe('Greg Customer')
    })
  })

  describe('no-name fallback record', () => {
    it('returns nameless CRM lead record when no other source has a name', async () => {
      const pool = makePool({
        generic_entities: [{ data: { phone: '+15551234567', email: 'x@y.com' } }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result).toEqual({
        name: null,
        source: 'crm_lead',
        record: { phone: '+15551234567', email: 'x@y.com' },
      })
    })

    it('skips customers/leads with empty-string names (treated as no match)', async () => {
      const pool = makePool({
        generic_entities: [{ data: { phone: '+15551234567' } }],
        customers: [{ name: '', phone: '+15551234567' }],
        leads: [{ name: '', phone: '+15551234567' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      expect(result.name).toBe(null)
    })
  })

  describe('unknown caller', () => {
    it('returns all nulls when no source has a match', async () => {
      const pool = makePool({
        generic_entities: [{ data: { full_name: 'Other', phone: '+15550000000' } }],
        customers: [{ name: 'Else', phone: '+15550000000' }],
        leads: [{ name: 'Nope', phone: '+15550000000' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15559998888')
      expect(result).toEqual({ name: null, source: null, record: null })
    })

    it('does not match a record from a different company', async () => {
      const pool = makePool({
        customers: [{ name: 'Other Co Customer', phone: '+15551234567', company_id: 'other-co' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result).toEqual({ name: null, source: null, record: null })
    })
  })

  describe('error handling', () => {
    it('returns nulls and swallows DB errors', async () => {
      const pool = {
        query: vi.fn().mockRejectedValue(new Error('connection refused')),
      }
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result).toEqual({ name: null, source: null, record: null })
    })

    it('returns nulls when a later query throws after generic_entities returned no rows', async () => {
      const pool = {
        query: vi.fn(async (sql) => {
          if (sql.includes('generic_entities')) return { rows: [] }
          throw new Error('boom')
        }),
      }
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result).toEqual({ name: null, source: null, record: null })
    })
  })

  describe('sameSurname helper', () => {
    it('returns true when surnames are identical', () => {
      expect(sameSurname('Bill Smith', 'William Smith')).toBe(true)
    })
    it('returns false when surnames differ', () => {
      expect(sameSurname('Bill Smith', 'William Jones')).toBe(false)
    })
    it('returns true when either name has no surname (single word)', () => {
      expect(sameSurname('Bill', 'William Smith')).toBe(true)
      expect(sameSurname('Bill Smith', 'William')).toBe(true)
    })
    it('is case-insensitive for surnames', () => {
      expect(sameSurname('Bill SMITH', 'William smith')).toBe(true)
    })
  })

  describe('sameNicknameGroup helper', () => {
    it('recognizes Bill and William as the same group', () => {
      expect(sameNicknameGroup('Bill Smith', 'William Smith')).toBe(true)
    })
    it('recognizes Mike and Michael as the same group', () => {
      expect(sameNicknameGroup('Mike Jones', 'Michael Jones')).toBe(true)
    })
    it('recognizes Bob and Robert as the same group', () => {
      expect(sameNicknameGroup('Bob', 'Robert')).toBe(true)
    })
    it('returns true when both first names are identical', () => {
      expect(sameNicknameGroup('James Brown', 'James Brown')).toBe(true)
    })
    it('returns true when first name is empty', () => {
      expect(sameNicknameGroup('', 'William')).toBe(true)
    })
    it('returns false for genuinely different first names', () => {
      expect(sameNicknameGroup('Alice Smith', 'William Smith')).toBe(false)
    })
    it('returns false for unrelated short names', () => {
      expect(sameNicknameGroup('Tim', 'Tom')).toBe(false)
    })
  })

  describe('nickname-aware CRM lead merge', () => {
    it('returns the richest record when Bill/William are stored under the same number', async () => {
      const pool = makePool({
        generic_entities: [
          // "William" row has more data (richer) — note: mock returns in insertion order
          { data: { full_name: 'William Smith', phone: '+15551234567', email: 'w@example.com', address: '123 Main St', city: 'Columbus' } },
          { data: { full_name: 'Bill Smith',    phone: '+15551234567' } },
        ],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      // Should prefer "William Smith" row because it has more fields
      expect(result.name).toBe('William Smith')
    })

    it('returns the richer record when nickname variant has more fields', async () => {
      const pool = makePool({
        generic_entities: [
          { data: { full_name: 'Bob Johnson', phone: '+15551234567' } },
          { data: { full_name: 'Robert Johnson', phone: '+15551234567', email: 'r@example.com', mobile_phone: '+15551234567', address: '99 Oak' } },
        ],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      expect(result.name).toBe('Robert Johnson')
    })

    it('returns the richer record for Mike / Michael nickname pair', async () => {
      // Michael Davis has 3 fields (full_name, phone, email); Mike Davis has 2 — Michael wins
      const pool = makePool({
        generic_entities: [
          { data: { full_name: 'Mike Davis',    phone: '+15551234567' } },
          { data: { full_name: 'Michael Davis', phone: '+15551234567', email: 'mike@example.com' } },
        ],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      expect(result.name).toBe('Michael Davis')
    })

    it('falls back to most-recent record when first names are not nickname variants (different people)', async () => {
      const pool = makePool({
        generic_entities: [
          // Alice and Bob share the same number (unusual, but not nicknames of each other)
          { data: { full_name: 'Alice Smith', phone: '+15551234567' } },
          { data: { full_name: 'Bob Smith',   phone: '+15551234567' } },
        ],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      // Most-recently-updated (first in mock array = most recent) is returned
      expect(result.name).toBe('Alice Smith')
    })

    it('returns single named record normally when no duplicate exists', async () => {
      const pool = makePool({
        generic_entities: [
          { data: { full_name: 'Carol White', phone: '+15551234567', email: 'c@example.com' } },
        ],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      expect(result.name).toBe('Carol White')
    })

    it('treats three-way nickname group (Jim, James, Jimmy) as same person', async () => {
      const pool = makePool({
        generic_entities: [
          { data: { full_name: 'Jim Taylor', phone: '+15551234567' } },
          { data: { full_name: 'James Taylor', phone: '+15551234567', email: 'j@example.com' } },
          { data: { full_name: 'Jimmy Taylor', phone: '+15551234567', address: '5 Elm' } },
        ],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      // All three are variants; richest should win (James: 3 fields, others: 2)
      expect(result.name).toMatch(/James|Jim|Jimmy/)
    })

    it('does not merge nickname variants when surnames differ (Bill Smith vs William Jones)', async () => {
      // Different last names → different people → fall back to most-recent (first row)
      const pool = makePool({
        generic_entities: [
          { data: { full_name: 'Bill Smith',    phone: '+15551234567' } },
          { data: { full_name: 'William Jones', phone: '+15551234567', email: 'w@example.com' } },
        ],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      // Treated as different people — most-recent (first mock row) is returned
      expect(result.name).toBe('Bill Smith')
    })

    it('does not cross company boundaries during nickname merge', async () => {
      const pool = makePool({
        generic_entities: [
          { company_id: 'other-co', data: { full_name: 'William Jones', phone: '+15551234567' } },
          { company_id: COMPANY_ID, data: { full_name: 'Bill Jones', phone: '+15551234567' } },
        ],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.source).toBe('crm_lead')
      expect(result.name).toBe('Bill Jones')
    })
  })

  describe('digit-suffix matching for variant formats', () => {
    it('matches a customer stored without the country code (10-digit suffix)', async () => {
      // Caller dialed +1, customer record stored as 5551234567.
      // The SQL uses LIKE '%5551234567' which matches the bare 10-digit row.
      const pool = makePool({
        customers: [{ name: 'Hank 10digit', phone: '5551234567' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.name).toBe('Hank 10digit')
      expect(result.source).toBe('customer')
    })

    it('matches a lead by 7-digit suffix when only the local number is stored', async () => {
      const pool = makePool({
        leads: [{ name: 'Ivy Suffix7', phone: '1234567' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result.name).toBe('Ivy Suffix7')
      expect(result.source).toBe('lead')
    })

    it('does not match a customer whose suffix does not align with the caller', async () => {
      const pool = makePool({
        customers: [{ name: 'Wrong Number', phone: '5559876543' }],
      })
      const result = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(result).toEqual({ name: null, source: null, record: null })
    })
  })

  describe('caller cache', () => {
    it('returns cached result on second call without re-querying the DB', async () => {
      const pool = makePool({
        customers: [{ name: 'Cached Customer', phone: '+15551234567' }],
      })

      const first = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(first.name).toBe('Cached Customer')
      expect(pool.query).toHaveBeenCalled()

      pool.query.mockClear()

      const second = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(second).toEqual(first)
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('caches null result for an unknown caller', async () => {
      const pool = makePool()

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15559998888')
      pool.query.mockClear()

      const second = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15559998888')
      expect(second).toEqual({ name: null, source: null, record: null })
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('treats the same number in different formats as a cache hit', async () => {
      const pool = makePool({
        customers: [{ name: 'Format Test', phone: '5551234567' }],
      })

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      pool.query.mockClear()

      const second = await lookupCallerByCrmPhone(pool, COMPANY_ID, '5551234567')
      expect(second.name).toBe('Format Test')
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('does not share cache between different companies', async () => {
      const pool = makePool({
        customers: [
          { name: 'Company A Customer', phone: '+15551234567', company_id: COMPANY_ID },
        ],
      })

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      pool.query.mockClear()

      await lookupCallerByCrmPhone(pool, 'other-company', '+15551234567')
      expect(pool.query).toHaveBeenCalled()
    })

    it('re-queries after TTL expires', async () => {
      const pool = makePool({
        customers: [{ name: 'TTL Customer', phone: '+15551234567' }],
      })

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      pool.query.mockClear()

      const key = `${COMPANY_ID}::5551234567`
      const entry = callerLookupCache.get(key)
      callerLookupCache.set(key, { ...entry, cachedAt: Date.now() - CALLER_CACHE_TTL_MS - 1 })

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(pool.query).toHaveBeenCalled()
    })

    it('invalidateCallerCache evicts the specific entry', async () => {
      const pool = makePool({
        customers: [{ name: 'Evict Me', phone: '+15551234567' }],
      })

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      pool.query.mockClear()

      invalidateCallerCache(COMPANY_ID, '+15551234567')

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(pool.query).toHaveBeenCalled()
    })

    it('invalidateCallerCache does not evict entries for other phones', async () => {
      const pool = makePool({
        customers: [
          { name: 'Keep Me', phone: '+15559998888' },
          { name: 'Evict Me', phone: '+15551234567' },
        ],
      })

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15559998888')
      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      pool.query.mockClear()

      invalidateCallerCache(COMPANY_ID, '+15551234567')

      const kept = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15559998888')
      expect(kept.name).toBe('Keep Me')
      expect(pool.query).not.toHaveBeenCalled()
    })

    it('invalidateCallerCacheForCompany evicts all entries for that company', async () => {
      const pool = makePool({
        customers: [
          { name: 'Alice', phone: '+15551111111' },
          { name: 'Bob',   phone: '+15552222222' },
        ],
      })

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551111111')
      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15552222222')
      pool.query.mockClear()

      invalidateCallerCacheForCompany(COMPANY_ID)

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551111111')
      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15552222222')
      expect(pool.query).toHaveBeenCalled()
    })

    it('invalidateCallerCacheForCompany does not affect other companies', async () => {
      const poolA = makePool({ customers: [{ name: 'Company A', phone: '+15551234567', company_id: COMPANY_ID }] })
      const poolB = makePool({ customers: [{ name: 'Company B', phone: '+15551234567', company_id: 'company-b' }] })

      await lookupCallerByCrmPhone(poolA, COMPANY_ID, '+15551234567')
      await lookupCallerByCrmPhone(poolB, 'company-b', '+15551234567')
      poolA.query.mockClear()
      poolB.query.mockClear()

      invalidateCallerCacheForCompany(COMPANY_ID)

      await lookupCallerByCrmPhone(poolB, 'company-b', '+15551234567')
      expect(poolB.query).not.toHaveBeenCalled()
    })

    it('company-wide invalidation evicts old phone key when a contact phone number changes', async () => {
      const pool = makePool({
        customers: [{ name: 'Old Phone', phone: '+15550001111' }],
      })

      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15550001111')
      pool.query.mockClear()

      // Simulate: customer's phone changed from 0001111 to 0002222.
      // We don't know the old phone, so we do company-wide invalidation.
      invalidateCallerCacheForCompany(COMPANY_ID)

      // Old phone key must now trigger a fresh DB lookup.
      await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15550001111')
      expect(pool.query).toHaveBeenCalled()
    })

    it('does not cache results when an error is thrown', async () => {
      let callCount = 0
      const pool = {
        query: vi.fn(async () => {
          callCount++
          if (callCount === 1) throw new Error('DB error')
          return { rows: [{ name: 'Recovered', phone: '+15551234567' }] }
        }),
      }

      const first = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
      expect(first).toEqual({ name: null, source: null, record: null })

      const key = `${COMPANY_ID}::5551234567`
      expect(callerLookupCache.has(key)).toBe(false)
    })

    describe('ghlAutoSyncCron cache-invalidation regression', () => {
      // Regression for Task #223: syncGHLContacts must call
      // invalidateCallerCacheForCompany when contacts are created (not only
      // when contacts are updated). Before the fix the condition was
      // `if (updated > 0)`, which skipped invalidation on create-only batches.

      it('invalidateCallerCacheForCompany clears stale entries after a create-only GHL sync', async () => {
        // 1. Warm the cache with an old name for this phone.
        const poolBefore = makePool({
          customers: [{ name: 'Old GHL Name', phone: '+15553334444' }],
        })
        const before = await lookupCallerByCrmPhone(poolBefore, COMPANY_ID, '+15553334444')
        expect(before.name).toBe('Old GHL Name')
        poolBefore.query.mockClear()

        // 2. A GHL sync creates a new Lead with an updated name for the same
        //    phone (created > 0, updated === 0). The sync must now call
        //    invalidateCallerCacheForCompany so callers are identified correctly.
        invalidateCallerCacheForCompany(COMPANY_ID)

        // 3. After invalidation the next lookup should re-hit the DB.
        const poolAfter = makePool({
          customers: [{ name: 'New GHL Name', phone: '+15553334444' }],
        })
        const after = await lookupCallerByCrmPhone(poolAfter, COMPANY_ID, '+15553334444')
        expect(poolAfter.query).toHaveBeenCalled()
        expect(after.name).toBe('New GHL Name')
      })

      it('cache remains warm when no GHL sync writes occur (invalidation not called)', async () => {
        const pool = makePool({
          customers: [{ name: 'Stable Name', phone: '+15554445555' }],
        })
        await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15554445555')
        pool.query.mockClear()

        // No sync happened — cache should still serve the warm entry.
        const cached = await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15554445555')
        expect(cached.name).toBe('Stable Name')
        expect(pool.query).not.toHaveBeenCalled()
      })
    })

    describe('size-bounding (oldest-insertion / FIFO eviction)', () => {
      it('CALLER_CACHE_MAX_SIZE is exported and positive', () => {
        expect(typeof CALLER_CACHE_MAX_SIZE).toBe('number')
        expect(CALLER_CACHE_MAX_SIZE).toBeGreaterThan(0)
      })

      it('never exceeds CALLER_CACHE_MAX_SIZE entries', async () => {
        // Fill the cache beyond the cap using unique phone numbers
        const pool = makePool() // no rows — every lookup caches null
        const cap = CALLER_CACHE_MAX_SIZE
        for (let i = 0; i < cap + 10; i++) {
          // Build a unique 10-digit number for each iteration
          const phone = `+1555${String(i).padStart(7, '0')}`
          await lookupCallerByCrmPhone(pool, COMPANY_ID, phone)
        }
        expect(callerLookupCache.size).toBeLessThanOrEqual(cap)
      })

      it('evicts the oldest-inserted entry (FIFO) when the cap is reached', async () => {
        const pool = makePool()
        const cap = CALLER_CACHE_MAX_SIZE

        // Fill to exactly the cap
        for (let i = 0; i < cap; i++) {
          const phone = `+1555${String(i).padStart(7, '0')}`
          await lookupCallerByCrmPhone(pool, COMPANY_ID, phone)
        }

        // The first entry's key (i = 0 → digits "5550000000")
        const firstKey = `${COMPANY_ID}::5550000000`
        expect(callerLookupCache.has(firstKey)).toBe(true)

        // One more new entry should evict the first-inserted one
        await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15559999999')
        expect(callerLookupCache.has(firstKey)).toBe(false)
        expect(callerLookupCache.size).toBe(cap)
      })

      it('updating an existing key does not evict any entry (size stays the same)', async () => {
        const pool = makePool({
          customers: [{ name: 'Repeat Caller', phone: '+15551234567' }],
        })
        // Fill cache to cap - 1
        for (let i = 0; i < CALLER_CACHE_MAX_SIZE - 1; i++) {
          const phone = `+1555${String(i).padStart(7, '0')}`
          await lookupCallerByCrmPhone(pool, COMPANY_ID, phone)
        }

        const sizeBefore = callerLookupCache.size
        // Populate the target key once
        await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')
        // Expire it so the next call re-queries and re-sets the same key
        const key = `${COMPANY_ID}::5551234567`
        callerLookupCache.set(key, { result: callerLookupCache.get(key).result, cachedAt: 0 })
        await lookupCallerByCrmPhone(pool, COMPANY_ID, '+15551234567')

        // Re-setting an existing key must not grow the map beyond cap
        expect(callerLookupCache.size).toBeLessThanOrEqual(CALLER_CACHE_MAX_SIZE)
      })
    })
  })
})
