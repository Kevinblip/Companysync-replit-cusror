/**
 * Official GoHighLevel / LeadConnector helpers.
 * Docs: https://marketplace.gohighlevel.com/docs/Authorization/PrivateIntegrationsToken/
 *
 * Auth: Bearer private-integration token (or location API key)
 * Base: https://services.leadconnectorhq.com
 * Version header: 2021-07-28
 */

const crypto = require('crypto');

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const GHL_INTEGRATION_NAME = 'gohighlevel';
const GHL_MAX_IMPORT_PAGES = 10;
const GHL_PAGE_LIMIT = 100;
const GHL_MAX_PUSH_LEADS = 100;

function maskApiKey(raw) {
  if (!raw) return '';
  const value = String(raw);
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

function normalizePhoneDigits(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

function isEncryptedKey(value) {
  if (!value || typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  return parts.every((part) => /^[0-9a-f]+$/i.test(part) && part.length >= 8);
}

function encryptStoredSecret(rawKey, encryptionKeyHex) {
  if (!rawKey) return null;
  if (!encryptionKeyHex) return rawKey;
  const key = Buffer.from(encryptionKeyHex, 'hex');
  if (key.length !== 32) return rawKey;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(rawKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptStoredSecret(stored, encryptionKeyHex) {
  if (!stored) return null;
  if (!isEncryptedKey(stored) || !encryptionKeyHex) return stored;
  const key = Buffer.from(encryptionKeyHex, 'hex');
  if (key.length !== 32) return stored;
  const [ivHex, authTagHex, ciphertext] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function ghlHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Version: GHL_API_VERSION,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function buildLocationUrl(locationId) {
  return `${GHL_API_BASE}/locations/${encodeURIComponent(locationId)}`;
}

function buildListContactsUrl({ locationId, limit = GHL_PAGE_LIMIT, startAfterId, query } = {}) {
  const params = new URLSearchParams();
  if (locationId) params.set('locationId', locationId);
  params.set('limit', String(limit));
  if (startAfterId) params.set('startAfterId', startAfterId);
  if (query) params.set('query', query);
  return `${GHL_API_BASE}/contacts/?${params.toString()}`;
}

function buildUpsertContactUrl() {
  return `${GHL_API_BASE}/contacts/upsert`;
}

function buildUpdateContactUrl(contactId) {
  return `${GHL_API_BASE}/contacts/${encodeURIComponent(contactId)}`;
}

function parseContactsPage(payload) {
  const contacts = payload?.contacts || payload?.data?.contacts || [];
  const meta = payload?.meta || payload?.data?.meta || {};
  const nextStartAfterId = meta.startAfterId || meta.nextPageId || null;
  const nextPageUrl = meta.nextPageUrl || null;
  return {
    contacts: Array.isArray(contacts) ? contacts : [],
    nextStartAfterId,
    nextPageUrl,
    hasMore: Boolean(nextPageUrl || nextStartAfterId),
  };
}

function contactDisplayName(contact) {
  const full = contact?.name || contact?.contactName || '';
  if (full && String(full).trim()) return String(full).trim();
  return `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim() || 'Unknown';
}

function contactToLead(contact, companyId, ownerEmail) {
  const address = contact?.address || {};
  const street = contact?.address1 || address.line1 || address.address1 || '';
  const city = contact?.city || address.city || '';
  const state = contact?.state || address.state || '';
  const zip = contact?.postalCode || contact?.zip || address.postalCode || '';
  const composedAddress = [street, city, state, zip].filter(Boolean).join(', ');
  return {
    company_id: companyId,
    name: contactDisplayName(contact),
    email: contact?.email || null,
    phone: contact?.phone || contact?.phoneNumber || null,
    street: street || null,
    city: city || null,
    state: state || null,
    zip: zip || null,
    address: composedAddress || null,
    company: contact?.companyName || null,
    ghl_contact_id: contact?.id || null,
    lead_source: 'GoHighLevel',
    source: 'gohighlevel',
    status: 'new',
    assigned_to: ownerEmail || null,
    notes: `Imported from GoHighLevel. GHL ID: ${contact?.id || ''}`,
    is_active: true,
    tags: Array.isArray(contact?.tags) ? contact.tags : [],
  };
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
  };
}

function leadToGhlContact(lead, locationId) {
  const { firstName, lastName } = splitName(lead?.name);
  return {
    firstName,
    lastName,
    email: lead?.email || undefined,
    phone: lead?.phone || undefined,
    address1: lead?.street || lead?.address || undefined,
    city: lead?.city || undefined,
    state: lead?.state || undefined,
    postalCode: lead?.zip || lead?.postal_code || undefined,
    companyName: lead?.company || undefined,
    source: lead?.source || lead?.lead_source || 'CompanySync',
    tags: Array.isArray(lead?.tags) ? lead.tags : undefined,
    locationId,
  };
}

function normalizeIntegrationName(name) {
  return String(name || '').trim().toLowerCase().replace(/[\s_-]/g, '');
}

function isGhlIntegrationName(name) {
  return normalizeIntegrationName(name) === 'gohighlevel';
}

function extractConfig(settingsRow) {
  if (!settingsRow) return {};
  const data = settingsRow.data || settingsRow;
  return data.config || data.settings || {};
}

function publicStatusFromSettings(settingsRow, { envFallbackConfigured = false } = {}) {
  const data = settingsRow?.data || settingsRow || {};
  const config = extractConfig(settingsRow);
  const storedKey = config.api_key || data.api_key || null;
  const hasStoredKey = Boolean(storedKey);
  const locationId = config.location_id || data.location_id || '';
  const connected = Boolean((hasStoredKey || envFallbackConfigured) && locationId && data.is_enabled !== false);
  const last4 = config.api_key_last4 || (storedKey && !isEncryptedKey(storedKey) ? storedKey.slice(-4) : '');
  return {
    connected,
    is_enabled: data.is_enabled !== false,
    has_api_key: hasStoredKey || envFallbackConfigured,
    uses_env_fallback: !hasStoredKey && envFallbackConfigured,
    api_key_masked: hasStoredKey ? (last4 ? `••••${last4}` : '••••saved') : (envFallbackConfigured ? '••••env' : ''),
    location_id: locationId,
    location_name: config.location_name || null,
    last_sync_at: config.last_sync_at || null,
    last_sync_error: config.last_sync_error || null,
    last_sync_result: config.last_sync_result || null,
    push_new_leads: config.push_new_leads !== false,
    import_contacts: config.import_contacts !== false,
  };
}

function resolveApiKey(config, envKey, encryptionKeyHex) {
  const stored = config?.api_key;
  if (stored) {
    try {
      return decryptStoredSecret(stored, encryptionKeyHex);
    } catch {
      return stored;
    }
  }
  return envKey || null;
}

module.exports = {
  GHL_API_BASE,
  GHL_API_VERSION,
  GHL_INTEGRATION_NAME,
  GHL_MAX_IMPORT_PAGES,
  GHL_PAGE_LIMIT,
  GHL_MAX_PUSH_LEADS,
  maskApiKey,
  normalizePhoneDigits,
  isEncryptedKey,
  encryptStoredSecret,
  decryptStoredSecret,
  ghlHeaders,
  buildLocationUrl,
  buildListContactsUrl,
  buildUpsertContactUrl,
  buildUpdateContactUrl,
  parseContactsPage,
  contactDisplayName,
  contactToLead,
  leadToGhlContact,
  splitName,
  normalizeIntegrationName,
  isGhlIntegrationName,
  extractConfig,
  publicStatusFromSettings,
  resolveApiKey,
};
