import { describe, expect, it } from 'vitest';
import {
  dateKeyInTimeZone,
  dateTimeLocalInTimeZoneToUtc,
  formatInTimeZone,
  toDateTimeLocalInTimeZone,
} from './companyTimeZone';

describe('company timezone calendar helpers', () => {
  it('converts a Philippines-entered wall time to the same shared Eastern instant', () => {
    const utc = dateTimeLocalInTimeZoneToUtc('2026-10-15T12:30', 'Asia/Manila');
    expect(utc).toBe('2026-10-15T04:30:00.000Z');
    expect(formatInTimeZone(utc, { hour: 'numeric', minute: '2-digit', hour12: true }, 'America/New_York')).toBe('12:30 AM');
  });

  it('round-trips wall time through UTC using the selected company zone', () => {
    const utc = dateTimeLocalInTimeZoneToUtc('2026-10-15T09:15', 'America/New_York');
    expect(utc).toBe('2026-10-15T13:15:00.000Z');
    expect(toDateTimeLocalInTimeZone(utc, 'America/New_York')).toBe('2026-10-15T09:15');
    expect(dateKeyInTimeZone(utc, 'America/New_York')).toBe('2026-10-15');
    expect(dateTimeLocalInTimeZoneToUtc('2026-12-15T09:15', 'America/New_York'))
      .toBe('2026-12-15T14:15:00.000Z');
  });

  it('groups events under the company day even across a UTC midnight', () => {
    expect(dateKeyInTimeZone('2026-10-16T01:30:00.000Z', 'America/New_York'))
      .toBe('2026-10-15');
    expect(toDateTimeLocalInTimeZone('2026-10-16T01:30:00.000Z', 'America/New_York'))
      .toBe('2026-10-15T21:30');
  });

  it('rejects local times skipped by the spring daylight-saving transition', () => {
    expect(dateTimeLocalInTimeZoneToUtc('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });

  it('interprets a database timestamp without offset as UTC', () => {
    expect(formatInTimeZone('2026-10-15T13:15:00', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }, 'America/New_York')).toBe('9:15 AM');
  });

  it('preserves an explicit imported timezone offset', () => {
    expect(toDateTimeLocalInTimeZone('2026-10-15T21:15:00+08:00', 'America/New_York'))
      .toBe('2026-10-15T09:15');
  });
});
