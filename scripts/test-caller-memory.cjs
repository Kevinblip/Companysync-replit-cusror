'use strict';

const assert = require('assert');
const {
  FLASH_MODEL,
  MEMORY_WORD_MAX,
  LONG_CALL_WORDS,
  LOOKUP_CUSTOMER_TOOL,
  phoneKey,
  packTranscript,
  formatMemoryForInstructions,
  instructionBlock,
  loadCallerMemory,
  saveCallerMemory,
  rememberCall,
  lookupCustomerDetail,
  buildMemoryFromTranscript,
  words,
} = require('../lib/callerMemory.cjs');

function createMemoryPool() {
  const rows = [];
  const sqlLog = [];
  return {
    rows,
    sqlLog,
    async query(sql, params = []) {
      const text = String(sql);
      sqlLog.push(text);
      if (/caller_memories/i.test(text) && !/company_id/i.test(text)) {
        throw new Error(`caller_memories SQL missing company_id: ${text}`);
      }
      if (/CREATE\s+(TABLE|INDEX)/i.test(text)) return { rows: [] };
      if (/INSERT INTO caller_memories/i.test(text)) {
        const [id, company_id, phone_key, customer_id, lead_id, contact_name, summary, factsJson, recent_excerpt, older_summary, source_call_id, word_count] = params;
        assert.match(text, /WHERE caller_memories\.company_id = EXCLUDED\.company_id/);
        assert.match(text, /caller_memories\.facts \|\| EXCLUDED\.facts/);
        const facts = JSON.parse(factsJson);
        let existing = rows.find((row) => row.company_id === company_id && row.phone_key === phone_key);
        if (!existing) {
          existing = {
            id, company_id, phone_key, customer_id, lead_id, contact_name, summary, facts,
            recent_excerpt, older_summary, source_call_id, word_count, updated_at: new Date().toISOString(),
          };
          rows.push(existing);
        } else {
          existing.customer_id = customer_id || existing.customer_id;
          existing.lead_id = lead_id || existing.lead_id;
          existing.contact_name = contact_name || existing.contact_name;
          existing.summary = summary;
          existing.facts = { ...existing.facts, ...facts };
          existing.recent_excerpt = recent_excerpt;
          existing.older_summary = older_summary || existing.older_summary;
          existing.source_call_id = source_call_id;
          existing.word_count = word_count;
          existing.updated_at = new Date().toISOString();
        }
        return { rows: [{ ...existing, facts: { ...existing.facts } }] };
      }
      if (/FROM caller_memories/i.test(text)) {
        assert.match(text, /company_id = \$1/);
        const [companyId, key, customerId, leadId] = params;
        const hit = rows.find((row) => row.company_id === companyId && (
          (key && row.phone_key === key)
          || (customerId && row.customer_id === customerId)
          || (leadId && row.lead_id === leadId)
        ));
        return { rows: hit ? [{ ...hit, facts: { ...hit.facts } }] : [] };
      }
      throw new Error(`unexpected SQL: ${text.slice(0, 180)}`);
    },
  };
}

(async () => {
  assert.equal(FLASH_MODEL, 'gemini-2.5-flash');
  assert.equal(LOOKUP_CUSTOMER_TOOL.name, 'lookup_customer');
  assert.equal(phoneKey('+1 (216) 555-1234'), '2165551234');
  assert.equal(phoneKey('216-555-1234'), phoneKey('12165551234'));

  await assert.rejects(() => loadCallerMemory({}, {}), /company_id is required/);
  await assert.rejects(() => lookupCustomerDetail({}, { phone: '2165551234' }), /company_id is required/);
  await assert.rejects(() => saveCallerMemory({}, { phone: '2165551234', summary: 'x' }), /company_id is required/);

  const pool = createMemoryPool();
  const phone = '+1 (216) 555-0199';
  const saved = await saveCallerMemory(pool, {
    companyId: 'company-a',
    phone,
    customerId: 'cust-a',
    leadId: 'lead-a',
    summary: 'Pat called about a roof leak and a State Farm claim.',
    facts: {
      name: 'Pat Lee',
      address: '1 Main St',
      roof_issue: 'active leak',
      insurance_carrier: 'State Farm',
      claim_number: 'SF-100',
      appointment: 'Thursday 2pm',
      preferences: 'texts after 5',
      last_outcome: 'inspection requested',
    },
    sourceCallId: 'comm-1',
  });
  assert.equal(saved.company_id, 'company-a');
  assert.equal(saved.phone_key, '2165550199');
  assert.equal(saved.facts.insurance_carrier, 'State Farm');

  const otherTenant = await loadCallerMemory(pool, { companyId: 'company-b', phone });
  assert.equal(otherTenant, null, 'company B must not read company A memory for the same phone');
  const otherLookup = await lookupCustomerDetail(pool, { companyId: 'company-b', phone, customerId: 'cust-a', leadId: 'lead-a' });
  assert.equal(otherLookup.found, false);
  assert.equal(otherLookup.company_id, 'company-b');

  const sameTenant = await loadCallerMemory(pool, { companyId: 'company-a', phone: '2165550199' });
  assert.equal(sameTenant.contact_name, 'Pat Lee');
  assert.equal(sameTenant.customer_id, 'cust-a');
  const byLead = await lookupCustomerDetail(pool, { companyId: 'company-a', leadId: 'lead-a' });
  assert.equal(byLead.found, true);
  assert.equal(byLead.facts.claim_number, 'SF-100');

  const merged = await saveCallerMemory(pool, {
    companyId: 'company-a',
    phone,
    summary: 'Follow-up call. Carrier was not repeated.',
    facts: { last_outcome: 'waiting on adjuster' },
  });
  assert.equal(merged.facts.insurance_carrier, 'State Farm', 'omitted facts must survive the merge');
  assert.equal(merged.facts.last_outcome, 'waiting on adjuster');
  assert.equal(merged.facts.name, 'Pat Lee');

  for (const sql of pool.sqlLog) {
    if (/caller_memories/i.test(sql)) {
      assert.match(sql, /company_id/, `every caller_memories statement must name company_id: ${sql.slice(0, 80)}`);
    }
  }

  const longTranscript = Array.from({ length: LONG_CALL_WORDS + 400 }, (_, i) => `word${i}`).join(' ');
  const packed = packTranscript(longTranscript);
  assert.equal(packed.compressed, true);
  assert.equal(words(packed.recent).length, 450);
  assert.ok(words(packed.older).length > 1000);
  assert.ok(!packed.recent.includes('word0 '));

  const prompts = [];
  const built = await buildMemoryFromTranscript({
    transcript: longTranscript,
    prior: { summary: 'Earlier note', facts: { insurance_carrier: 'State Farm' }, older_summary: '' },
    completeText: async (prompt) => {
      prompts.push(prompt);
      if (prompt.includes('OLDER TRANSCRIPT')) return 'Older portion: leak started last week.';
      assert.ok(!prompt.includes('word0 '), 'the memory prompt must not re-bill the older transcript');
      assert.match(prompt, /LATEST CALL/);
      return JSON.stringify({
        summary: 'Caller still has a roof leak and is waiting on the adjuster.',
        facts: { name: 'Pat Lee', roof_issue: 'leak', last_outcome: 'waiting on adjuster' },
        recent_excerpt: 'recent only',
      });
    },
  });
  assert.equal(prompts.length, 2, 'long calls summarize the older portion before the memory write');
  assert.match(prompts[0], /OLDER TRANSCRIPT/);
  assert.match(built.olderSummary, /leak started last week/);
  assert.equal(built.facts.insurance_carrier, 'State Farm');
  assert.ok(words(built.summary).length < 800);

  const remembered = await rememberCall(pool, {
    companyId: 'company-a',
    phone,
    transcript: longTranscript,
    sourceCallId: 'comm-2',
    completeText: async (prompt) => {
      if (prompt.includes('OLDER TRANSCRIPT')) return 'Compressed older turns.';
      return JSON.stringify({
        summary: 'Rolling memory after a long call about the same leak.',
        facts: { appointment: 'Friday 9am' },
        recent_excerpt: 'Friday at nine.',
      });
    },
  });
  assert.equal(remembered.company_id, 'company-a');
  assert.equal(remembered.facts.insurance_carrier, 'State Farm');
  assert.equal(remembered.facts.appointment, 'Friday 9am');
  assert.match(remembered.older_summary, /Compressed older turns/);

  const huge = formatMemoryForInstructions({
    summary: Array.from({ length: 2000 }, () => 'history').join(' '),
    facts: { name: 'Pat Lee' },
    older_summary: 'older',
  });
  assert.ok(words(huge).length <= MEMORY_WORD_MAX);
  assert.ok(words(instructionBlock(remembered)).length <= MEMORY_WORD_MAX);
  assert.match(instructionBlock(remembered), /CALLER MEMORY \(this company only/);
  assert.equal(instructionBlock(null), '');

  const cross = await rememberCall(pool, {
    companyId: 'company-b',
    phone,
    transcript: 'Caller said their name is Someone Else and the roof is fine today thanks.',
    completeText: async () => JSON.stringify({
      summary: 'Different company spoke with Someone Else.',
      facts: { name: 'Someone Else', last_outcome: 'no work needed' },
      recent_excerpt: 'no work',
    }),
  });
  assert.equal(cross.company_id, 'company-b');
  assert.equal(cross.facts.name, 'Someone Else');
  const stillA = await lookupCustomerDetail(pool, { companyId: 'company-a', phone });
  assert.equal(stillA.facts.name, 'Pat Lee');
  assert.notEqual(stillA.summary, cross.summary);

  console.log('caller memory tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
