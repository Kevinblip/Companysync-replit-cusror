import { createRequire } from 'module'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const require = createRequire(import.meta.url)
const ghl = require('../../db/ghl-client.cjs')

const SAMPLE_KEY = 'a'.repeat(64)

describe('GHL client helpers', () => {
  it('builds official LeadConnector URLs and versioned headers', () => {
    assert.equal(ghl.GHL_API_BASE, 'https://services.leadconnectorhq.com')
    assert.equal(ghl.GHL_API_VERSION, '2021-07-28')
    assert.equal(
      ghl.buildLocationUrl('loc-1'),
      'https://services.leadconnectorhq.com/locations/loc-1'
    )
    assert.match(
      ghl.buildListContactsUrl({ locationId: 'loc-1', limit: 50, startAfterId: 'c9' }),
      /locationId=loc-1/
    )
    assert.equal(ghl.buildUpsertContactUrl(), 'https://services.leadconnectorhq.com/contacts/upsert')
    assert.deepEqual(ghl.ghlHeaders('pit-test'), {
      Authorization: 'Bearer pit-test',
      Version: '2021-07-28',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
  })

  it('maps a GHL contact onto a CompanySync lead', () => {
    const lead = ghl.contactToLead({
      id: 'ghl_99',
      firstName: 'Pat',
      lastName: 'Stone',
      email: 'pat@example.com',
      phone: '+12165551212',
      address1: '1 Main',
      city: 'Cleveland',
      state: 'OH',
      postalCode: '44101',
    }, 'co_1', 'owner@example.com')

    assert.equal(lead.name, 'Pat Stone')
    assert.equal(lead.ghl_contact_id, 'ghl_99')
    assert.equal(lead.source, 'gohighlevel')
    assert.equal(lead.lead_source, 'GoHighLevel')
    assert.equal(lead.company_id, 'co_1')
    assert.equal(lead.assigned_to, 'owner@example.com')
    assert.equal(lead.street, '1 Main')
    assert.equal(lead.zip, '44101')
  })

  it('maps a CompanySync lead onto a GHL contact payload', () => {
    const contact = ghl.leadToGhlContact({
      name: 'Kevin Stone',
      email: 'kevin@example.com',
      phone: '2165550000',
      street: '675 Alpha Dr',
      city: 'Highland Heights',
      state: 'OH',
      zip: '44143',
      source: 'manual',
    }, 'loc-abc')

    assert.equal(contact.firstName, 'Kevin')
    assert.equal(contact.lastName, 'Stone')
    assert.equal(contact.locationId, 'loc-abc')
    assert.equal(contact.postalCode, '44143')
    assert.equal(contact.source, 'manual')
  })

  it('parses paginated contact lists', () => {
    const page = ghl.parseContactsPage({
      contacts: [{ id: '1' }],
      meta: { startAfterId: 'cursor-2' },
    })
    assert.equal(page.contacts.length, 1)
    assert.equal(page.nextStartAfterId, 'cursor-2')
    assert.equal(page.hasMore, true)
  })

  it('masks tokens and never treats short values as plaintext dumps', () => {
    assert.equal(ghl.maskApiKey('pit-abcdefghijklmnopqrstuvwxyz'), '••••wxyz')
    assert.equal(ghl.maskApiKey('ab'), '••••')
  })

  it('encrypts secrets when ENCRYPTION_KEY is present and decrypts them back', () => {
    const stored = ghl.encryptStoredSecret('pit-secret-value', SAMPLE_KEY)
    assert.notEqual(stored, 'pit-secret-value')
    assert.equal(ghl.isEncryptedKey(stored), true)
    assert.equal(ghl.decryptStoredSecret(stored, SAMPLE_KEY), 'pit-secret-value')
  })

  it('leaves plaintext tokens readable when no encryption key is configured', () => {
    assert.equal(ghl.encryptStoredSecret('pit-plain', ''), 'pit-plain')
    assert.equal(ghl.decryptStoredSecret('pit-plain', ''), 'pit-plain')
  })

  it('builds a public status payload without exposing the raw token', () => {
    const status = ghl.publicStatusFromSettings({
      data: {
        integration_name: 'gohighlevel',
        is_enabled: true,
        config: { api_key: 'pit-super-secret-token', location_id: 'loc-1', last_sync_at: '2026-08-23T00:00:00.000Z' },
      },
    })
    assert.equal(status.connected, true)
    assert.equal(status.location_id, 'loc-1')
    assert.equal(status.has_api_key, true)
    assert.equal(status.api_key_masked, '••••oken')
    assert.doesNotMatch(JSON.stringify(status), /pit-super-secret-token/)
  })

  it('recognizes both gohighlevel and GoHighLevel setting names', () => {
    assert.equal(ghl.isGhlIntegrationName('gohighlevel'), true)
    assert.equal(ghl.isGhlIntegrationName('GoHighLevel'), true)
    assert.equal(ghl.isGhlIntegrationName('jobnimbus'), false)
  })
})
