/**
 * Unit tests for the competitor CRM migration hub helpers (src/lib/migrationPresets.js).
 *
 * These are pure functions consumed by DataImport.jsx to power the
 * "Switch to CompanySync" migration flow: per-platform header -> entityFields
 * mapping presets, and best-effort platform auto-detection from CSV headers.
 */
import { describe, it, expect } from 'vitest';
import {
  PLATFORMS,
  PLATFORM_ORDER,
  PLATFORM_HEADER_MAPS,
  PLATFORM_EXPORT_INSTRUCTIONS,
  getPresetMapping,
  detectPlatform,
} from '@/lib/migrationPresets';

// Keep this in sync with entityFields in src/pages/DataImport.jsx.
const VALID_ENTITY_KEYS = {
  Lead: ['lead_number', 'ghl_contact_id', 'name', 'email', 'phone', 'phone_2', 'assigned_to', 'is_active', 'created_date', 'company', 'website', 'group', 'street', 'city', 'state', 'zip', 'status', 'source', 'value', 'notes'],
  Customer: ['customer_number', 'ghl_contact_id', 'name', 'email', 'phone', 'phone_2', 'assigned_to', 'is_active', 'created_date', 'company', 'customer_type', 'street', 'city', 'state', 'zip', 'address', 'website', 'source', 'referral_source', 'group', 'insurance_company', 'claim_number', 'adjuster_name', 'adjuster_phone', 'installer', 'vendor_name', 'notes'],
  Project: ['name', 'customer_name', 'status', 'start_date', 'deadline', 'budget', 'description'],
  Estimate: ['estimate_number', 'customer_name', 'amount', 'total_tax', 'status', 'valid_until', 'project_name', 'reference_number', 'insurance_company', 'adjuster_name', 'adjuster_phone', 'claim_number', 'notes'],
  Invoice: ['invoice_number', 'customer_name', 'customer_email', 'amount', 'total_tax', 'status', 'issue_date', 'due_date', 'sale_agent', 'sale_agent_name', 'claim_number', 'insurance_company', 'notes', 'payment_method', 'payment_reference', 'payment_amount'],
};

describe('PLATFORM_HEADER_MAPS integrity', () => {
  it('only maps to keys that actually exist in DataImport.jsx entityFields', () => {
    for (const platform of PLATFORM_ORDER) {
      const entityMaps = PLATFORM_HEADER_MAPS[platform];
      for (const [entityType, headerMap] of Object.entries(entityMaps)) {
        const validKeys = VALID_ENTITY_KEYS[entityType];
        expect(validKeys, `Unknown entity type "${entityType}" in ${platform} preset`).toBeDefined();
        for (const [header, key] of Object.entries(headerMap)) {
          expect(
            validKeys.includes(key),
            `${platform}.${entityType}: header "${header}" maps to unknown key "${key}"`
          ).toBe(true);
        }
      }
    }
  });

  it('has export instructions for every platform', () => {
    for (const platform of PLATFORM_ORDER) {
      expect(PLATFORM_EXPORT_INSTRUCTIONS[platform]).toBeDefined();
      expect(PLATFORM_EXPORT_INSTRUCTIONS[platform].steps.length).toBeGreaterThan(0);
    }
  });

  it('every platform key is present in PLATFORMS', () => {
    for (const platform of PLATFORM_ORDER) {
      expect(PLATFORMS[platform]).toBeDefined();
      expect(PLATFORMS[platform].label).toBeTruthy();
    }
  });
});

describe('getPresetMapping', () => {
  it('maps JobNimbus contact export headers to Lead fields', () => {
    const headers = ['Display Name', 'Company Name', 'Email', 'Mobile Phone', 'City', 'State', 'Zip', 'Status Name', 'JNID'];
    const mapping = getPresetMapping('jobnimbus', 'Lead', headers);
    expect(mapping['Display Name']).toBe('name');
    expect(mapping['Email']).toBe('email');
    expect(mapping['Mobile Phone']).toBe('phone');
    expect(mapping['Status Name']).toBe('status');
    expect(mapping['JNID']).toBe('ghl_contact_id');
  });

  it('is tolerant of case and punctuation differences', () => {
    const headers = ['  display   NAME ', 'Mobile-Phone'];
    const mapping = getPresetMapping('jobnimbus', 'Lead', headers);
    expect(mapping['  display   NAME ']).toBe('name');
    expect(mapping['Mobile-Phone']).toBe('phone');
  });

  it('never maps two different headers onto the same field twice', () => {
    const headers = ['Mobile Phone', 'Home Phone'];
    const mapping = getPresetMapping('jobnimbus', 'Lead', headers);
    const mappedValues = Object.values(mapping);
    expect(mappedValues.filter(v => v === 'phone').length).toBe(1);
  });

  it('returns {} for unknown platform/entity combos', () => {
    expect(getPresetMapping('nonexistent', 'Lead', ['Email'])).toEqual({});
    expect(getPresetMapping('jobnimbus', 'NonexistentType', ['Email'])).toEqual({});
  });

  it('leaves unrecognized headers unmapped for smartAutoMap to fill in', () => {
    const headers = ['Some Custom Column', 'Email'];
    const mapping = getPresetMapping('jobnimbus', 'Lead', headers);
    expect(mapping['Some Custom Column']).toBeUndefined();
    expect(mapping['Email']).toBe('email');
  });
});

describe('detectPlatform', () => {
  it('detects a JobNimbus export from its signature headers', () => {
    const headers = ['JNID', 'Record Type Name', 'Display Name', 'Source Name', 'Email', 'City', 'State', 'Zip'];
    const result = detectPlatform(headers);
    expect(result).not.toBeNull();
    expect(result.platform).toBe('jobnimbus');
  });

  it('detects an AccuLynx export from its signature headers', () => {
    const headers = ['Job Address', 'Job City', 'Job Zip', 'Customer Name', 'Job Status', 'Sales Rep'];
    const result = detectPlatform(headers);
    expect(result).not.toBeNull();
    expect(result.platform).toBe('acculynx');
  });

  it('detects a ServiceTitan export from its signature headers', () => {
    const headers = ['Business Unit', 'Campaign Name', 'Booking Date', 'Customer Name', 'Email Address'];
    const result = detectPlatform(headers);
    expect(result).not.toBeNull();
    expect(result.platform).toBe('servicetitan');
  });

  it('detects a Buildertrend export from its signature headers', () => {
    const headers = ['Bid Status', 'Project Manager', 'Job #', 'Customer', 'Status'];
    const result = detectPlatform(headers);
    expect(result).not.toBeNull();
    expect(result.platform).toBe('buildertrend');
  });

  it('returns null for a generic/unrelated CSV with no signature hits', () => {
    const headers = ['Name', 'Email', 'Phone', 'Notes'];
    expect(detectPlatform(headers)).toBeNull();
  });

  it('returns null for an empty header list', () => {
    expect(detectPlatform([])).toBeNull();
    expect(detectPlatform(null)).toBeNull();
  });

  it('does not false-positive when signature headers are absent even with some overlapping generic headers', () => {
    // Shares "Email" and "Status" style headers with several platforms but has
    // no distinctive signature header for any of them.
    const headers = ['Name', 'Email', 'Status', 'City', 'State', 'Zip'];
    expect(detectPlatform(headers)).toBeNull();
  });
});
