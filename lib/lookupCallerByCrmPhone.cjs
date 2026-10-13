/**
 * Shared CRM phone lookup — resolves a caller from generic_entities CRM leads,
 * customers, or leads (in that priority order).
 * Returns { name, source, record } where source is 'crm_lead', 'customer', 'lead', or null.
 * Uses digit-suffix LIKE queries to handle country-code and formatting variants.
 * When the same phone matches multiple CRM lead records whose first names are
 * nickname variants of each other (e.g. "Bill Smith" / "William Smith"), they are
 * treated as the same person and the richest record (most non-empty fields) is returned.
 * All errors are swallowed; this is always best-effort.
 *
 * Results are cached in-memory for CALLER_CACHE_TTL_MS per (companyId, normalizedPhone)
 * to reduce repeated DB queries for frequent callers and rapid notification bursts.
 * Use invalidateCallerCache() or invalidateCallerCacheForCompany() when lead/customer
 * data changes so stale entries are evicted immediately.
 */
const { NICKNAME_MAP } = require('./nicknameMap.cjs');

// ─── In-memory caller cache ───────────────────────────────────────────────────
const CALLER_CACHE_TTL_MS = 60 * 1000; // 60 seconds

// Max entries before oldest-insertion eviction.  Override via env var
// CALLER_CACHE_MAX_SIZE in production if the default proves too small.
const CALLER_CACHE_MAX_SIZE = (() => {
  const v = parseInt(process.env.CALLER_CACHE_MAX_SIZE, 10);
  return v > 0 ? v : 2000;
})();

/**
 * Map<cacheKey, { result: {name, source, record}, cachedAt: number }>
 * cacheKey = "<companyId>::<normalizedDigits>"
 * Insertion order is preserved by Map, so the first key is always the oldest.
 * Exported for testing.
 */
const callerLookupCache = new Map();

/**
 * Insert (or update) a cache entry.  When the map is full and the key is new,
 * the oldest-inserted entry is evicted first (FIFO by insertion order).
 * Re-setting an existing key never evicts because the map size does not grow.
 * Centralises all callerLookupCache.set() calls so the size guard is consistent.
 */
function _cacheSet(key, result) {
  if (callerLookupCache.size >= CALLER_CACHE_MAX_SIZE && !callerLookupCache.has(key)) {
    // Evict the oldest (first-inserted) entry — Map preserves insertion order
    callerLookupCache.delete(callerLookupCache.keys().next().value);
  }
  callerLookupCache.set(key, { result, cachedAt: Date.now() });
}

/**
 * Normalize a phone number to its trailing 10 digits (same logic as the
 * lookup body uses to derive `digits`).  Returns '' for invalid input.
 */
function _normalizeDigits(phone) {
  if (!phone) return '';
  const clean = phone.replace(/[^\d+]/g, '');
  return clean.replace(/^\+?1?/, '');
}

function _cacheKey(companyId, phone) {
  return `${companyId}::${_normalizeDigits(phone)}`;
}

/**
 * Evict a specific (companyId, phone) entry.
 * Call this whenever a lead or customer for that phone is created/updated/deleted.
 */
function invalidateCallerCache(companyId, phone) {
  if (!companyId || !phone) return;
  callerLookupCache.delete(_cacheKey(companyId, phone));
}

/**
 * Evict ALL cached entries for a company.
 * Use when the phone number isn't known (e.g. bulk CRM updates).
 */
function invalidateCallerCacheForCompany(companyId) {
  if (!companyId) return;
  const prefix = `${companyId}::`;
  for (const key of callerLookupCache.keys()) {
    if (key.startsWith(prefix)) callerLookupCache.delete(key);
  }
}

// ─── Name-matching helpers ────────────────────────────────────────────────────

function _firstName(fullName) {
  return (fullName || '').toLowerCase().trim().split(/\s+/)[0] || '';
}

function _surname(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ').toLowerCase() : '';
}

/**
 * Returns true when nameA and nameB share the same nickname group — i.e. one is
 * a common alias of the other (Bill ↔ William, Mike ↔ Michael, etc.).
 * Also returns true when either name is empty or both first names are identical.
 */
function sameNicknameGroup(nameA, nameB) {
  const a = _firstName(nameA);
  const b = _firstName(nameB);
  if (!a || !b || a === b) return true;
  return (NICKNAME_MAP[a] || []).includes(b) || (NICKNAME_MAP[b] || []).includes(a);
}

/**
 * Returns true when two full names share the same surname (everything after the
 * first word).  When either name is a single word (no surname), returns true so
 * single-name records don't block a merge.
 */
function sameSurname(nameA, nameB) {
  const a = _surname(nameA);
  const b = _surname(nameB);
  if (!a || !b) return true;
  return a === b;
}

/** Count of non-null / non-empty-string values in a plain object (higher = richer). */
function _richness(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.values(obj).filter(v => v !== null && v !== undefined && v !== '').length;
}

// ─── Core lookup ─────────────────────────────────────────────────────────────

async function lookupCallerByCrmPhone(pool, companyId, phone) {
  if (!phone || !companyId) return { name: null, source: null, record: null };
  try {
    const cleanPhone = phone.replace(/[^\d+]/g, '');
    const digits = cleanPhone.replace(/^\+?1?/, '');
    if (!digits || digits.length < 7) return { name: null, source: null, record: null };

    // ── Cache check ──────────────────────────────────────────────────────────
    const key = `${companyId}::${digits}`;
    const cached = callerLookupCache.get(key);
    if (cached && Date.now() - cached.cachedAt < CALLER_CACHE_TTL_MS) {
      return cached.result;
    }

    const d10 = digits.slice(-10);
    const d7  = digits.slice(-7);
    const phoneVariants = [cleanPhone, cleanPhone.replace(/^\+1/, ''), '+1' + cleanPhone.replace(/^\+1/, '')];

    // 1. Check generic_entities CRM leads first (richest data source).
    //    Fetch up to 5 so nickname-variant duplicates can be merged.
    const { rows: geRows } = await pool.query(
      `SELECT id, data FROM generic_entities WHERE entity_type = 'Lead' AND company_id = $1 AND (data->>'phone' = ANY($2) OR data->>'mobile_phone' = ANY($2) OR data->>'home_phone' = ANY($2) OR data->>'work_phone' = ANY($2) OR data->>'other_phone' = ANY($2)) ORDER BY updated_date DESC LIMIT 5`,
      [companyId, phoneVariants]
    );

    const namedGeRows = geRows.filter(r => r.data && (r.data.full_name || r.data.name));
    if (namedGeRows.length === 1) {
      const lead = namedGeRows[0].data;
      const result = { name: lead.full_name || lead.name, source: 'crm_lead', record: { ...lead, id: lead.id || namedGeRows[0].id } };
      _cacheSet(key, result);
      return result;
    }
    if (namedGeRows.length > 1) {
      const name0 = namedGeRows[0].data.full_name || namedGeRows[0].data.name;
      const allSameGroup = namedGeRows.every(r => {
        const n = r.data.full_name || r.data.name;
        return sameNicknameGroup(name0, n) && sameSurname(name0, n);
      });

      let result;
      if (allSameGroup) {
        // Same person stored under different name variants — pick the richest record.
        const richest = namedGeRows.reduce((best, curr) =>
          _richness(curr.data) > _richness(best.data) ? curr : best
        );
        const lead = richest.data;
        result = { name: lead.full_name || lead.name, source: 'crm_lead', record: { ...lead, id: lead.id || richest.id } };
      } else {
        // Genuinely different people sharing this number — return most recently updated (first row).
        const lead = namedGeRows[0].data;
        result = { name: lead.full_name || lead.name, source: 'crm_lead', record: { ...lead, id: lead.id || namedGeRows[0].id } };
      }
      _cacheSet(key, result);
      return result;
    }

    // 2. Check customers table (primary phone and phone_2)
    const { rows: custRows } = await pool.query(
      `SELECT * FROM customers WHERE company_id = $1 AND (phone LIKE $2 OR phone LIKE $3 OR phone LIKE $4 OR phone_2 LIKE $2 OR phone_2 LIKE $3 OR phone_2 LIKE $4) AND name IS NOT NULL AND name != '' LIMIT 1`,
      [companyId, `%${digits}`, `%${d10}`, `%${d7}`]
    );
    if (custRows[0]?.name) {
      const result = { name: custRows[0].name, source: 'customer', record: custRows[0] };
      _cacheSet(key, result);
      return result;
    }

    // 3. Check leads table (primary phone and phone_2)
    const { rows: leadRows } = await pool.query(
      `SELECT * FROM leads WHERE company_id = $1 AND (phone LIKE $2 OR phone LIKE $3 OR phone LIKE $4 OR phone_2 LIKE $2 OR phone_2 LIKE $3 OR phone_2 LIKE $4) AND name IS NOT NULL AND name != '' LIMIT 1`,
      [companyId, `%${digits}`, `%${d10}`, `%${d7}`]
    );
    if (leadRows[0]?.name) {
      const result = { name: leadRows[0].name, source: 'lead', record: leadRows[0] };
      _cacheSet(key, result);
      return result;
    }

    // Return the nameless CRM lead record if found (so callers can still use the record)
    if (geRows[0]?.data) {
      const result = { name: null, source: 'crm_lead', record: geRows[0].data };
      _cacheSet(key, result);
      return result;
    }

    const nullResult = { name: null, source: null, record: null };
    _cacheSet(key, nullResult);
    return nullResult;
  } catch (_) {
    return { name: null, source: null, record: null };
  }
}

module.exports = {
  lookupCallerByCrmPhone,
  sameNicknameGroup,
  sameSurname,
  invalidateCallerCache,
  invalidateCallerCacheForCompany,
  callerLookupCache,
  CALLER_CACHE_TTL_MS,
  CALLER_CACHE_MAX_SIZE,
};
